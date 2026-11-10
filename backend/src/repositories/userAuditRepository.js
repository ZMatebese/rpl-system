import { getDb } from '../db/index.js';

/**
 * Account-change log. Insert and read only, like the application audit trail.
 * The target's email is copied into the row so the entry stays meaningful
 * after the account it describes has been deleted.
 */
export const userAuditRepository = {
  insert({ actor, target, action, detail = null }) {
    getDb()
      .prepare(
        `INSERT INTO user_audit_log
           (actor_id, actor_email, target_user_id, target_email, action, detail)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        actor?.id ?? null,
        actor?.email ?? null,
        target?.id ?? null,
        target?.email ?? null,
        action,
        detail
      );
  },

  list({ limit = 200 } = {}) {
    return getDb()
      .prepare(`SELECT * FROM user_audit_log ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(limit);
  },
};
