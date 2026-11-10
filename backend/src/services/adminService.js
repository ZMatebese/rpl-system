import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { config } from '../config/index.js';
import { userRepository } from '../repositories/userRepository.js';
import { staffScopeRepository } from '../repositories/staffScopeRepository.js';
import { qualificationRepository } from '../repositories/qualificationRepository.js';
import { userAuditRepository } from '../repositories/userAuditRepository.js';
import { sanitiseUser, validatePassword, EMAIL_RE } from './authService.js';
import { ROLE } from './stateMachine.js';
import {
  badRequest, conflict, forbidden, notFound, unprocessable,
} from '../utils/AppError.js';

/**
 * Account management for the single administrator.
 *
 * The administrator can read, create, update, deactivate and delete accounts,
 * with three fixed limits:
 *   - no route grants or removes the ADMINISTRATOR role (only the seed:admin
 *     script on the server does), so there is exactly one administrator;
 *   - the administrator's own account cannot be changed or deleted here;
 *   - an account that appears in any application record is deactivated, not
 *     deleted, so the institutional record never points at a missing person.
 * Every change is written to user_audit_log in the same transaction.
 */

/** Roles the administrator may hand out. ADMINISTRATOR is deliberately absent. */
export const ASSIGNABLE_ROLES = [ROLE.APPLICANT, ROLE.ASSESSOR, ROLE.MODERATOR];
const STAFF_ROLES = [ROLE.ASSESSOR, ROLE.MODERATOR];

function withScope(user) {
  if (!user) return user;
  const safe = sanitiseUser(user);
  return {
    ...safe,
    active: Boolean(safe.active),
    qualificationIds: STAFF_ROLES.includes(safe.role)
      ? staffScopeRepository.listForUser(safe.id)
      : [],
  };
}

function loadTarget(userId) {
  const user = userRepository.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.role === ROLE.ADMINISTRATOR) {
    throw forbidden(
      'The administrator account cannot be changed from the application. Use the seed:admin script on the server.',
      'ADMIN_PROTECTED'
    );
  }
  return user;
}

function validateQualificationIds(ids) {
  if (!Array.isArray(ids)) throw badRequest('qualificationIds must be an array.');
  const unique = [...new Set(ids.map(Number))];
  for (const id of unique) {
    if (!Number.isInteger(id) || !qualificationRepository.findById(id)) {
      throw badRequest(`Unknown qualification: ${id}.`);
    }
  }
  return unique;
}

function qualificationTitles(ids) {
  return ids.map((id) => qualificationRepository.findById(id)?.title ?? `#${id}`).join('; ') || 'none';
}

