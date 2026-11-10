import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, tokenFor } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { CPUT_QUALIFICATIONS } from '../src/db/cputQualifications.js';

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const byTitle = (title) =>
  getDb().prepare(`SELECT * FROM qualifications WHERE title = ?`).get(title);

describe('CPUT qualification list', () => {
  beforeEach(() => resetDatabase());

  it('loads every qualification from the CPUT RPL page', () => {
    const n = getDb().prepare(`SELECT COUNT(*) AS n FROM qualifications`).get().n;
    expect(n).toBe(CPUT_QUALIFICATIONS.length);
    expect(n).toBe(32);
  });

  it('offers applicants only the qualifications open for RPL', async () => {
    const token = await tokenFor(request, 'applicant');
    const list = (await request(app).get('/api/qualifications').set(auth(token))).body.qualifications;
    const titles = list.map((q) => q.title);

    expect(list).toHaveLength(20);
    expect(titles).toContain('Information and Communication Technologies (ICT)');
    expect(titles).toContain('Human Resource Management');
    expect(titles).not.toContain('Real Estate');
    expect(titles).not.toContain('Bachelor: Nursing');
    expect(titles).not.toContain('Diploma: Interior Design'); // RPL type not stated by CPUT
    expect(list.every((q) => ['ACCESS', 'ACCESS_EXEMPTION'].includes(q.rpl_type))).toBe(true);
  });

  it('records the faculty and RPL type, leaving unpublished NQF levels empty', () => {
    expect(byTitle('Banking')).toMatchObject({
      faculty: 'Business and Management Sciences', rpl_type: 'ACCESS', nqf_level: null,
    });
    expect(byTitle('Diploma: Public Administration')).toMatchObject({
      rpl_type: 'ACCESS_EXEMPTION', nqf_level: 6,
    });
    expect(byTitle('Bachelor: Education (Foundation, GET and HET)').active).toBe(0);
  });

  it('is safe to run the seed again', () => {
    seed({ quiet: true });
    seed({ quiet: true });
    const n = getDb().prepare(`SELECT COUNT(*) AS n FROM qualifications`).get().n;
    expect(n).toBe(32);
  });
});

describe('RPL route on an application', () => {
  let token;
  beforeEach(async () => {
    resetDatabase();
    token = await tokenFor(request, 'applicant');
  });

  const create = (title, rplRoute) =>
    request(app).post('/api/applications').set(auth(token))
      .send({ qualificationId: byTitle(title).id, rplRoute, motivation: 'Experience.' });

  it('defaults to access', async () => {
    const res = await request(app).post('/api/applications').set(auth(token))
      .send({ qualificationId: byTitle('Banking').id, motivation: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.application.rpl_route).toBe('ACCESS');
  });

  it('allows exemption where CPUT offers it', async () => {
    const res = await create('Marketing', 'EXEMPTION');
    expect(res.status).toBe(201);
    expect(res.body.application.rpl_route).toBe('EXEMPTION');
    expect(res.body.application.qualification_rpl_type).toBe('ACCESS_EXEMPTION');
  });

  it('refuses exemption on an access-only qualification', async () => {
    const res = await create('Information and Communication Technologies (ICT)', 'EXEMPTION');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ROUTE_NOT_OFFERED');
  });

  it('refuses a qualification that is not open for RPL', async () => {
    const res = await create('Real Estate', 'ACCESS');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUALIFICATION_CLOSED');
  });

  it('checks the route again when a draft is edited', async () => {
    const id = (await create('Marketing', 'EXEMPTION')).body.application.id;
    const res = await request(app).patch(`/api/applications/${id}`).set(auth(token))
      .send({ qualificationId: byTitle('Banking').id });
    expect(res.status).toBe(422); // Banking is access only; the draft still says EXEMPTION

    const ok = await request(app).patch(`/api/applications/${id}`).set(auth(token))
      .send({ qualificationId: byTitle('Banking').id, rplRoute: 'ACCESS' });
    expect(ok.status).toBe(200);
  });
});
