/**
 * Domain error carrying the HTTP status that the refusal should produce.
 * Refusal behaviour is part of the API contract:
 *   403 — authorisation failure (wrong role, or not the allocated assessor)
 *   409 — illegal state transition from the application's current state
 *   422 — a guard condition failed (the transition is legal but preconditions
 *         are not met)
 */
export class AppError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest   = (m, c) => new AppError(400, m, c);
export const unauthorised = (m = 'Authentication required', c) => new AppError(401, m, c);
export const forbidden    = (m = 'Not permitted', c) => new AppError(403, m, c);
export const notFound     = (m = 'Not found', c) => new AppError(404, m, c);
export const conflict     = (m, c) => new AppError(409, m, c);
export const unprocessable= (m, c) => new AppError(422, m, c);
export const payloadTooLarge = (m, c) => new AppError(413, m, c);
export const unsupportedMedia = (m, c) => new AppError(415, m, c);
