import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import request from 'supertest';
import {
  app, resetDatabase, tokenFor, applicationInState, PDF_BYTES, TMP_ROOT,
} from './helpers.js';

describe('evidence handling', () => {
  let id, token;

  beforeEach(async () => {
    resetDatabase();
    id = await applicationInState(request, 'DRAFT');
    token = await tokenFor(request, 'applicant');
  });

  it('accepts an allowed type and stores it under a generated name', async () => {
    const res = await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PDF_BYTES, { filename: 'my cv.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    // The client-supplied name is kept for display only.
    expect(res.body.evidence.original_filename).toBe('my cv.pdf');
    // Storage uses a UUID, so no uploaded file has a guessable path.
    expect(res.body.evidence.stored_filename).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/
    );
    expect(res.body.evidence.stored_filename).not.toContain('cv');
  });

  it('refuses a disallowed MIME type (415)', async () => {
    const res = await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'payload.sh', contentType: 'application/x-sh',
      });

    expect(res.status).toBe(415);
  });

  it('refuses an executable disguised with a PDF extension', async () => {
    const res = await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('MZ\x90\x00'), {
        filename: 'invoice.pdf', contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(415);
  });

  it('leaves no file on disk when the type is refused', async () => {
    const before = fs.existsSync(`${TMP_ROOT}/uploads`)
      ? fs.readdirSync(`${TMP_ROOT}/uploads`).length : 0;

    await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('x'), {
        filename: 'bad.exe', contentType: 'application/octet-stream',
      });

    const after = fs.existsSync(`${TMP_ROOT}/uploads`)
      ? fs.readdirSync(`${TMP_ROOT}/uploads`).length : 0;
    expect(after).toBe(before);
  });

  it('refuses attaching evidence to an application the caller does not own', async () => {
    // Register a second applicant and have them target the first one's file.
    await request(app).post('/api/auth/register').send({
      email: 'other@rpl.local', password: 'Password#2026',
      firstName: 'Other', surname: 'Person',
    });
    const other = await request(app).post('/api/auth/login')
      .send({ email: 'other@rpl.local', password: 'Password#2026' });

    const res = await request(app)
      .post(`/api/applications/${id}/evidence`)
      .set('Authorization', `Bearer ${other.body.token}`)
      .attach('file', PDF_BYTES, { filename: 'cv.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });
});

describe('authentication', () => {
  beforeEach(() => resetDatabase());

  it('gives an identical response for unknown email and wrong password', async () => {
    const unknown = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@rpl.local', password: 'Whatever#2026' });
    const wrong = await request(app).post('/api/auth/login')
      .send({ email: 'applicant@rpl.local', password: 'WrongPassword#1' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    // No account enumeration: the two refusals are indistinguishable.
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('refuses a weak password at registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'weak@rpl.local', password: 'short', firstName: 'A', surname: 'B',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'applicant@rpl.local', password: 'Password#2026',
      firstName: 'Dup', surname: 'Licate',
    });
    expect(res.status).toBe(409);
  });

  it('reflects a role change immediately, without reissuing the token', async () => {
    // The caller's role is read from the database record, not the token
    // claim, so an elevation or demotion takes effect on the next request.
    const admin = await tokenFor(request, 'admin');
    const applicantToken = await tokenFor(request, 'applicant');

    const me = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${applicantToken}`);

    await request(app)
      .patch(`/api/admin/users/${me.body.user.id}/role`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'ASSESSOR' })
      .expect(200);

    // The old token still authenticates, but now carries assessor authority.
    const queue = await request(app).get('/api/applications/allocated')
      .set('Authorization', `Bearer ${applicantToken}`);
    expect(queue.status).toBe(200);

    const applicantOnly = await request(app).get('/api/applications/mine')
      .set('Authorization', `Bearer ${applicantToken}`);
    expect(applicantOnly.status).toBe(403);
  });

  it('refuses an administrator demoting themselves', async () => {
    const admin = await tokenFor(request, 'admin');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin}`);

    const res = await request(app)
      .patch(`/api/admin/users/${me.body.user.id}/role`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'APPLICANT' });

    // The administrator account is protected from every account-management
    // route, including the administrator's own requests.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_PROTECTED');
  });
});