export const adminService = {
  // ----- read --------------------------------------------------------------
  listUsers() {
    return userRepository.listAll().map(withScope);
  },

  getUser(userId) {
    const user = userRepository.findById(userId);
    if (!user) throw notFound('User not found');
    return withScope(user);
  },

  /** Active assessors for the allocation picker, optionally only those
   *  scoped to the application's qualification. */
  listAssessors(qualificationId) {
    return userRepository.listActiveAssessors(qualificationId ? Number(qualificationId) : null);
  },

  auditLog() {
    return userAuditRepository.list();
  },

  // ----- create ------------------------------------------------------------
  createStaff({ email, firstName, surname, role, password, qualificationIds = [] }, actor) {
    if (!STAFF_ROLES.includes(role)) {
      throw badRequest(`Staff accounts must be one of: ${STAFF_ROLES.join(', ')}.`);
    }
    if (!EMAIL_RE.test(email ?? '')) throw badRequest('A valid email address is required.');
    if (!firstName?.trim() || !surname?.trim()) {
      throw badRequest('First name and surname are required.');
    }
    validatePassword(password);
    const scope = validateQualificationIds(qualificationIds);

    const normalisedEmail = email.toLowerCase().trim();
    if (userRepository.findByEmail(normalisedEmail)) {
      throw conflict('An account with that email already exists.');
    }

    const run = getDb().transaction(() => {
      const user = userRepository.create({
        email: normalisedEmail,
        passwordHash: bcrypt.hashSync(password, config.bcryptRounds),
        firstName: firstName.trim(),
        surname: surname.trim(),
        role,
      });
      staffScopeRepository.replace(user.id, scope);
      userAuditRepository.insert({
        actor, target: user, action: 'USER_CREATED',
        detail: `Role ${role}; qualifications: ${qualificationTitles(scope)}`,
      });
      return user;
    });
    return withScope(run());
  },

  // ----- update ------------------------------------------------------------
  changeRole(userId, role, actor) {
    if (role === ROLE.ADMINISTRATOR) {
      throw forbidden(
        'The administrator role cannot be granted from the application. There is one administrator.',
        'ADMIN_NOT_ASSIGNABLE'
      );
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw badRequest(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`);
    }

    const user = loadTarget(userId);
    if (user.role === role) return withScope(user);

    // Taking the assessor role away from someone who still holds files under
    // review would strand those files with nobody able to assess them.
    if (user.role === ROLE.ASSESSOR) {
      const open = userRepository.countOpenAllocations(user.id);
      if (open > 0) {
        throw unprocessable(
          `${user.first_name} still has ${open} application(s) under review. ` +
          'Return those to the applicant or let them finish before changing the role.',
          'OPEN_ALLOCATIONS'
        );
      }
    }

    const run = getDb().transaction(() => {
      const updated = userRepository.updateRole(user.id, role);
      // Scope only means something for staff roles.
      if (!STAFF_ROLES.includes(role)) staffScopeRepository.replace(user.id, []);
      userAuditRepository.insert({
        actor, target: user, action: 'ROLE_CHANGED', detail: `${user.role} → ${role}`,
      });
      return updated;
    });
    return withScope(run());
  },

  setQualifications(userId, qualificationIds, actor) {
    const user = loadTarget(userId);
    if (!STAFF_ROLES.includes(user.role)) {
      throw unprocessable('Only assessors and moderators have qualification scope.');
    }
    const scope = validateQualificationIds(qualificationIds ?? []);

    const run = getDb().transaction(() => {
      staffScopeRepository.replace(user.id, scope);
      userAuditRepository.insert({
        actor, target: user, action: 'SCOPE_CHANGED',
        detail: `Qualifications: ${qualificationTitles(scope)}`,
      });
    });
    run();
    return withScope(userRepository.findById(user.id));
  },

  updateDetails(userId, { firstName, surname }, actor) {
    const user = loadTarget(userId);
    if (!firstName?.trim() || !surname?.trim()) {
      throw badRequest('First name and surname are required.');
    }
    const run = getDb().transaction(() => {
      userRepository.updateName(user.id, firstName.trim(), surname.trim());
      userAuditRepository.insert({
        actor, target: user, action: 'DETAILS_CHANGED',
        detail: `${user.first_name} ${user.surname} → ${firstName.trim()} ${surname.trim()}`,
      });
    });
    run();
    return withScope(userRepository.findById(user.id));
  },

  setActive(userId, active, actor) {
    if (typeof active !== 'boolean') throw badRequest('active must be true or false.');
    const user = loadTarget(userId);
    if (Boolean(user.active) === active) return withScope(user);

    if (!active && user.role === ROLE.ASSESSOR) {
      const open = userRepository.countOpenAllocations(user.id);
      if (open > 0) {
        throw unprocessable(
          `${user.first_name} still has ${open} application(s) under review. ` +
          'Return those to the applicant or let them finish before deactivating.',
          'OPEN_ALLOCATIONS'
        );
      }
    }

    const run = getDb().transaction(() => {
      const updated = userRepository.setActive(user.id, active);
      userAuditRepository.insert({
        actor, target: user, action: active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
      });
      return updated;
    });
    return withScope(run());
  },

  resetPassword(userId, password, actor) {
    const user = loadTarget(userId);
    validatePassword(password);
    const run = getDb().transaction(() => {
      userRepository.updatePassword(user.id, bcrypt.hashSync(password, config.bcryptRounds));
      userAuditRepository.insert({ actor, target: user, action: 'PASSWORD_RESET' });
    });
    run();
    return withScope(userRepository.findById(user.id));
  },

  // ----- delete ------------------------------------------------------------
  /**
   * Hard delete, permitted only for an account with no footprint in the
   * record (for example a staff account created by mistake). Anything else
   * must be deactivated, which blocks sign-in but keeps the history intact.
   */
  deleteUser(userId, actor) {
    const user = loadTarget(userId);

    const counts = userRepository.recordCounts(user.id);
    const used = Object.entries(counts).filter(([, n]) => n > 0);
    if (used.length) {
      throw conflict(
        `${user.first_name} ${user.surname} appears in the record ` +
        `(${used.map(([k, n]) => `${n} ${k}`).join(', ')}), so the account cannot be deleted. ` +
        'Deactivate it instead.',
        'HAS_RECORDS'
      );
    }

    const run = getDb().transaction(() => {
      userAuditRepository.insert({
        actor, target: user, action: 'USER_DELETED',
        detail: `${user.first_name} ${user.surname}, role ${user.role}`,
      });
      userRepository.delete(user.id); // scope rows go with it (ON DELETE CASCADE)
    });
    run();
  },
};
