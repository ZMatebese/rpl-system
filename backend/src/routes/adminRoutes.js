import { Router } from 'express';
import { authenticate, authorise } from '../middleware/auth.js';
import { adminService } from '../services/adminService.js';
import { ROLE } from '../services/stateMachine.js';

const router = Router();

// Every route here needs a valid token AND the administrator role.
router.use(authenticate, authorise(ROLE.ADMINISTRATOR));

const handle = (fn) => (req, res, next) => {
  try { fn(req, res); } catch (err) { next(err); }
};

// Assessors for the allocation picker. ?qualificationId= narrows the list to
// assessors scoped to that qualification.
router.get('/assessors', handle((req, res) => {
  res.json({ assessors: adminService.listAssessors(req.query.qualificationId) });
}));

// --- read ------------------------------------------------------------------
router.get('/users', handle((req, res) => {
  res.json({ users: adminService.listUsers() });
}));

router.get('/audit', handle((req, res) => {
  res.json({ entries: adminService.auditLog() });
}));

// --- write -----------------------------------------------------------------
router.post('/users', handle((req, res) => {
  res.status(201).json({ user: adminService.createStaff(req.body ?? {}, req.user) });
}));

router.patch('/users/:id', handle((req, res) => {
  res.json({ user: adminService.updateDetails(Number(req.params.id), req.body ?? {}, req.user) });
}));

router.patch('/users/:id/role', handle((req, res) => {
  res.json({ user: adminService.changeRole(Number(req.params.id), req.body?.role, req.user) });
}));

router.put('/users/:id/qualifications', handle((req, res) => {
  res.json({
    user: adminService.setQualifications(Number(req.params.id), req.body?.qualificationIds, req.user),
  });
}));

router.patch('/users/:id/status', handle((req, res) => {
  res.json({ user: adminService.setActive(Number(req.params.id), req.body?.active, req.user) });
}));

router.post('/users/:id/password', handle((req, res) => {
  res.json({ user: adminService.resetPassword(Number(req.params.id), req.body?.password, req.user) });
}));

// --- delete ----------------------------------------------------------------
router.delete('/users/:id', handle((req, res) => {
  adminService.deleteUser(Number(req.params.id), req.user);
  res.status(204).end();
}));

export default router;
