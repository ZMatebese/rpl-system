import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  app, resetDatabase, tokenFor, applicationInState, someQualificationId, TMP_ROOT,
} from './helpers.js';
import { getDb } from '../src/db/index.js';
import { seedAdmin } from '../src/db/seedAdmin.js';

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const qualIds = () =>
  getDb().prepare(`SELECT id FROM qualifications ORDER BY id`).all().map((r) => r.id);

async function createStaff(adminToken, overrides = {}) {
  const res = await request(app).post('/api/admin/users').set(auth(adminToken)).send({
    email: 'new.assessor@rpl.local',
    firstName: 'Lerato',
    surname: 'Mokoena',
    role: 'ASSESSOR',
    password: 'Welcome#2026',
    qualificationIds: [qualIds()[1]],
    ...overrides,
  });
  return res;
}

describe('single administrator', () => {
  beforeEach(() => resetDatabase());

  it('has exactly one active administrator after seeding', () => {
    const n = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role='ADMINISTRATOR' AND active=1`)
      .get().n;
    expect(n).toBe(1);
  });

  it('refuses to grant the administrator role through the API', async () => {
    const admin = await tokenFor(request, 'admin');
    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    const assessor = users.find((u) => u.email === 'assessor@rpl.local');

    const res = await request(app)
      .patch(`/api/admin/users/${assessor.id}/role`)
      .set(auth(admin))
      .send({ role: 'ADMINISTRATOR' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_NOT_ASSIGNABLE');
  });

  it('refuses to create a staff account with the administrator role', async () => {
    const admin = await tokenFor(request, 'admin');
    const res = await createStaff(admin, { role: 'ADMINISTRATOR' });
    expect(res.status).toBe(400);
  });

  it('refuses deactivating or deleting the administrator', async () => {
    const admin = await tokenFor(request, 'admin');
    const me = (await request(app).get('/api/auth/me').set(auth(admin))).body.user;

    const off = await request(app)
      .patch(`/api/admin/users/${me.id}/status`).set(auth(admin)).send({ active: false });
    expect(off.status).toBe(403);

    const del = await request(app).delete(`/api/admin/users/${me.id}`).set(auth(admin));
    expect(del.status).toBe(403);
  });

  it('the database itself rejects a second active administrator', () => {
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO users (email, password_hash, first_name, surname, role)
           VALUES ('second@rpl.local', 'x', 'A', 'B', 'ADMINISTRATOR')`
        )
        .run()
    ).toThrow();
  });

  it('seed:admin replaces the current administrator and deactivates the old one', async () => {
    const result = seedAdmin({
      quiet: true,
      env: {
        ADMIN_EMAIL: 'tebza@cput.ac.za',
        ADMIN_PASSWORD: 'NewAdmin#2026',
        ADMIN_FIRST_NAME: 'Zola',
        ADMIN_SURNAME: 'Matebese',
      },
    });
    expect(result.changed).toBe(true);
    expect(result.deactivated.map((u) => u.email)).toEqual(['admin@rpl.local']);

    const old = await request(app).post('/api/auth/login')
      .send({ email: 'admin@rpl.local', password: 'Admin#2026' });
    expect(old.status).toBe(403);
    expect(old.body.error.code).toBe('ACCOUNT_INACTIVE');

    const fresh = await request(app).post('/api/auth/login')
      .send({ email: 'tebza@cput.ac.za', password: 'NewAdmin#2026' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.role).toBe('ADMINISTRATOR');
  });

  it('seed:admin is a no-op when nothing has changed', () => {
    const env = {
      ADMIN_EMAIL: 'admin@rpl.local', ADMIN_PASSWORD: 'Admin#2026',
      ADMIN_FIRST_NAME: 'Test', ADMIN_SURNAME: 'Administrator',
    };
    expect(seedAdmin({ quiet: true, env }).changed).toBe(false);
  });

  it('seed:admin refuses a weak password', () => {
    expect(() =>
      seedAdmin({ quiet: true, env: { ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: 'short' } })
    ).toThrow(/at least 10/);
  });
});

