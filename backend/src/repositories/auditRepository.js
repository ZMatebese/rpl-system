import { getDb } from '../db/index.js';

/**
 * The audit repository exposes insert and read only. There is deliberately no
 * update or delete operation anywhere in the codebase for this table — the
 * trail is append-only by construction, not by convention.
 */
export const auditRepository = {
  insert({ applicationId, previousStatus, newStatus, actorId, note = null }) {
    getDb()
      .prepare(
        `INSERT INTO application_status_history
           (application_id, previous_status, new_status, actor_id, note)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(applicationId, previousStatus, newStatus, actorId, note);
  },

  listByApplication(applicationId) {
    return getDb()
      .prepare(
        `SELECT h.*,
                u.first_name AS actor_first_name,
                u.surname    AS actor_surname,
                u.role       AS actor_role
         FROM application_status_history h
         JOIN users u ON u.id = h.actor_id
         WHERE h.application_id = ?
         ORDER BY h.changed_at ASC, h.id ASC`
      )
      .all(applicationId);
  },
};
