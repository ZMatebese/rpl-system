import bcrypt from 'bcryptjs';
import { getDb } from './index.js';
import { config } from '../config/index.js';
import { seedAdmin } from './seedAdmin.js';
import {
  CPUT_QUALIFICATIONS, LEGACY_DEMO_SAQA_IDS, OFFERED_RPL_TYPES,
} from './cputQualifications.js';


// Demonstration accounts for development only. There is deliberately no demo
// administrator: the single administrator comes from ADMIN_* environment
// variables via seedAdmin().
const DEMO_USERS = [
  { email: 'assessor@rpl.local',  password: 'Assessor#2026',  first_name: 'Pieter', surname: 'van Wyk',  role: 'ASSESSOR' },
  { email: 'assessor2@rpl.local', password: 'Assessor#2026',  first_name: 'Fatima', surname: 'Patel',    role: 'ASSESSOR' },
  { email: 'moderator@rpl.local', password: 'Moderator#2026', first_name: 'Thandi', surname: 'Nkosi',    role: 'MODERATOR' },
  { email: 'applicant@rpl.local', password: 'Applicant#2026', first_name: 'Sipho',  surname: 'Mahlangu', role: 'APPLICANT' },
];

function demoUsersEnabled() {
  if (config.nodeEnv === 'production') return false;
  return process.env.SEED_DEMO_USERS !== 'false';
}

export function seed({ quiet = false } = {}) {
  const db = getDb();

  // Upsert by title, so re-running the seed picks up corrections to the list
  // (an RPL type CPUT changes, say) without duplicating rows.
  const upsertQual = db.prepare(
    `INSERT INTO qualifications (title, faculty, rpl_type, nqf_level, active)
     VALUES (@title, @faculty, @rpl_type, @nqf_level, @active)
     ON CONFLICT(title) DO UPDATE SET
       faculty = excluded.faculty, rpl_type = excluded.rpl_type,
       nqf_level = excluded.nqf_level, active = excluded.active`
  );
  const retireLegacy = db.prepare(`UPDATE qualifications SET active = 0 WHERE saqa_id = ?`);
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (email, password_hash, first_name, surname, role)
     VALUES (@email, @password_hash, @first_name, @surname, @role)`
  );
  const findUser = db.prepare(`SELECT id FROM users WHERE email = ?`);
  // Counts only qualifications still offered, so demo staff created against the
  // old placeholder list are re-scoped to the CPUT list.
  const hasScope = db.prepare(
    `SELECT COUNT(*) AS n FROM staff_qualifications sq
     JOIN qualifications q ON q.id = sq.qualification_id
     WHERE sq.user_id = ? AND q.active = 1`
  );
  const addScope = db.prepare(
    `INSERT OR IGNORE INTO staff_qualifications (user_id, qualification_id)
     SELECT ?, id FROM qualifications WHERE active = 1`
  );

  const withDemo = demoUsersEnabled();

  const run = db.transaction(() => {
    for (const q of CPUT_QUALIFICATIONS) {
      upsertQual.run({
        title: q.title,
        faculty: q.faculty,
        rpl_type: q.rpl_type,
        nqf_level: q.nqf_level ?? null,
        active: OFFERED_RPL_TYPES.includes(q.rpl_type) ? 1 : 0,
      });
    }
    for (const saqa of LEGACY_DEMO_SAQA_IDS) retireLegacy.run(saqa);
    if (!withDemo) return;
    for (const u of DEMO_USERS) {
      insertUser.run({
        email: u.email,
        password_hash: bcrypt.hashSync(u.password, config.bcryptRounds),
        first_name: u.first_name,
        surname: u.surname,
        role: u.role,
      });
      // Demo staff cover every qualification, but only on first seed, so a
      // scope the administrator has since narrowed is not put back.
      if (u.role === 'ASSESSOR' || u.role === 'MODERATOR') {
        const { id } = findUser.get(u.email);
        if (hasScope.get(id).n === 0) addScope.run(id);
      }
    }
  });

  run();

  // The administrator is seeded only when its credentials are configured.
  // A bad ADMIN_* value must not stop the server: warn and carry on, so the
  // existing administrator (if any) can still sign in.
  let adminResult = null;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    try {
      adminResult = seedAdmin({ quiet: true });
    } catch (err) {
      console.warn(
        `WARNING: administrator not updated from .env: ${err.message}\n` +
        '         If the password contains #, wrap it in double quotes in .env, e.g.\n' +
        '         ADMIN_PASSWORD="Tebza#Admin2026"'
      );
    }
  }

  if (!quiet) {
    console.log('Seed complete.\n');
    if (withDemo) {
      console.log('  Demo accounts (password shown):');
      for (const u of DEMO_USERS) {
        console.log(`    ${u.role.padEnd(14)} ${u.email.padEnd(22)} ${u.password}`);
      }
    }
    console.log(
      adminResult
        ? `\n  Administrator: ${adminResult.user.email}`
        : '\n  No administrator configured. Set ADMIN_* in .env and run: npm run seed:admin'
    );
    const offered = CPUT_QUALIFICATIONS.filter((q) => OFFERED_RPL_TYPES.includes(q.rpl_type)).length;
    console.log(`\n  ${CPUT_QUALIFICATIONS.length} CPUT qualifications loaded, ${offered} open for RPL.\n`);
  }
}

// Allow `node src/db/seed.js`
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed();
  process.exit(0);
}
