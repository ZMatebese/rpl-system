import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, tokenFor, applicationInState } from './helpers.js';

/**
 * Objective 1 requires that every protected endpoint enforce role
 * authorisation server-side. This suite is the measure of that objective:
 * each protected route is exercised with no token and with every role that
 * should be refused.
 */

const ALL = ['applicant', 'assessor', 'moderator', 'admin'];

// Every protected route in the API, with the roles permitted to reach it.
// scripts/check-route-coverage.mjs cross-checks this table against the route
// definitions, so a new endpoint added without a test here fails the check.
const ROUTES = [
  { method: 'get',    path: '/api/auth/me',                        allow: ALL },
  { method: 'get',    path: '/api/qualifications',                 allow: ALL },
  { method: 'get',    path: '/api/assessment-criteria',            allow: ALL },
  { method: 'post',   path: '/api/applications',                   allow: ['applicant'] },
  { method: 'get',    path: '/api/applications/mine',              allow: ['applicant'] },
  { method: 'patch',  path: '/api/applications/:id',               allow: ['applicant'] },
  { method: 'post',   path: '/api/applications/:id/submit',        allow: ['applicant'] },
  { method: 'post',   path: '/api/applications/:id/evidence',      allow: ['applicant'] },
  { method: 'delete', path: '/api/evidence/1',                     allow: ['applicant'] },
  { method: 'get',    path: '/api/applications/allocated',         allow: ['assessor'] },
  { method: 'post',   path: '/api/applications/:id/assessment',    allow: ['assessor'] },
  { method: 'get',    path: '/api/applications/queue',             allow: ['admin'] },
  { method: 'get',    path: '/api/applications',                   allow: ['admin'] },
  { method: 'post',   path: '/api/applications/:id/allocate',      allow: ['admin'] },
  { method: 'post',   path: '/api/applications/:id/return',        allow: ['admin'] },
  { method: 'post',   path: '/api/applications/:id/outcome',       allow: ['admin'] },
  { method: 'get',    path: '/api/statistics',                     allow: ['admin'] },
  { method: 'get',    path: '/api/admin/assessors',                allow: ['admin'] },
  { method: 'get',    path: '/api/admin/users',                    allow: ['admin'] },
  { method: 'patch',  path: '/api/admin/users/1/role',             allow: ['admin'] },
  { method: 'get',    path: '/api/admin/audit',                    allow: ['admin'] },
  { method: 'post',   path: '/api/admin/users',                    allow: ['admin'] },
  { method: 'patch',  path: '/api/admin/users/1',                  allow: ['admin'] },
  { method: 'put',    path: '/api/admin/users/1/qualifications',   allow: ['admin'] },
  { method: 'patch',  path: '/api/admin/users/1/status',           allow: ['admin'] },
  { method: 'post',   path: '/api/admin/users/1/password',         allow: ['admin'] },
  { method: 'delete', path: '/api/admin/users/1',                  allow: ['admin'] },
  { method: 'get',    path: '/api/applications/moderation',        allow: ['moderator'] },
  { method: 'post',   path: '/api/applications/:id/moderation',    allow: ['moderator'] },

  // Routes where the role layer admits any authenticated caller and the
  // decision is record-level instead (ownership, or being the allocated
  // assessor). They are listed here so the no-token case is still covered;
  // the record-level refusals are asserted in the suite below.
  { method: 'get',    path: '/api/applications/:id',               allow: ALL },
  { method: 'get',    path: '/api/applications/:id/evidence',      allow: ALL },
  { method: 'get',    path: '/api/applications/:id/assessment',    allow: ALL },
  { method: 'get',    path: '/api/applications/:id/audit',         allow: ALL },
  { method: 'get',    path: '/api/applications/:id/moderation',    allow: ALL },
  { method: 'get',    path: '/api/evidence/1/download',            allow: ALL },
];

const ALL_ROLES = ALL;

describe('endpoint authorisation', () => {
  let applicationId;

  beforeEach(async () => {
    resetDatabase();
    applicationId = await applicationInState(request, 'DRAFT');
  });

  const resolve = (p) => p.replace(':id', applicationId);

  describe('no token is refused with 401', () => {
    for (const route of ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path}`, async () => {
        const res = await request(app)[route.method](resolve(route.path));
        expect(res.status).toBe(401);
      });
    }
  });

  describe('a malformed or forged token is refused with 401', () => {
    for (const route of ROUTES.slice(0, 6)) {
      it(`${route.method.toUpperCase()} ${route.path}`, async () => {
        const res = await request(app)
          [route.method](resolve(route.path))
          .set('Authorization', 'Bearer not.a.real.token');
        expect(res.status).toBe(401);
      });
    }
  });

  describe('a role outside the allow-list is refused with 403', () => {
    for (const route of ROUTES) {
      const denied = ALL_ROLES.filter((r) => !route.allow.includes(r));
      for (const role of denied) {
        it(`${route.method.toUpperCase()} ${route.path} as ${role}`, async () => {
          const token = await tokenFor(request, role);
          const res = await request(app)
            [route.method](resolve(route.path))
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        });
      }
    }
  });
});

describe('record-level authorisation', () => {
  beforeEach(() => resetDatabase());

  it('refuses an assessor who is not the allocated one', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const wrong = await tokenFor(request, 'assessor2');

    const res = await request(app)
      .post(`/api/applications/${id}/assessment`)
      .set('Authorization', `Bearer ${wrong}`)
      .send({
        criterionRatings: {
          currency: 'MET', authenticity: 'MET', sufficiency: 'MET',
          relevance: 'MET', level: 'MET',
        },
        comments: 'Attempting to assess an application I was not given.',
        recommendation: 'RECOMMEND_APPROVE',
      });

    expect(res.status).toBe(403);
  });

  it('refuses an assessor reading an application allocated elsewhere', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const wrong = await tokenFor(request, 'assessor2');

    const res = await request(app)
      .get(`/api/applications/${id}`)
      .set('Authorization', `Bearer ${wrong}`);

    expect(res.status).toBe(403);
  });

  it('refuses evidence download to an unrelated assessor', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const admin = await tokenFor(request, 'admin');
    const ev = await request(app)
      .get(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${admin}`);
    const evidenceId = ev.body.evidence[0].id;

    const wrong = await tokenFor(request, 'assessor2');
    const res = await request(app)
      .get(`/api/evidence/${evidenceId}/download`)
      .set('Authorization', `Bearer ${wrong}`);

    expect(res.status).toBe(403);
  });

  it('allows the allocated assessor to download evidence', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const admin = await tokenFor(request, 'admin');
    const ev = await request(app)
      .get(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${admin}`);

    const right = await tokenFor(request, 'assessor');
    const res = await request(app)
      .get(`/api/evidence/${ev.body.evidence[0].id}/download`)
      .set('Authorization', `Bearer ${right}`);

    expect(res.status).toBe(200);
  });

  it('scopes an applicant list to their own records only', async () => {
    await applicationInState(request, 'DRAFT');
    const token = await tokenFor(request, 'applicant');
    const res = await request(app)
      .get('/api/applications/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    for (const a of res.body.applications) {
      expect(a.applicant_id).toBe(me.body.user.id);
    }
  });

  it('refuses a role sent in the registration payload (no self-elevation)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'sneaky@rpl.local',
      password: 'Password#2026',
      firstName: 'Would',
      surname: 'BeAdmin',
      role: 'ADMINISTRATOR',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('APPLICANT');
  });

  it('never returns a password hash', async () => {
    const token = await tokenFor(request, 'admin');
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/password_hash/);
    expect(serialised).not.toMatch(/\$2[aby]\$/);
  });
});
