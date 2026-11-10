import { getDb } from '../db/index.js';
import { applicationRepository } from '../repositories/applicationRepository.js';
import { qualificationRepository } from '../repositories/qualificationRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { evidenceRepository } from '../repositories/evidenceRepository.js';
import { assessmentRepository } from '../repositories/assessmentRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { staffScopeRepository } from '../repositories/staffScopeRepository.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { STATUS, ROLE, TRANSITIONS, availableTransitions } from './stateMachine.js';
import { mayReadApplication, isModeratorInScope, MODERATABLE_STATUSES } from './accessPolicy.js';
import { forbidden, notFound, conflict, unprocessable, badRequest } from '../utils/AppError.js';

export const applicationService = {
  /**
   * The single gateway through which every application status change passes.
   *
   * Implements the RequestTransition procedure from Section 3.2.2 of the
   * design document. Both the status update and the audit insert occur inside
   * one transaction, so the invariant "no state change exists without its
   * audit row" cannot be violated even under partial failure.
   */
  requestTransition(applicationId, targetState, actor, ctx = {}) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    const fromState = TRANSITIONS[application.status] || {};
    const rule = fromState[targetState];

    if (!rule) {
      throw conflict(
        `Illegal transition: an application in ${application.status} cannot move to ${targetState}.`,
        'ILLEGAL_TRANSITION'
      );
    }

    if (actor.role !== rule.requiredRole) {
      throw forbidden(
        `Role ${actor.role} is not permitted to perform this transition.`,
        'ROLE_NOT_PERMITTED'
      );
    }

    if (rule.requiresAllocation && application.assigned_assessor_id !== actor.id) {
      throw forbidden('You are not the allocated assessor for this application.', 'NOT_ALLOCATED');
    }

    if (rule.requiresOwnership && application.applicant_id !== actor.id) {
      throw forbidden('You do not own this application.', 'NOT_OWNER');
    }

    if (!rule.guard(application, ctx)) {
      throw unprocessable(rule.guardFailure, 'GUARD_FAILED');
    }

    const previousStatus = application.status;

    // --- atomic: status change and its audit row commit together, or neither
    const commit = getDb().transaction(() => {
      applicationRepository.updateStatus(applicationId, targetState);
      if (ctx.rationale) {
        applicationRepository.setOutcomeRationale(applicationId, ctx.rationale.trim());
      }
      auditRepository.insert({
        applicationId,
        previousStatus,
        newStatus: targetState,
        actorId: actor.id,
        note: ctx.note ?? ctx.rationale ?? null,
      });
    });
    commit();

    return applicationRepository.findById(applicationId);
  },

  create({ qualificationId, motivation }, actor) {
    const qualification = qualificationRepository.findById(qualificationId);
    if (!qualification) throw badRequest('Unknown qualification.');

    const application = applicationRepository.create({
      applicantId: actor.id,
      qualificationId,
      motivation: motivation ?? '',
    });

    // The creation row gives the audit trail an origin, with previous_status
    // null — the only row for which that is true.
    auditRepository.insert({
      applicationId: application.id,
      previousStatus: null,
      newStatus: STATUS.DRAFT,
      actorId: actor.id,
      note: 'Application created',
    });

    return application;
  },

  updateDraft(applicationId, payload, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');
    if (application.applicant_id !== actor.id) {
      throw forbidden('You do not own this application.');
    }
    if (application.status !== STATUS.DRAFT) {
      throw conflict('Only an application in DRAFT may be edited.');
    }
    if (payload.qualificationId && !qualificationRepository.findById(payload.qualificationId)) {
      throw badRequest('Unknown qualification.');
    }
    return applicationRepository.updateDraft(applicationId, payload);
  },

  /**
   * Read a single application with full detail. Authorisation is applied here
   * rather than in the route, because who may see an application depends on
   * the record itself (ownership, allocation) and not only on the role.
   */
  getForActor(applicationId, actor) {
    const application = applicationRepository.findById(applicationId);
    if (!application) throw notFound('Application not found');

    const isOwner = application.applicant_id === actor.id;
    const isAdmin = actor.role === ROLE.ADMINISTRATOR;
    const isModerator = isModeratorInScope(application, actor);
    const isAllocated =
      actor.role === ROLE.ASSESSOR && application.assigned_assessor_id === actor.id;

    if (!mayReadApplication(application, actor)) {
      throw forbidden('You do not have access to this application.');
    }

    return {
      ...application,
      evidence: evidenceRepository.listByApplication(applicationId),
      assessment: assessmentRepository.findCurrentForApplication(applicationId),
      availableTransitions: availableTransitions(application, actor),
      // The audit trail is visible to the administrator and to the owning
      // applicant for their own application; assessors see the record they
      // are working on, not the institutional decision history.
      history:
        isAdmin || isOwner || isModerator
          ? auditRepository.listByApplication(applicationId)
          : undefined,
      // Moderation is internal quality assurance: visible to the
      // administrator, the moderators in scope and the assessor whose work
      // was moderated — not to the applicant.
      moderations:
        isAdmin || isModerator || isAllocated
          ? moderationRepository.listByApplication(applicationId)
          : undefined,
      canModerate: isModerator,
    };
  },

  listMine(actor) {
    return applicationRepository.listByApplicant(actor.id);
  },

  listAllocated(actor) {
    return applicationRepository.listByAssessor(actor.id);
  },

  /** Assessed applications within the moderator's qualification scope. */
  listForModeration(actor) {
    const scope = new Set(staffScopeRepository.listForUser(actor.id));
    return applicationRepository
      .listByStatuses(MODERATABLE_STATUSES)
      .filter((a) => scope.has(a.qualification_id));
  },

  listQueue(status = STATUS.SUBMITTED) {
    return applicationRepository.listByStatus(status);
  },

  listAll() {
    return applicationRepository.listAll();
  },

  /**
   * Allocation and the SUBMITTED -> UNDER_REVIEW transition are coupled: the
   * transition guard tests for an allocated assessor, so an application cannot
   * enter review unallocated.
   */
  allocateAssessor(applicationId, assessorId, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    if (application.status !== STATUS.SUBMITTED) {
      throw conflict('Only a SUBMITTED application may be allocated.');
    }

    const assessor = userRepository.findById(assessorId);
    if (!assessor) throw badRequest('Unknown user.');
    if (assessor.role !== ROLE.ASSESSOR) {
      throw unprocessable('The nominated user does not hold the Assessor role.');
    }
    if (!assessor.active) {
      throw unprocessable('That assessor account is deactivated.', 'ASSESSOR_INACTIVE');
    }
    if (!staffScopeRepository.covers(assessor.id, application.qualification_id)) {
      throw unprocessable(
        'That assessor is not scoped to this qualification. Add it to their qualifications first.',
        'OUT_OF_SCOPE'
      );
    }

    applicationRepository.assignAssessor(applicationId, assessorId);
    return this.requestTransition(applicationId, STATUS.UNDER_REVIEW, actor, {
      note: `Allocated to ${assessor.first_name} ${assessor.surname}`,
    });
  },

  returnToDraft(applicationId, actor, note) {
    return this.requestTransition(applicationId, STATUS.DRAFT, actor, {
      note: note || 'Returned for further evidence',
    });
  },

  recordOutcome(applicationId, decision, rationale, actor) {
    const target =
      decision === 'approve' ? STATUS.APPROVED
      : decision === 'reject' ? STATUS.REJECTED
      : null;
    if (!target) throw badRequest("Decision must be 'approve' or 'reject'.");

    return this.requestTransition(applicationId, target, actor, { rationale });
  },

  getAuditTrail(applicationId, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    const isOwner = application.applicant_id === actor.id;
    if (actor.role !== ROLE.ADMINISTRATOR && !isOwner) {
      throw forbidden('You do not have access to this audit trail.');
    }
    return auditRepository.listByApplication(applicationId);
  },

  statistics() {
    const counts = applicationRepository.countsByStatus();
    const byStatus = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
    for (const row of counts) byStatus[row.status] = row.count;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { byStatus, total };
  },
};
