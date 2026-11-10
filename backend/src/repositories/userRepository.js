import { getDb } from '../db/index.js';

// The repository layer is the only code permitted to issue SQL, and every
// statement is parameterised. No query anywhere is built by string
// concatenation of user input.

const PUBLIC_COLUMNS = `id, email, first_name, surname, role, active, created_at`;

export const userRepository = {
  findById(id) {
    return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  },

  findByEmail(email) {
    return getDb().prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  },

  create({ email, passwordHash, firstName, surname, role = 'APPLICANT' }) {
    const info = getDb()
      .prepare(
        `INSERT INTO users (email, password_hash, first_name, surname, role)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(email, passwordHash, firstName, surname, role);
    return this.findById(info.lastInsertRowid);
  },

  updateRole(id, role) {
    getDb().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
    return this.findById(id);
  },

  setActive(id, active) {
    getDb().prepare(`UPDATE users SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
    return this.findById(id);
  },

  updatePassword(id, passwordHash) {
    getDb().prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
  },

  updateName(id, firstName, surname) {
    getDb()
      .prepare(`UPDATE users SET first_name = ?, surname = ? WHERE id = ?`)
      .run(firstName, surname, id);
  },

  delete(id) {
    getDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
  },

  /** Active administrators other than the given id (the single-admin rule
   *  means there is normally none). */
  listActiveAdminsExcept(id) {
    return getDb()
      .prepare(
        `SELECT ${PUBLIC_COLUMNS} FROM users
         WHERE role = 'ADMINISTRATOR' AND active = 1 AND id <> ?`
      )
      .all(id ?? -1);
  },

  countActiveAdmins() {
    return getDb()
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'ADMINISTRATOR' AND active = 1`)
      .get().n;
  },

  /**
   * Whether the account appears anywhere in the institutional record. An
   * account that does cannot be deleted, only deactivated, so applications,
   * assessments and audit rows never refer to a person who no longer exists.
   */
  recordCounts(id) {
    return getDb()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM applications WHERE applicant_id = ?)              AS applications,
           (SELECT COUNT(*) FROM applications WHERE assigned_assessor_id = ?)      AS allocations,
           (SELECT COUNT(*) FROM assessments  WHERE assessor_id = ?)               AS assessments,
           (SELECT COUNT(*) FROM moderations  WHERE moderator_id = ?)              AS moderations,
           (SELECT COUNT(*) FROM evidence     WHERE uploaded_by = ?)               AS evidence,
           (SELECT COUNT(*) FROM application_status_history WHERE actor_id = ?)    AS history`
      )
      .get(id, id, id, id, id, id);
  },

  /** Applications currently in review with this assessor. */
  countOpenAllocations(id) {
    return getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM applications
         WHERE assigned_assessor_id = ? AND status = 'UNDER_REVIEW'`
      )
      .get(id).n;
  },

  listByRole(role) {
    return getDb()
      .prepare(
        `SELECT ${PUBLIC_COLUMNS}
         FROM users WHERE role = ? ORDER BY surname, first_name`
      )
      .all(role);
  },

  /** Active assessors, optionally only those scoped to a qualification. */
  listActiveAssessors(qualificationId) {
    if (qualificationId) {
      return getDb()
        .prepare(
          `SELECT u.id, u.email, u.first_name, u.surname, u.role, u.active, u.created_at
           FROM users u
           JOIN staff_qualifications sq ON sq.user_id = u.id
           WHERE u.role = 'ASSESSOR' AND u.active = 1 AND sq.qualification_id = ?
           ORDER BY u.surname, u.first_name`
        )
        .all(qualificationId);
    }
    return getDb()
      .prepare(
        `SELECT ${PUBLIC_COLUMNS} FROM users
         WHERE role = 'ASSESSOR' AND active = 1 ORDER BY surname, first_name`
      )
      .all();
  },

  listAll() {
    return getDb()
      .prepare(
        `SELECT ${PUBLIC_COLUMNS}
         FROM users ORDER BY role, surname, first_name`
      )
      .all();
  },
};