describe('staff accounts: create, read, update', () => {
  let admin;
  beforeEach(async () => {
    resetDatabase();
    admin = await tokenFor(request, 'admin');
  });

  it('creates an assessor with a qualification scope and logs it', async () => {
    const res = await createStaff(admin);
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ASSESSOR');
    expect(res.body.user.qualificationIds).toEqual([qualIds()[1]]);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash/);

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'new.assessor@rpl.local', password: 'Welcome#2026' });
    expect(login.status).toBe(200);

    const log = (await request(app).get('/api/admin/audit').set(auth(admin))).body.entries;
    expect(log[0]).toMatchObject({ action: 'USER_CREATED', target_email: 'new.assessor@rpl.local' });
  });

  it('creates a moderator', async () => {
    const res = await createStaff(admin, { email: 'mod2@rpl.local', role: 'MODERATOR' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('MODERATOR');
  });

  it('refuses a duplicate email, bad qualification and weak password', async () => {
    expect((await createStaff(admin, { email: 'assessor@rpl.local' })).status).toBe(409);
    expect((await createStaff(admin, { qualificationIds: [99999] })).status).toBe(400);
    expect((await createStaff(admin, { password: 'weak' })).status).toBe(400);
  });

  it('lists users with their active flag and scope', async () => {
    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    const assessor = users.find((u) => u.email === 'assessor@rpl.local');
    expect(assessor.active).toBe(true);
    const offered = getDb().prepare(`SELECT COUNT(*) AS n FROM qualifications WHERE active = 1`).get().n;
    expect(assessor.qualificationIds.length).toBe(offered);
  });

  it('changes a role and the scope, writing both to the log', async () => {
    const created = (await createStaff(admin)).body.user;

    const role = await request(app).patch(`/api/admin/users/${created.id}/role`)
      .set(auth(admin)).send({ role: 'MODERATOR' });
    expect(role.status).toBe(200);
    expect(role.body.user.role).toBe('MODERATOR');

    const scope = await request(app).put(`/api/admin/users/${created.id}/qualifications`)
      .set(auth(admin)).send({ qualificationIds: qualIds().slice(0, 2) });
    expect(scope.status).toBe(200);
    expect(scope.body.user.qualificationIds).toEqual(qualIds().slice(0, 2));

    const actions = (await request(app).get('/api/admin/audit').set(auth(admin))).body.entries
      .map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['ROLE_CHANGED', 'SCOPE_CHANGED']));
  });

  it('clears the scope when a staff member becomes an applicant', async () => {
    const created = (await createStaff(admin)).body.user;
    const res = await request(app).patch(`/api/admin/users/${created.id}/role`)
      .set(auth(admin)).send({ role: 'APPLICANT' });
    expect(res.body.user.qualificationIds).toEqual([]);
  });

  it('updates a name and resets a password', async () => {
    const created = (await createStaff(admin)).body.user;

    const name = await request(app).patch(`/api/admin/users/${created.id}`)
      .set(auth(admin)).send({ firstName: 'Lerato', surname: 'Mokoena-Dube' });
    expect(name.body.user.surname).toBe('Mokoena-Dube');

    const pw = await request(app).post(`/api/admin/users/${created.id}/password`)
      .set(auth(admin)).send({ password: 'Changed#2026x' });
    expect(pw.status).toBe(200);

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'new.assessor@rpl.local', password: 'Changed#2026x' });
    expect(login.status).toBe(200);
  });
});

