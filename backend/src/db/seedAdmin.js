import bcrypt from 'bcryptjs';
import { getDb } from './index.js';
import { config } from '../config/index.js';
import { userRepository } from '../repositories/userRepository.js';
import { userAuditRepository } from '../repositories/userAuditRepository.js';
import { validatePassword, EMAIL_RE } from '../services/authService.js';

/**
 * Creates or updates THE administrator from environment variables:
 *
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_SURNAME
 *
 * This is the only way the ADMINISTRATOR role is ever granted. No API route
 * can do it, and the database refuses a second active administrator.
 *
 * Any other active administrator (for example the old demo account) is
 * deactivated in the same transaction, so after this runs there is exactly
 * one. Run it again with a new ADMIN_PASSWORD to recover a lost password.
 *
 *   npm run seed:admin
 */
export function seedAdmin({ quiet = false, env = process.env } = {}) {
  const email = (env.ADMIN_EMAIL ?? '').toLowerCase().trim();
  const password = env.ADMIN_PASSWORD ?? '';
  const firstName = (env.ADMIN_FIRST_NAME ?? '').trim() || 'RPL';
  const surname = (env.ADMIN_SURNAME ?? '').trim() || 'Administrator';

  if (!EMAIL_RE.test(email)) {
    throw new Error('ADMIN_EMAIL is missing or not a valid email address.');
  }
  try {
    validatePassword(password);
  } catch (err) {
    throw new Error(
      `ADMIN_PASSWORD: ${err.message}` +
      (password.length < 10 ? ' (In .env, a # starts a comment unless the value is in double quotes.)' : '')
    );
  }

  const db = getDb();
  const existing = userRepository.findByEmail(email);

  // Nothing to do if this account is already the one active administrator
  // with this password — keeps server restarts from writing audit noise.
  if (
    existing &&
    existing.role === 'ADMINISTRATOR' &&
    existing.active &&
    bcrypt.compareSync(password, existing.password_hash) &&
    userRepository.listActiveAdminsExcept(existing.id).length === 0
  ) {
    return { user: existing, changed: false, deactivated: [] };
  }

  const run = db.transaction(() => {
    const others = userRepository.listActiveAdminsExcept(existing?.id);
    // Deactivate the others first so the single-administrator index allows
    // this account to become active.
    for (const other of others) {
      userRepository.setActive(other.id, false);
    }

    const hash = bcrypt.hashSync(password, config.bcryptRounds);
    let admin;
    if (existing) {
      db.prepare(
        `UPDATE users
         SET role = 'ADMINISTRATOR', active = 1, password_hash = ?, first_name = ?, surname = ?
         WHERE id = ?`
      ).run(hash, firstName, surname, existing.id);
      // Staff scope does not apply to the administrator.
      db.prepare(`DELETE FROM staff_qualifications WHERE user_id = ?`).run(existing.id);
      admin = userRepository.findById(existing.id);
    } else {
      admin = userRepository.create({
        email, passwordHash: hash, firstName, surname, role: 'ADMINISTRATOR',
      });
    }

    for (const other of others) {
      userAuditRepository.insert({
        actor: null, target: other, action: 'USER_DEACTIVATED',
        detail: `Replaced as administrator by ${admin.email} (seed:admin)`,
      });
    }
    userAuditRepository.insert({
      actor: null, target: admin,
      action: existing ? 'ADMIN_UPDATED' : 'ADMIN_CREATED',
      detail: existing && existing.role !== 'ADMINISTRATOR'
        ? `Promoted from ${existing.role} by seed:admin`
        : 'Set by seed:admin',
    });

    return { admin, others };
  });

  const { admin, others } = run();

  if (!quiet) {
    console.log(`Administrator ready: ${admin.email} (${admin.first_name} ${admin.surname})`);
    if (others.length) {
      console.log('Deactivated previous administrator account(s):');
      for (const o of others) console.log(`  ${o.email}`);
    }
  }
  return { user: admin, changed: true, deactivated: others };
}

// Allow `node src/db/seedAdmin.js`
if (process.argv[1] && process.argv[1].endsWith('seedAdmin.js')) {
  try {
    seedAdmin();
    process.exit(0);
  } catch (err) {
    console.error(`seed:admin failed: ${err.message}`);
    process.exit(1);
  }
}
