import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Rate limiting on the authentication endpoints, closing the brute-force
// exposure identified in the security evaluation.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Try again later.' } },
});

router.post('/register', authLimiter, (req, res, next) => {
  try {
    res.status(201).json(authService.register(req.body ?? {}));
  } catch (err) { next(err); }
});

router.post('/login', authLimiter, (req, res, next) => {
  try {
    res.json(authService.login(req.body ?? {}));
  } catch (err) { next(err); }
});

router.get('/me', authenticate, (req, res, next) => {
  try {
    res.json({ user: authService.me(req.user.id) });
  } catch (err) { next(err); }
});

export default router;
