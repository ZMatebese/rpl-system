import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test file gets its own throwaway database and upload directory, so
// tests never share state. These must be set before any src module is
// imported, because config reads them at module load.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpl-test-'));
process.env.DB_PATH = path.join(tmpRoot, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpRoot, 'uploads');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
// bcrypt at cost 12 makes a large test suite slow; the hashing itself is
// covered by its own test.
process.env.BCRYPT_ROUNDS = '4';
// The single administrator comes from these, exactly as in deployment.
process.env.ADMIN_EMAIL = 'admin@rpl.local';
process.env.ADMIN_PASSWORD = 'Admin#2026';
process.env.ADMIN_FIRST_NAME = 'Test';
process.env.ADMIN_SURNAME = 'Administrator';

const { createApp } = await import('../src/app.js');
const { getDb } = await import('../src/db/index.js');
const { seed } = await import('../src/db/seed.js');

export const app = createApp();
export const TMP_ROOT = tmpRoot;

export function resetDatabase() {
  const db = getDb();
  db.exec(`
    DELETE FROM user_audit_log;
    DELETE FROM moderations;
    DELETE FROM staff_qualifications;
    DELETE FROM application_status_history;
    DELETE FROM assessments;
    DELETE FROM evidence;
    DELETE FROM applications;
    DELETE FROM users;
    DELETE FROM qualifications;
    DELETE FROM sqlite_sequence;
  `);
  seed({ quiet: true });
}

/** Resolve a real qualification id rather than assuming one. */
export function someQualificationId() {
  return getDb().prepare(`SELECT id FROM qualifications ORDER BY id LIMIT 1`).get().id;
}

export const ACCOUNTS = {
  applicant: { email: 'applicant@rpl.local', password: 'Applicant#2026' },
  assessor:  { email: 'assessor@rpl.local',  password: 'Assessor#2026' },
  assessor2: { email: 'assessor2@rpl.local', password: 'Assessor#2026' },
  moderator: { email: 'moderator@rpl.local', password: 'Moderator#2026' },
  admin:     { email: 'admin@rpl.local',     password: 'Admin#2026' },
};

export async function tokenFor(request, who) {
  const res = await request(app).post('/api/auth/login').send(ACCOUNTS[who]);
  if (res.status !== 200) throw new Error(`login failed for ${who}: ${res.text}`);
  return res.body.token;
}

export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>'
);

/** Drives an application to a given lifecycle state and returns its id. */
export async function applicationInState(request, state) {
  const applicantToken = await tokenFor(request, 'applicant');

  const created = await request(app)
    .post('/api/applications')
    .set('Authorization', `Bearer ${applicantToken}`)
    .send({
      qualificationId: someQualificationId(),
      motivation: 'Substantial prior experience in the field.',
    });
  const id = created.body.application.id;
  if (state === 'DRAFT') return id;

  await request(app)
    .post(`/api/applications/${id}/evidence`)
    .set('Authorization', `Bearer ${applicantToken}`)
    .attach('file', PDF_BYTES, { filename: 'cv.pdf', contentType: 'application/pdf' });

  await request(app)
    .post(`/api/applications/${id}/submit`)
    .set('Authorization', `Bearer ${applicantToken}`);
  if (state === 'SUBMITTED') return id;

  const adminToken = await tokenFor(request, 'admin');
  const assessors = await request(app)
    .get('/api/admin/assessors')
    .set('Authorization', `Bearer ${adminToken}`);
  const assessor = assessors.body.assessors.find((a) => a.email === ACCOUNTS.assessor.email);

  await request(app)
    .post(`/api/applications/${id}/allocate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ assessorId: assessor.id });
  if (state === 'UNDER_REVIEW') return id;

  const assessorToken = await tokenFor(request, 'assessor');
  await request(app)
    .post(`/api/applications/${id}/assessment`)
    .set('Authorization', `Bearer ${assessorToken}`)
    .send({
      criterionRatings: {
        currency: 'MET', authenticity: 'MET', sufficiency: 'MET',
        relevance: 'MET', level: 'MET',
      },
      comments: 'Evidence supports the claim.',
      recommendation: 'RECOMMEND_APPROVE',
    });
  if (state === 'ASSESSMENT_COMPLETE') return id;

  await request(app)
    .post(`/api/applications/${id}/outcome`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'approve', rationale: 'Credit granted.' });
  return id;
}
