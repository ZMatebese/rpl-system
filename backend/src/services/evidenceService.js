import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { evidenceRepository } from '../repositories/evidenceRepository.js';
import { applicationRepository } from '../repositories/applicationRepository.js';
import { STATUS } from './stateMachine.js';
import { mayReadApplication } from './accessPolicy.js';
import {
  forbidden, notFound, conflict, unsupportedMedia, badRequest,
} from '../utils/AppError.js';

const EXTENSION_BY_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export const evidenceService = {
  /**
   * Accepts an already-parsed upload (Multer has written it to a temporary
   * path). Validation, ownership and state checks happen here in the service,
   * not in request parsing, so the rules are testable without HTTP.
   */
  attach({ applicationId, file, evidenceType, description }, actor) {
    if (!file) throw badRequest('No file supplied.');

    const cleanup = () => {
      try { fs.unlinkSync(file.path); } catch { /* already gone */ }
    };

    if (!config.allowedMimeTypes.includes(file.mimetype)) {
      cleanup();
      throw unsupportedMedia(
        `File type ${file.mimetype} is not accepted. Allowed: PDF, JPEG, PNG, DOCX.`
      );
    }

    const application = applicationRepository.findRawById(applicationId);
    if (!application) { cleanup(); throw notFound('Application not found'); }

    if (application.applicant_id !== actor.id) {
      cleanup();
      throw forbidden('You do not own this application.');
    }
    if (application.status !== STATUS.DRAFT) {
      cleanup();
      throw conflict('Evidence may only be attached while the application is in DRAFT.');
    }

    // The client-supplied filename is discarded for storage. The stored name
    // is a generated UUID, so no uploaded file has a guessable path.
    const storedFilename = `${randomUUID()}${EXTENSION_BY_MIME[file.mimetype]}`;
    const destination = path.join(config.uploadDir, storedFilename);

    fs.mkdirSync(config.uploadDir, { recursive: true });
    fs.renameSync(file.path, destination);

    try {
      return evidenceRepository.create({
        applicationId,
        originalFilename: path.basename(file.originalname).slice(0, 255),
        storedFilename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        evidenceType: evidenceType || 'OTHER',
        description: description || null,
        uploadedBy: actor.id,
      });
    } catch (err) {
      // Keep the file store consistent with the database: if the row cannot be
      // written, the bytes do not stay on disk orphaned.
      try { fs.unlinkSync(destination); } catch { /* ignore */ }
      throw err;
    }
  },

  listFor(applicationId, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');
    this.assertMayRead(application, actor);
    return evidenceRepository.listByApplication(applicationId);
  },

  /**
   * Resolves an evidence item to a readable stream path, applying
   * authorisation first. Evidence is never served from a static directory —
   * every retrieval passes through this check.
   */
  resolveForDownload(evidenceId, actor) {
    const evidence = evidenceRepository.findById(evidenceId);
    if (!evidence) throw notFound('Evidence not found');

    const application = applicationRepository.findRawById(evidence.application_id);
    if (!application) throw notFound('Application not found');

    this.assertMayRead(application, actor);

    const absolutePath = path.join(config.uploadDir, evidence.stored_filename);

    // Defence in depth: confirm the resolved path is still inside the upload
    // directory before streaming anything.
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(path.resolve(config.uploadDir) + path.sep)) {
      throw forbidden('Invalid evidence path.');
    }
    if (!fs.existsSync(resolved)) throw notFound('Evidence file is missing from storage.');

    return { evidence, absolutePath: resolved };
  },

  remove(evidenceId, actor) {
    const evidence = evidenceRepository.findById(evidenceId);
    if (!evidence) throw notFound('Evidence not found');

    const application = applicationRepository.findRawById(evidence.application_id);
    if (application.applicant_id !== actor.id) {
      throw forbidden('You do not own this application.');
    }
    if (application.status !== STATUS.DRAFT) {
      throw conflict('Evidence may only be removed while the application is in DRAFT.');
    }

    evidenceRepository.delete(evidenceId);
    try {
      fs.unlinkSync(path.join(config.uploadDir, evidence.stored_filename));
    } catch { /* file already absent; the record is what matters */ }
  },

  assertMayRead(application, actor) {
    if (!mayReadApplication(application, actor)) {
      throw forbidden('You do not have access to this evidence.');
    }
  },
};