describe('staff accounts: deactivate and delete', () => {
  let admin;
  beforeEach(async () => {
    resetDatabase();
    admin = await tokenFor(request, 'admin');
  });

  it('a deactivated account cannot sign in, and an existing token stops working', async () => {
    const created = (await createStaff(admin)).body.user;
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'new.assessor@rpl.local', password: 'Welcome#2026' });
    const token = login.body.token;

    const off = await request(app).patch(`/api/admin/users/${created.id}/status`)
      .set(auth(admin)).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.user.active).toBe(false);

    const again = await request(app).post('/api/auth/login')
      .send({ email: 'new.assessor@rpl.local', password: 'Welcome#2026' });
    expect(again.status).toBe(403);

    const me = await request(app).get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(401);

    const on = await request(app).patch(`/api/admin/users/${created.id}/status`)
      .set(auth(admin)).send({ active: true });
    expect(on.body.user.active).toBe(true);
  });

  it('refuses to deactivate an assessor who still has files under review', async () => {
    await applicationInState(request, 'UNDER_REVIEW');
    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    const assessor = users.find((u) => u.email === 'assessor@rpl.local');

    const res = await request(app).patch(`/api/admin/users/${assessor.id}/status`)
      .set(auth(admin)).send({ active: false });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OPEN_ALLOCATIONS');
  });

  it('deletes an account with no records, keeping the log entry', async () => {
    const created = (await createStaff(admin)).body.user;

    const del = await request(app).delete(`/api/admin/users/${created.id}`).set(auth(admin));
    expect(del.status).toBe(204);

    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    expect(users.find((u) => u.id === created.id)).toBeUndefined();

    const log = (await request(app).get('/api/admin/audit').set(auth(admin))).body.entries;
    expect(log[0]).toMatchObject({ action: 'USER_DELETED', target_email: 'new.assessor@rpl.local' });
  });

  it('refuses to delete an account that appears in the record', async () => {
    await applicationInState(request, 'UNDER_REVIEW');
    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    const applicant = users.find((u) => u.email === 'applicant@rpl.local');

    const res = await request(app).delete(`/api/admin/users/${applicant.id}`).set(auth(admin));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_RECORDS');
  });
});

