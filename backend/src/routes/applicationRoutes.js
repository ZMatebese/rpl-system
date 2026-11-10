import { Router } from 'express';
import fs from 'node:fs';
import { authenticate, authorise } from '../middleware/auth.js';
import { handleUpload } from '../middleware/upload.js';
import { applicationService } from '../services/applicationService.js';
import { evidenceService } from '../services/evidenceService.js';
import { assessmentService } from '../services/assessmentService.js';
import { moderationService } from '../services/moderationService.js';
import { qualificationRepository } from '../repositories/qualificationRepository.js';
import { ROLE, STATUS } from '../services/stateMachine.js';

const router = Router();

// Every route below this line requires a valid bearer token.
router.use(authenticate);

// Route handlers translate HTTP into one service call. They hold no domain
// rules and issue no SQL.
const handle = (fn) => (req, res, next) => {
  try { fn(req, res); } catch (err) { next(err); }
};

// --- reference data -------------------------------------------------------
router.get('/qualifications', handle((req, res) => {
  res.json({ qualifications: qualificationRepository.listActive() });
}));

router.get('/assessment-criteria', handle((req, res) => {
  res.json({ criteria: assessmentService.criteria() });
}));

// --- applicant ------------------------------------------------------------
router.post('/applications', authorise(ROLE.APPLICANT), handle((req, res) => {
  const { qualificationId, motivation } = req.body ?? {};
  res.status(201).json({ application: applicationService.create({ qualificationId, motivation }, req.user) });
}));

router.get('/applications/mine', authorise(ROLE.APPLICANT), handle((req, res) => {
  res.json({ applications: applicationService.listMine(req.user) });
}));

router.patch('/applications/:id', authorise(ROLE.APPLICANT), handle((req, res) => {
  const { qualificationId, motivation } = req.body ?? {};
  res.json({
    application: applicationService.updateDraft(
      Number(req.params.id), { qualificationId, motivation }, req.user
    ),
  });
}));

router.post('/applications/:id/submit', authorise(ROLE.APPLICANT), handle((req, res) => {
  res.json({
    application: applicationService.requestTransition(
      Number(req.params.id), STATUS.SUBMITTED, req.user
    ),
  });
}));

// --- evidence -------------------------------------------------------------
router.post(
  '/applications/:id/evidence',
  authorise(ROLE.APPLICANT),
  handleUpload,
  handle((req, res) => {
    const evidence = evidenceService.attach({
      applicationId: Number(req.params.id),
      file: req.file,
      evidenceType: req.body?.evidenceType,
      description: req.body?.description,
    }, req.user);
    res.status(201).json({ evidence });
  })
);

router.get('/applications/:id/evidence', handle((req, res) => {
  res.json({ evidence: evidenceService.listFor(Number(req.params.id), req.user) });
}));

// Evidence is streamed through this authorised endpoint. Nothing in the
// upload directory is reachable by URL.
router.get('/evidence/:id/download', handle((req, res) => {
  const { evidence, absolutePath } = evidenceService.resolveForDownload(
    Number(req.params.id), req.user
  );
  res.setHeader('Content-Type', evidence.mime_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(evidence.original_filename)}"`
  );
  fs.createReadStream(absolutePath).pipe(res);
}));

router.delete('/evidence/:id', authorise(ROLE.APPLICANT), handle((req, res) => {
  evidenceService.remove(Number(req.params.id), req.user);
  res.status(204).end();
}));

// --- assessor -------------------------------------------------------------
router.get('/applications/allocated', authorise(ROLE.ASSESSOR), handle((req, res) => {
  res.json({ applications: applicationService.listAllocated(req.user) });
}));

router.post('/applications/:id/assessment', authorise(ROLE.ASSESSOR), handle((req, res) => {
  const { criterionRatings, comments, recommendation } = req.body ?? {};
  const result = assessmentService.record({
    applicationId: Number(req.params.id), criterionRatings, comments, recommendation,
  }, req.user);
  res.status(201).json(result);
}));

router.get('/applications/:id/assessment', handle((req, res) => {
  res.json({ assessments: assessmentService.listFor(Number(req.params.id), req.user) });
}));

// --- moderator ------------------------------------------------------------
router.get('/applications/moderation', authorise(ROLE.MODERATOR), handle((req, res) => {
  res.json({ applications: applicationService.listForModeration(req.user) });
}));

router.post('/applications/:id/moderation', authorise(ROLE.MODERATOR), handle((req, res) => {
  const { verdict, comments } = req.body ?? {};
  res.status(201).json({
    moderation: moderationService.record(
      { applicationId: Number(req.params.id), verdict, comments }, req.user
    ),
  });
}));

router.get('/applications/:id/moderation', handle((req, res) => {
  res.json({ moderations: moderationService.listFor(Number(req.params.id), req.user) });
}));

// --- administrator --------------------------------------------------------
router.get('/applications/queue', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  res.json({ applications: applicationService.listQueue(req.query.status || STATUS.SUBMITTED) });
}));

router.get('/applications', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  res.json({ applications: applicationService.listAll() });
}));

router.post('/applications/:id/allocate', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  const { assessorId } = req.body ?? {};
  res.json({
    application: applicationService.allocateAssessor(
      Number(req.params.id), Number(assessorId), req.user
    ),
  });
}));

router.post('/applications/:id/return', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  res.json({
    application: applicationService.returnToDraft(
      Number(req.params.id), req.user, req.body?.note
    ),
  });
}));

router.post('/applications/:id/outcome', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  const { decision, rationale } = req.body ?? {};
  res.json({
    application: applicationService.recordOutcome(
      Number(req.params.id), decision, rationale, req.user
    ),
  });
}));

router.get('/statistics', authorise(ROLE.ADMINISTRATOR), handle((req, res) => {
  res.json(applicationService.statistics());
}));

// --- shared: single application and its audit trail -----------------------
// Declared after the literal paths above so that /applications/queue and
// /applications/mine are not captured by /applications/:id.
router.get('/applications/:id', handle((req, res) => {
  res.json({ application: applicationService.getForActor(Number(req.params.id), req.user) });
}));

router.get('/applications/:id/audit', handle((req, res) => {
  res.json({ history: applicationService.getAuditTrail(Number(req.params.id), req.user) });
}));

export default router;
