import { getDb } from '../db/index.js';

/** Append-only: insert and read. Nothing updates or deletes a moderation. */
export const moderationRepository = {
  create({ applicationId, moderatorId, verdict, comments }) {
    const info = getDb()
      .prepare(
        `INSERT INTO moderations (application_id, moderator_id, verdict, comments)
         VALUES (?, ?, ?, ?)`
      )
      .run(applicationId, moderatorId, verdict, comments);
    return this.findById(info.lastInsertRowid);
  },

  findById(id) {
    return getDb()
      .prepare(
        `SELECT m.*, u.first_name AS moderator_first_name, u.surname AS moderator_surname
         FROM moderations m JOIN users u ON u.id = m.moderator_id
         WHERE m.id = ?`
      )
      .get(id);
  },

  listByApplication(applicationId) {
    return getDb()
      .prepare(
        `SELECT m.*, u.first_name AS moderator_first_name, u.surname AS moderator_surname
         FROM moderations m JOIN users u ON u.id = m.moderator_id
         WHERE m.application_id = ?
         ORDER BY m.created_at DESC, m.id DESC`
      )
      .all(applicationId);
  },
};
