import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config/index.js';
import { payloadTooLarge, unsupportedMedia } from '../utils/AppError.js';

const tempDir = path.join(os.tmpdir(), 'rpl-uploads');
fs.mkdirSync(tempDir, { recursive: true });

/**
 * Multer handles multipart parsing only. It writes to a temporary location;
 * validation, renaming and the move into the evidence store are the service
 * layer's responsibility, so those rules stay testable without HTTP.
 */
export const uploadEvidence = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempDir),
    filename: (req, file, cb) =>
      cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    // A first-pass rejection so oversized or wrong-typed content is not
    // written to disk at all. The service re-checks regardless.
    if (!config.allowedMimeTypes.includes(file.mimetype)) {
      return cb(unsupportedMedia(`File type ${file.mimetype} is not accepted.`));
    }
    cb(null, true);
  },
}).single('file');

/** Wraps Multer so its own errors become domain errors with the right status. */
export function handleUpload(req, res, next) {
  uploadEvidence(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(payloadTooLarge('Evidence files are limited to 10 MB.'));
      }
      return next(payloadTooLarge(err.message));
    }
    next(err);
  });
}
