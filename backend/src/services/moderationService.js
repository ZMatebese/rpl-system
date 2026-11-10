import { applicationRepository } from '../repositories/applicationRepository.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { getDb } from '../db/index.js';
import { ROLE } from './stateMachine.js';
import { isModeratorInScope } from './accessPolicy.js';
import { forbidden, notFound, unprocessable } from '../utils/AppError.js';

const VERDICTS = ['CONFIRMED', 'CONCERNS'];

export const moderationService = {
  /**
   * Records a moderation. It does not move the application between states,
   * but it is written to the application's history in the same transaction so
   * the file shows that moderation took place and by whom.
   */
  record({ applicationId, verdict, comments }, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    if (!isModeratorInScope(application, actor)) {
      throw forbidden(
        'You may only moderate assessed applications for qualifications in your scope.',
        'NOT_IN_SCOPE'
      );
    }
    if (!VERDICTS.includes(verdict)) {
      throw unprocessable("Verdict must be 'CONFIRMED' or 'CONCERNS'.");
    }
    if (!comments || !comments.trim()) {
      throw unprocessable('Moderation comments are required.');
    }

    const write = getDb().transaction(() => {
      const moderation = moderationRepository.create({
        applicationId, moderatorId: actor.id, verdict, comments: comments.trim(),
      });
      auditRepository.insert({
        applicationId,
        previousStatus: application.status,
        newStatus: application.status,
        actorId: actor.id,
        note: `Moderated: ${verdict === 'CONFIRMED' ? 'assessment confirmed' : 'concerns recorded'}`,
      });
      return moderation;
    });
    return write();
  },

  listFor(applicationId, actor) {
    const application = applicationRepository.findRawById(applicationId);
    if (!application) throw notFound('Application not found');

    const allowed =
      actor.role === ROLE.ADMINISTRATOR ||
      isModeratorInScope(application, actor) ||
      (actor.role === ROLE.ASSESSOR && application.assigned_assessor_id === actor.id);
    if (!allowed) throw forbidden('You do not have access to this moderation record.');

    return moderationRepository.listByApplication(applicationId);
  },
};