describe('qualification scope on allocation', () => {
  let admin;
  beforeEach(async () => {
    resetDatabase();
    admin = await tokenFor(request, 'admin');
  });

  it('refuses allocation to an assessor not scoped to the qualification', async () => {
    const id = await applicationInState(request, 'SUBMITTED');
    // Scoped only to a different qualification than the application's.
    const other = qualIds().find((q) => q !== someQualificationId());
    const created = (await createStaff(admin, { qualificationIds: [other] })).body.user;

    const res = await request(app).post(`/api/applications/${id}/allocate`)
      .set(auth(admin)).send({ assessorId: created.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('filters the assessor picker by qualification and hides inactive assessors', async () => {
    const other = qualIds().find((q) => q !== someQualificationId());
    const created = (await createStaff(admin, { qualificationIds: [other] })).body.user;

    const forFirst = (await request(app)
      .get(`/api/admin/assessors?qualificationId=${someQualificationId()}`)
      .set(auth(admin))).body.assessors;
    expect(forFirst.find((a) => a.id === created.id)).toBeUndefined();

    const forOther = (await request(app)
      .get(`/api/admin/assessors?qualificationId=${other}`)
      .set(auth(admin))).body.assessors;
    expect(forOther.find((a) => a.id === created.id)).toBeDefined();

    await request(app).patch(`/api/admin/users/${created.id}/status`)
      .set(auth(admin)).send({ active: false });
    const after = (await request(app)
      .get(`/api/admin/assessors?qualificationId=${other}`)
      .set(auth(admin))).body.assessors;
    expect(after.find((a) => a.id === created.id)).toBeUndefined();
  });
});

describe('moderation', () => {
  beforeEach(() => resetDatabase());

  it('a moderator cannot see an application before it is assessed', async () => {
    const id = await applicationInState(request, 'UNDER_REVIEW');
    const mod = await tokenFor(request, 'moderator');
    const res = await request(app).get(`/api/applications/${id}`).set(auth(mod));
    expect(res.status).toBe(403);
  });

  it('a moderator in scope can read, download evidence and record a moderation', async () => {
    const id = await applicationInState(request, 'ASSESSMENT_COMPLETE');
    const mod = await tokenFor(request, 'moderator');

    const list = (await request(app).get('/api/applications/moderation').set(auth(mod))).body;
    expect(list.applications.map((a) => a.id)).toContain(id);

    const detail = await request(app).get(`/api/applications/${id}`).set(auth(mod));
    expect(detail.status).toBe(200);
    expect(detail.body.application.canModerate).toBe(true);

    const evId = detail.body.application.evidence[0].id;
    const dl = await request(app).get(`/api/evidence/${evId}/download`).set(auth(mod));
    expect(dl.status).toBe(200);

    const rec = await request(app).post(`/api/applications/${id}/moderation`).set(auth(mod))
      .send({ verdict: 'CONFIRMED', comments: 'Ratings consistent with the evidence.' });
    expect(rec.status).toBe(201);

    // Visible to the admin and the allocated assessor, not to the applicant.
    const admin = await tokenFor(request, 'admin');
    const seen = await request(app).get(`/api/applications/${id}/moderation`).set(auth(admin));
    expect(seen.body.moderations).toHaveLength(1);

    const assessor = await tokenFor(request, 'assessor');
    expect((await request(app).get(`/api/applications/${id}/moderation`).set(auth(assessor))).status).toBe(200);

    const applicant = await tokenFor(request, 'applicant');
    expect((await request(app).get(`/api/applications/${id}/moderation`).set(auth(applicant))).status).toBe(403);
  });

  it('a moderator outside the qualification scope is refused', async () => {
    const id = await applicationInState(request, 'ASSESSMENT_COMPLETE');
    const admin = await tokenFor(request, 'admin');
    const users = (await request(app).get('/api/admin/users').set(auth(admin))).body.users;
    const moderator = users.find((u) => u.email === 'moderator@rpl.local');
    const other = qualIds().find((q) => q !== someQualificationId());

    await request(app).put(`/api/admin/users/${moderator.id}/qualifications`)
      .set(auth(admin)).send({ qualificationIds: [other] });

    const mod = await tokenFor(request, 'moderator');
    expect((await request(app).get(`/api/applications/${id}`).set(auth(mod))).status).toBe(403);
    const rec = await request(app).post(`/api/applications/${id}/moderation`).set(auth(mod))
      .send({ verdict: 'CONCERNS', comments: 'x' });
    expect(rec.status).toBe(403);
  });

  it('requires a valid verdict and comments', async () => {
    const id = await applicationInState(request, 'ASSESSMENT_COMPLETE');
    const mod = await tokenFor(request, 'moderator');
    const bad = await request(app).post(`/api/applications/${id}/moderation`).set(auth(mod))
      .send({ verdict: 'MAYBE', comments: 'x' });
    expect(bad.status).toBe(422);
    const empty = await request(app).post(`/api/applications/${id}/moderation`).set(auth(mod))
      .send({ verdict: 'CONFIRMED', comments: '  ' });
    expect(empty.status).toBe(422);
  });
});

describe('migration of an existing database', () => {
  it('upgrades the old users table and keeps every row and id', async () => {
    // Build a database with the previous schema (three roles, no active flag,
    // two administrators) and point a fresh process at it.
    const legacyPath = path.join(TMP_ROOT, 'legacy.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL, surname TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'APPLICANT'
             CHECK (role IN ('APPLICANT','ASSESSOR','ADMINISTRATOR')),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, email, password_hash, first_name, surname, role) VALUES
        (1, 'admin1@x.co', 'h', 'A', 'One', 'ADMINISTRATOR'),
        (2, 'admin2@x.co', 'h', 'A', 'Two', 'ADMINISTRATOR'),
        (7, 'student@x.co', 'h', 'S', 'T', 'APPLICANT');
    `);
    legacy.close();

    const script = `
      process.env.DB_PATH = ${JSON.stringify(legacyPath)};
      const { getDb } = await import(${JSON.stringify(path.resolve('src/db/index.js'))});
      const db = getDb();
      const rows = db.prepare('SELECT id, role, active FROM users ORDER BY id').all();
      db.prepare("INSERT INTO users (email,password_hash,first_name,surname,role) VALUES ('m@x.co','h','M','O','MODERATOR')").run();
      console.log(JSON.stringify(rows));
    `;
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
      encoding: 'utf8',
    });
    const rows = JSON.parse(out.trim().split('\n').pop());
    expect(rows).toEqual([
      { id: 1, role: 'ADMINISTRATOR', active: 1 },
      { id: 2, role: 'ADMINISTRATOR', active: 0 }, // second admin deactivated
      { id: 7, role: 'APPLICANT', active: 1 },
    ]);
    fs.rmSync(legacyPath, { force: true });
  });
});
