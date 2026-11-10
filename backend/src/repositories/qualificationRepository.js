import { getDb } from '../db/index.js';

export const qualificationRepository = {
  findById(id) {
    return getDb().prepare(`SELECT * FROM qualifications WHERE id = ?`).get(id);
  },

  /** Qualifications open for RPL, grouped by faculty for the picker. */
  listActive() {
    return getDb()
      .prepare(`SELECT * FROM qualifications WHERE active = 1 ORDER BY faculty, title`)
      .all();
  },
};
