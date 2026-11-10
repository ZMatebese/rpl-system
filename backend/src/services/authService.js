import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { userRepository } from '../repositories/userRepository.js';
import { badRequest, conflict, unauthorised, forbidden } from '../utils/AppError.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sanitiseUser(user) {
  if (!user) return null;
  // password_hash is never returned to any caller, under any role.
  const { password_hash, ...safe } = user;
  return safe;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw badRequest('Password must be at least 10 characters.');
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw badRequest('Password must contain upper case, lower case and a digit.');
  }
}

export const authService = {
  register({ email, password, firstName, surname }) {
    if (!EMAIL_RE.test(email ?? '')) throw badRequest('A valid email address is required.');
    if (!firstName?.trim() || !surname?.trim()) {
      throw badRequest('First name and surname are required.');
    }
    validatePassword(password);

    if (userRepository.findByEmail(email)) {
      throw conflict('An account with that email already exists.');
    }

    // Role is never taken from the registration payload. Elevation to Assessor
    // or Administrator is an administrator action, never self-service.
    const user = userRepository.create({
      email: email.toLowerCase().trim(),
      passwordHash: bcrypt.hashSync(password, config.bcryptRounds),
      firstName: firstName.trim(),
      surname: surname.trim(),
      role: 'APPLICANT',
    });

    return { user: sanitiseUser(user), token: this.issueToken(user) };
  },

  login({ email, password }) {
    const user = userRepository.findByEmail((email ?? '').toLowerCase().trim());

    // The failure response is deliberately uniform for unknown-email and
    // wrong-password, so the endpoint does not disclose which accounts exist.
    // bcrypt.compareSync is still run against a dummy hash when the user is
    // absent, so response timing does not leak existence either.
    const hash = user?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = bcrypt.compareSync(password ?? '', hash);

    if (!user || !ok) throw unauthorised('Invalid email or password.');

    // Checked only after the password is verified, so a deactivated account is
    // not disclosed to someone who does not know its password.
    if (!user.active) {
      throw forbidden('This account has been deactivated. Contact the RPL administrator.', 'ACCOUNT_INACTIVE');
    }

    return { user: sanitiseUser(user), token: this.issueToken(user) };
  },

  issueToken(user) {
    return jwt.sign(
      { sub: user.id, role: user.role, email: user.email },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
  },

  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorised('Invalid or expired token.');
    }
  },

  me(userId) {
    return sanitiseUser(userRepository.findById(userId));
  },
};
