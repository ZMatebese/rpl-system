import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // In production this MUST come from the environment. The fallback exists so
  // the prototype runs out of the box; server.js refuses to start in
  // production if the fallback is still in use.
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',

  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,

  dbPath: process.env.DB_PATH || path.join(BACKEND_ROOT, 'data', 'rpl.db'),

  // Evidence files live outside any statically served directory. Nothing here
  // is reachable by URL; files are streamed through an authorised endpoint.
  uploadDir: process.env.UPLOAD_DIR || path.join(BACKEND_ROOT, 'uploads'),
  maxUploadBytes: 10 * 1024 * 1024,
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export const DEFAULT_JWT_SECRET = 'dev-only-insecure-secret-change-me';
