import { getDb } from '../db/index.js';

/** Which qualifications an assessor or moderator is scoped to. */
export const staffScopeRepository = {
  listForUser(userId) {
    return getDb()
      .prepare(`SELECT qualification_id FROM staff_qualifications WHERE user_id = ? ORDER BY qualification_id`)
      .all(userId)
      .map((r) => r.qualification_id);
  },

  covers(userId, qualificationId) {
    return Boolean(
      getDb()
        .prepare(`SELECT 1 AS ok FROM staff_qualifications WHERE user_id = ? AND qualification_id = ?`)
        .get(userId, qualificationId)
    );
  },

  /** Replaces the whole scope. Callers wrap this in a transaction. */
  replace(userId, qualificationIds) {
    const db = getDb();
    db.prepare(`DELETE FROM staff_qualifications WHERE user_id = ?`).run(userId);
    const insert = db.prepare(
      `INSERT INTO staff_qualifications (user_id, qualification_id) VALUES (?, ?)`
    );
    for (const qid of qualificationIds) insert.run(userId, qid);
  },
};
