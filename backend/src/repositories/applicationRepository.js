import { getDb } from '../db/index.js';

const SELECT_WITH_JOINS = `
  SELECT a.*,
         q.title       AS qualification_title,
         q.saqa_id     AS qualification_saqa_id,
         q.nqf_level   AS qualification_nqf_level,
         q.faculty     AS qualification_faculty,
         q.rpl_type    AS qualification_rpl_type,
         ap.first_name AS applicant_first_name,
         ap.surname    AS applicant_surname,
         ap.email      AS applicant_email,
         asr.first_name AS assessor_first_name,
         asr.surname    AS assessor_surname,
         (SELECT COUNT(*) FROM evidence e WHERE e.application_id = a.id) AS evidence_count
  FROM applications a
  JOIN qualifications q ON q.id = a.qualification_id
  JOIN users ap         ON ap.id = a.applicant_id
  LEFT JOIN users asr   ON asr.id = a.assigned_assessor_id
`;

export const applicationRepository = {
  findById(id) {
    return getDb().prepare(`${SELECT_WITH_JOINS} WHERE a.id = ?`).get(id);
  },

  /** Raw row without joins — used by the state machine, which needs only the
   *  canonical columns and must not be coupled to presentation joins. */
  findRawById(id) {
    return getDb().prepare(`SELECT * FROM applications WHERE id = ?`).get(id);
  },

  create({ applicantId, qualificationId, rplRoute = 'ACCESS', motivation = '' }) {
    const info = getDb()
      .prepare(
        `INSERT INTO applications (applicant_id, qualification_id, rpl_route, motivation)
         VALUES (?, ?, ?, ?)`
      )
      .run(applicantId, qualificationId, rplRoute, motivation);
    return this.findById(info.lastInsertRowid);
  },

  listByApplicant(applicantId) {
    return getDb()
      .prepare(`${SELECT_WITH_JOINS} WHERE a.applicant_id = ? ORDER BY a.updated_at DESC`)
      .all(applicantId);
  },

  listByAssessor(assessorId) {
    return getDb()
      .prepare(
        `${SELECT_WITH_JOINS}
         WHERE a.assigned_assessor_id = ?
           AND a.status IN ('UNDER_REVIEW','ASSESSMENT_COMPLETE','APPROVED','REJECTED')
         ORDER BY a.updated_at DESC`
      )
      .all(assessorId);
  },

  listByStatus(status) {
    return getDb()
      .prepare(`${SELECT_WITH_JOINS} WHERE a.status = ? ORDER BY a.updated_at ASC`)
      .all(status);
  },

  listByStatuses(statuses) {
    const placeholders = statuses.map(() => '?').join(', ');
    return getDb()
      .prepare(`${SELECT_WITH_JOINS} WHERE a.status IN (${placeholders}) ORDER BY a.updated_at DESC`)
      .all(...statuses);
  },

  listAll() {
    return getDb().prepare(`${SELECT_WITH_JOINS} ORDER BY a.updated_at DESC`).all();
  },

  updateDraft(id, { qualificationId, rplRoute, motivation }) {
    getDb()
      .prepare(
        `UPDATE applications
         SET qualification_id = COALESCE(?, qualification_id),
             rpl_route        = COALESCE(?, rpl_route),
             motivation       = COALESCE(?, motivation),
             updated_at       = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(qualificationId ?? null, rplRoute ?? null, motivation ?? null, id);
    return this.findById(id);
  },

  /** Status is never set directly by callers outside ApplicationService —
   *  every change goes through the guarded transition, which pairs this with
   *  an audit insert inside one transaction. */
  updateStatus(id, status) {
    getDb()
      .prepare(`UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, id);
  },

  assignAssessor(id, assessorId) {
    getDb()
      .prepare(
        `UPDATE applications SET assigned_assessor_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(assessorId, id);
  },

  setOutcomeRationale(id, rationale) {
    getDb()
      .prepare(
        `UPDATE applications SET outcome_rationale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(rationale, id);
  },

  countsByStatus() {
    return getDb()
      .prepare(`SELECT status, COUNT(*) AS count FROM applications GROUP BY status`)
      .all();
  },
};
