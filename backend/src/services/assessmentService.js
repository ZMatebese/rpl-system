import { getDb } from '../db/index.js';
import { assessmentRepository } from '../repositories/assessmentRepository.js';
import { applicationRepository } from '../repositories/applicationRepository.js';
import { applicationService } from './applicationService.js';
import { STATUS, ROLE } from './stateMachine.js';
import { forbidden, notFound, conflict, unprocessable } from '../utils/AppError.js';
import { isModeratorInScope } from './accessPolicy.js';

/**
 * The institutional criteria set, held as configuration rather than hard-coded
 * into the form or the schema. A change to the criteria agreed with the RPL
 * coordinator is a change to this array.
 */
export const ASSESSMENT_CRITERIA = [
  { key: 'currency',      label: 'Currency of learning',        description: 'Is the prior learning current and still applicable?' },
  { key: 'authenticity',  label: 'Authenticity of evidence',    description: 'Is the evidence demonstrably the candidate’s own work?' },
  { key: 'sufficiency',   label: 'Sufficiency of evidence',     description: 'Is there enough evidence to support the claim made?' },
  { key: 'relevance',     label: 'Relevance to the qualification', description: 'Does the evidence map to the outcomes of the target qualification?' },
  { key: 'level',         label: 'Level appropriateness',       description: 'Does the learning demonstrated meet the NQF level claimed?' },
];

const VALID_RATINGS = ['NOT_MET', 'PARTIALLY_MET', 'MET', 'EXCEEDED'];

export const assessmentService = {
  criteria() {
    return ASSESSMENT_CRITERIA;
  },

  /**
   * Records an assessment and closes review. The assessment insert and the
   * resulting transition both occur before the response returns; the
   * transition itself carries the atomic status-plus-audit write.
   */
  record({ applicationId, criterionRatings, comments, recommendation }, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    if (actor.role !== ROLE.ASSESSOR) {
      throw forbidden('Only an assessor may record an assessment.');
    }
    if (application.assigned_assessor_id !== actor.id) {
      throw forbidden('You are not the allocated assessor for this application.');
    }
    if (application.status !== STATUS.UNDER_REVIEW) {
      throw conflict('An assessment may only be recorded while the application is UNDER_REVIEW.');
    }

    // Every defined criterion must be rated — a partial assessment is refused.
    const ratings = criterionRatings ?? {};
    const missing = ASSESSMENT_CRITERIA.filter((c) => !ratings[c.key]).map((c) => c.key);
    if (missing.length) {
      throw unprocessable(`All criteria must be rated. Missing: ${missing.join(', ')}.`);
    }

    const invalid = Object.entries(ratings).filter(([, v]) => !VALID_RATINGS.includes(v));
    if (invalid.length) {
      throw unprocessable(
        `Invalid rating value for: ${invalid.map(([k]) => k).join(', ')}. ` +
        `Allowed: ${VALID_RATINGS.join(', ')}.`
      );
    }

    if (!comments || !comments.trim()) {
      throw unprocessable('A narrative justification is required.');
    }
    if (!['RECOMMEND_APPROVE', 'RECOMMEND_REJECT'].includes(recommendation)) {
      throw unprocessable("Recommendation must be 'RECOMMEND_APPROVE' or 'RECOMMEND_REJECT'.");
    }

    // Append-only: any earlier assessment is superseded, never overwritten, so
    // the original judgement remains recoverable.
    const write = getDb().transaction(() => {
      assessmentRepository.markSuperseded(applicationId);
      return assessmentRepository.create({
        applicationId,
        assessorId: actor.id,
        criterionRatings: ratings,
        comments: comments.trim(),
        recommendation,
      });
    });
    const assessment = write();

    const application2 = applicationService.requestTransition(
      applicationId,
      STATUS.ASSESSMENT_COMPLETE,
      actor,
      { note: `Assessment recorded: ${recommendation}` }
    );

    return { assessment, application: application2 };
  },

  listFor(applicationId, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    const isAdmin = actor.role === ROLE.ADMINISTRATOR;
    const isAllocated =
      application.assigned_assessor_id === actor.id || isModeratorInScope(application, actor);
    const isOwner = application.applicant_id === actor.id;

    // An applicant sees the assessment of their own application only once a
    // decision has been ratified, so that in-progress judgements are not
    // disclosed mid-review.
    if (isOwner && ![STATUS.APPROVED, STATUS.REJECTED].includes(application.status)) {
      return [];
    }
    if (!isAdmin && !isAllocated && !isOwner) {
      throw forbidden('You do not have access to this assessment.');
    }

    return assessmentRepository.listByApplication(applicationId).map((a) => ({
      ...a,
      criterion_ratings: JSON.parse(a.criterion_ratings),
    }));
  },
};
