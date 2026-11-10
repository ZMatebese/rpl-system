import { evidenceRepository } from '../repositories/evidenceRepository.js';
import { assessmentRepository } from '../repositories/assessmentRepository.js';

export const STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ASSESSMENT_COMPLETE: 'ASSESSMENT_COMPLETE',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

export const ROLE = Object.freeze({
  APPLICANT: 'APPLICANT',
  ASSESSOR: 'ASSESSOR',
  MODERATOR: 'MODERATOR',
  ADMINISTRATOR: 'ADMINISTRATOR',
});

export const TERMINAL_STATES = [STATUS.APPROVED, STATUS.REJECTED];

/**
 * The transition table.
 *
 * This is declarative data, not branching code. A change to institutional RPL
 * policy is a change to this table rather than a change to control flow, which
 * is what makes the rules maintainable by a future developer.
 *
 * Each entry corresponds one-to-one with an arc in the state machine diagram
 * (Figure 5 of the Design Phase document). The absence of an entry is as
 * meaningful as its presence: there is no SUBMITTED -> APPROVED entry, which
 * encodes the institutional rule that no application may be approved without a
 * recorded assessment.
 *
 *   requiredRole        — role the actor must hold
 *   requiresAllocation  — actor must be the allocated assessor for this application
 *   guard(app)          — precondition on the application itself
 *   guardFailure        — message returned (422) when the guard fails
 */
export const TRANSITIONS = {
  [STATUS.DRAFT]: {
    [STATUS.SUBMITTED]: {
      requiredRole: ROLE.APPLICANT,
      requiresOwnership: true,
      guard: (app) =>
        evidenceRepository.countByApplication(app.id) > 0 &&
        typeof app.motivation === 'string' &&
        app.motivation.trim().length > 0,
      guardFailure:
        'An application requires at least one evidence item and a completed motivation before submission.',
    },
  },

  [STATUS.SUBMITTED]: {
    [STATUS.UNDER_REVIEW]: {
      requiredRole: ROLE.ADMINISTRATOR,
      guard: (app) => app.assigned_assessor_id != null,
      guardFailure: 'An assessor must be allocated before the application can enter review.',
    },
    [STATUS.DRAFT]: {
      requiredRole: ROLE.ADMINISTRATOR,
      guard: () => true,
      guardFailure: '',
    },
  },

  [STATUS.UNDER_REVIEW]: {
    [STATUS.ASSESSMENT_COMPLETE]: {
      requiredRole: ROLE.ASSESSOR,
      requiresAllocation: true,
      guard: (app) => assessmentRepository.findCurrentForApplication(app.id) != null,
      guardFailure: 'A complete assessment must be recorded before review can be closed.',
    },
    [STATUS.DRAFT]: {
      // Returning an application mid-review for further evidence. A real and
      // frequent path, so it is modelled rather than left as an exception.
      requiredRole: ROLE.ADMINISTRATOR,
      guard: () => true,
      guardFailure: '',
    },
  },

  [STATUS.ASSESSMENT_COMPLETE]: {
    [STATUS.APPROVED]: {
      requiredRole: ROLE.ADMINISTRATOR,
      guard: (app, ctx) => Boolean(ctx?.rationale && ctx.rationale.trim().length > 0),
      guardFailure: 'An outcome rationale is required to ratify a decision.',
    },
    [STATUS.REJECTED]: {
      requiredRole: ROLE.ADMINISTRATOR,
      guard: (app, ctx) => Boolean(ctx?.rationale && ctx.rationale.trim().length > 0),
      guardFailure: 'An outcome rationale is required to ratify a decision.',
    },
  },

  // APPROVED and REJECTED are terminal — no outbound transitions.
  [STATUS.APPROVED]: {},
  [STATUS.REJECTED]: {},
};

/** Transitions legally available to this actor from the application's current
 *  state. Used by the client to decide which controls to offer — but the
 *  client's decision is never the enforcement point. */
export function availableTransitions(app, actor) {
  const fromState = TRANSITIONS[app.status] || {};
  return Object.entries(fromState)
    .filter(([, rule]) => {
      if (rule.requiredRole !== actor.role) return false;
      if (rule.requiresAllocation && app.assigned_assessor_id !== actor.id) return false;
      if (rule.requiresOwnership && app.applicant_id !== actor.id) return false;
      return true;
    })
    .map(([target]) => target);
}

export function isTerminal(status) {
  return TERMINAL_STATES.includes(status);
}
