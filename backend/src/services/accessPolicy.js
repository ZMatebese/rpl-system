import { staffScopeRepository } from '../repositories/staffScopeRepository.js';
import { ROLE, STATUS } from './stateMachine.js';

/**
 * Statuses in which a moderator may look at a file: only once an assessment
 * exists, because there is nothing to moderate before that.
 */
export const MODERATABLE_STATUSES = [
  STATUS.ASSESSMENT_COMPLETE,
  STATUS.APPROVED,
  STATUS.REJECTED,
];

/** A moderator sees an application only if it is assessed and its
 *  qualification is within the moderator's scope. */
export function isModeratorInScope(application, actor) {
  return (
    actor.role === ROLE.MODERATOR &&
    MODERATABLE_STATUSES.includes(application.status) &&
    staffScopeRepository.covers(actor.id, application.qualification_id)
  );
}

/** Read access to an application, its evidence and its assessment. */
export function mayReadApplication(application, actor) {
  const isOwner = application.applicant_id === actor.id;
  const isAdmin = actor.role === ROLE.ADMINISTRATOR;
  const isAllocated =
    actor.role === ROLE.ASSESSOR && application.assigned_assessor_id === actor.id;
  return isOwner || isAdmin || isAllocated || isModeratorInScope(application, actor);
}
