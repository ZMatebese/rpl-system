import { getDb } from '../db/index.js';

export const qualificationRepository = {
  findById(id) {
    return getDb().prepare(`SELECT * FROM qualifications WHERE id = ?`).get(id);
  },

  listActive() {
    return getDb()
      .prepare(`SELECT * FROM qualifications WHERE active = 1 ORDER BY nqf_level, title`)
      .all();
  },
};
