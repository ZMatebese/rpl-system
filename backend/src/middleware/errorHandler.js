import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { message: err.message, code: err.code },
    });
  }

  // SQLite constraint violations are a programming or input error, not
  // something to leak verbatim to the caller.
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return res.status(422).json({
      error: { message: 'The request violates a data constraint.', code: 'CONSTRAINT' },
    });
  }

  if (config.nodeEnv !== 'test') console.error(err);

  res.status(500).json({
    error: {
      message: 'An unexpected error occurred.',
      ...(config.nodeEnv === 'development' ? { detail: err.message } : {}),
    },
  });
}
