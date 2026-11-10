import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  app, resetDatabase, tokenFor, applicationInState, someQualificationId, PDF_BYTES,
} from './helpers.js';

describe('state machine guards', () => {
  beforeEach(() => resetDatabase());

  it('refuses submission without evidence (422)', async () => {
    const id = await applicationInState(request, 'DRAFT');
    const token = await tokenFor(request, 'applicant');

    const res = await request(app)
      .post(`/api/applications/${id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GUARD_FAILED');
  });

  it('refuses submission with evidence but an empty motivation (422)', async () => {
    const token = await tokenFor(request, 'applicant');
    const created = await request(app)
      .post('/api/applications')
      .set('Authorization', `Bearer ${token}`)
      .send({ qualificationId: someQualificationId(), motivation: '   ' });
    const id = created.body.application.id;

    await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PDF_BYTES, { filename: 'a.pdf', contentType: 'application/pdf' });

    const res = await request(app)
      .post(`/api/applications/${id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it('allows submission once both guard conditions are met', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    const token = await tokenFor(request, 'admin');
    const res = await request(app)
      .get(`/api/applications/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.application.status).toBe('SUBMITTED');
  });

  it('refuses allocation to a user who is not an assessor (422)', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    const admin = await tokenFor(request, 'admin');
    const users = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`);
    const applicant = users.body.users.find((u) => u.role === 'APPLICANT');

    const res = await request(app)
      .post(`/api/applications/${id}/allocate`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ assessorId: applicant.id });

    expect(res.status).toBe(422);
  });

  it('refuses review entry without an allocated assessor', async () => {
    // Allocation and the transition are coupled, so a SUBMITTED application
    // can never be moved to UNDER_REVIEW through any other route.
    const id = await applicationInState(request, 'SUBMITTED');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .post(`/api/applications/${id}/outcome`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'approve', rationale: 'Skipping assessment.' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('refuses approval without a recorded assessment (no SUBMITTED to APPROVED arc)', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .post(`/api/applications/${id}/outcome`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'approve', rationale: 'Approving early.' });

    expect(res.status).toBe(409);
  });

  it('refuses an incomplete criterion set (422)', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const assessor = await tokenFor(request, 'assessor');
    const res = await request(app)
      .post(`/api/applications/${id}/assessment`)
      .set('Authorization', `Bearer ${assessor}`)
      .send({
        criterionRatings: { currency: 'MET', authenticity: 'MET' },
        comments: 'Partial.',
        recommendation: 'RECOMMEND_APPROVE',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/sufficiency/);
  });

  it('refuses an outcome without a rationale (422)', async () => {
    const id = await applicationInState(request, 'ASSESSMENT_COMPLETE');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .post(`/api/applications/${id}/outcome`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'approve', rationale: '  ' });

    expect(res.status).toBe(422);
  });

  it('treats APPROVED as terminal (409)', async () => {
    const id = await applicationInState(request, 'APPROVED');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .post(`/api/applications/${id}/outcome`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'reject', rationale: 'Reversing.' });

    expect(res.status).toBe(409);
  });

  it('refuses edits to an application that has left DRAFT (409)', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    const token = await tokenFor(request, 'applicant');
    const res = await request(app)
      .patch(`/api/applications/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivation: 'Changed after submission.' });

    expect(res.status).toBe(409);
  });

  it('refuses evidence attachment after submission (409)', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    const token = await tokenFor(request, 'applicant');
    const res = await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PDF_BYTES, { filename: 'late.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(409);
  });

  it('allows an administrator to return an application to DRAFT', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .post(`/api/applications/${id}/return`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ note: 'Please provide a certified transcript.' });

    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('DRAFT');
  });
});

describe('audit trail invariant', () => {
  beforeEach(() => resetDatabase());

  it('records every transition with actor and prior state', async () => {
    const id = await applicationInState(request, 'APPROVED');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .get(`/api/applications/${id}/audit`)
      .set('Authorization', `Bearer ${admin}`);

    const transitions = res.body.history.map((h) => [h.previous_status, h.new_status]);
    expect(transitions).toEqual([
      [null, 'DRAFT'],
      ['DRAFT', 'SUBMITTED'],
      ['SUBMITTED', 'UNDER_REVIEW'],
      ['UNDER_REVIEW', 'ASSESSMENT_COMPLETE'],
      ['ASSESSMENT_COMPLETE', 'APPROVED'],
    ]);

    for (const entry of res.body.history) {
      expect(entry.actor_id).toBeTruthy();
      expect(entry.changed_at).toBeTruthy();
    }
  });

  it('writes no audit row when a transition is refused', async () => {
    const id = await applicationInState(request, 'DRAFT');
    const applicant = await tokenFor(request, 'applicant');

    await request(app)
      .post(`/api/applications/${id}/submit`)
      .set('Authorization', `Bearer ${applicant}`)
      .expect(422);

    const res = await request(app)
      .get(`/api/applications/${id}/audit`)
      .set('Authorization', `Bearer ${applicant}`);

    // Only the creation row exists; the refused transition left no trace.
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].new_status).toBe('DRAFT');
  });

  it('attributes each transition to the role that performed it', async () => {
    const id = await applicationInState(request, 'APPROVED');
    const admin = await tokenFor(request, 'admin');
    const res = await request(app)
      .get(`/api/applications/${id}/audit`)
      .set('Authorization', `Bearer ${admin}`);

    const roles = res.body.history.map((h) => h.actor_role);
    expect(roles).toEqual([
      'APPLICANT', 'APPLICANT', 'ADMINISTRATOR', 'ASSESSOR', 'ADMINISTRATOR',
    ]);
  });
});
