import { authService } from '../services/authService.js';
import { userRepository } from '../repositories/userRepository.js';
import { unauthorised, forbidden } from '../utils/AppError.js';

/**
 * Step 2 of the middleware chain: verify the JWT and resolve the caller.
 *
 * The role used for every downstream decision is read from the database
 * record, not from the token claim. This closes the window in which a token
 * issued before a role change would still carry the old role — the known
 * revocation limitation is narrowed to the token's validity, not its
 * authority.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorised('A bearer token is required.'));
  }

  try {
    const claims = authService.verifyToken(token);
    const user = userRepository.findById(claims.sub);
    if (!user) return next(unauthorised('Account no longer exists.'));
    // Deactivation takes effect on the next request, not when the token expires.
    if (!user.active) return next(unauthorised('This account has been deactivated.', 'ACCOUNT_INACTIVE'));

    req.user = { id: user.id, role: user.role, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Step 3 of the chain: role authorisation, applied as middleware positioned
 * ahead of every protected route handler. An unauthorised request terminates
 * here, before any business logic or database access executes.
 */
export function authorise(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorised());
    if (!roles.includes(req.user.role)) {
      return next(
        forbidden(`This operation requires one of: ${roles.join(', ')}.`, 'ROLE_NOT_PERMITTED')
      );
    }
    next();
  };
}
