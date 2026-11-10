import bcrypt from 'bcryptjs';
import { getDb } from './index.js';
import { config } from '../config/index.js';
import { seedAdmin } from './seedAdmin.js';

const QUALIFICATIONS = [
  { saqa_id: '101234', title: 'Diploma in Information Technology', nqf_level: 6 },
  { saqa_id: '101235', title: 'Advanced Diploma in Information Technology', nqf_level: 7 },
  { saqa_id: '101236', title: 'Postgraduate Diploma in ICT', nqf_level: 8 },
  { saqa_id: '101237', title: 'Diploma in Business Administration', nqf_level: 6 },
  { saqa_id: '101238', title: 'National Diploma in Project Management', nqf_level: 6 },
];

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

  const insertQual = db.prepare(
    `INSERT OR IGNORE INTO qualifications (saqa_id, title, nqf_level) VALUES (@saqa_id, @title, @nqf_level)`
  );
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (email, password_hash, first_name, surname, role)
     VALUES (@email, @password_hash, @first_name, @surname, @role)`
  );
  const findUser = db.prepare(`SELECT id FROM users WHERE email = ?`);
  const hasScope = db.prepare(`SELECT COUNT(*) AS n FROM staff_qualifications WHERE user_id = ?`);
  const addScope = db.prepare(
    `INSERT OR IGNORE INTO staff_qualifications (user_id, qualification_id)
     SELECT ?, id FROM qualifications`
  );

  const withDemo = demoUsersEnabled();

  const run = db.transaction(() => {
    for (const q of QUALIFICATIONS) insertQual.run(q);
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
  let adminResult = null;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    adminResult = seedAdmin({ quiet: true });
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
    console.log(`\n  ${QUALIFICATIONS.length} qualifications loaded.\n`);
  }
}

// Allow `node src/db/seed.js`
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed();
  process.exit(0);
}
