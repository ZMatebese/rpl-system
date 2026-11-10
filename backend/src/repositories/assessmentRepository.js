import { getDb } from '../db/index.js';

export const assessmentRepository = {
  findById(id) {
    return getDb().prepare(`SELECT * FROM assessments WHERE id = ?`).get(id);
  },

  create({ applicationId, assessorId, criterionRatings, comments, recommendation }) {
    const info = getDb()
      .prepare(
        `INSERT INTO assessments
           (application_id, assessor_id, criterion_ratings, comments, recommendation)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        applicationId,
        assessorId,
        JSON.stringify(criterionRatings),
        comments,
        recommendation
      );
    return this.findById(info.lastInsertRowid);
  },

  /** Assessments are append-only. A correction supersedes rather than
   *  overwrites, so the original judgement remains recoverable at audit. */
  markSuperseded(applicationId) {
    getDb()
      .prepare(`UPDATE assessments SET superseded = 1 WHERE application_id = ?`)
      .run(applicationId);
  },

  listByApplication(applicationId) {
    return getDb()
      .prepare(
        `SELECT a.*, u.first_name AS assessor_first_name, u.surname AS assessor_surname
         FROM assessments a
         JOIN users u ON u.id = a.assessor_id
         WHERE a.application_id = ?
         ORDER BY a.created_at DESC`
      )
      .all(applicationId);
  },

  findCurrentForApplication(applicationId) {
    return getDb()
      .prepare(
        `SELECT a.*, u.first_name AS assessor_first_name, u.surname AS assessor_surname
         FROM assessments a
         JOIN users u ON u.id = a.assessor_id
         WHERE a.application_id = ? AND a.superseded = 0
         ORDER BY a.created_at DESC LIMIT 1`
      )
      .get(applicationId);
  },
};
