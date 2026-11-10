import { getDb } from '../db/index.js';

export const evidenceRepository = {
  findById(id) {
    return getDb().prepare(`SELECT * FROM evidence WHERE id = ?`).get(id);
  },

  create({
    applicationId,
    originalFilename,
    storedFilename,
    mimeType,
    sizeBytes,
    evidenceType = 'OTHER',
    description = null,
    uploadedBy,
  }) {
    const info = getDb()
      .prepare(
        `INSERT INTO evidence
           (application_id, original_filename, stored_filename, mime_type,
            size_bytes, evidence_type, description, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        applicationId,
        originalFilename,
        storedFilename,
        mimeType,
        sizeBytes,
        evidenceType,
        description,
        uploadedBy
      );
    return this.findById(info.lastInsertRowid);
  },

  listByApplication(applicationId) {
    return getDb()
      .prepare(`SELECT * FROM evidence WHERE application_id = ? ORDER BY uploaded_at ASC`)
      .all(applicationId);
  },

  countByApplication(applicationId) {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM evidence WHERE application_id = ?`)
      .get(applicationId);
    return row.count;
  },

  delete(id) {
    getDb().prepare(`DELETE FROM evidence WHERE id = ?`).run(id);
  },
};
