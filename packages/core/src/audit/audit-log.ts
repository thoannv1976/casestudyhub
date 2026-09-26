import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';

/**
 * Audit log (SRS 20). Every action that changes a grade, a deadline, a role or
 * an account must leave a record, written with the server clock.
 */
export const AUDIT_ACTIONS = [
  'user.role_changed',
  'user.status_changed',
  'user.imported',
  'class.created',
  'class.archived',
  'class.student_removed',
  'class.student_approved',
  'staff.account_created',
  'user.password_changed',
  'user.profile_corrected',
  'group.created',
  'group.locked',
  'group.member_moved',
  'group.random_distribution',
  'group.roles_assigned',
  'group.renamed',
  'case.published',
  'case.revised',
  'case.claimed',
  'case.claim_released',
  'class.case_selection_changed',
  'case.attachment_added',
  'case.attachment_removed',
  'assignment.created',
  'assignment.deadline_changed',
  'assignment.rescheduled',
  'submission.created',
  'class.lecturer_added',
  'ai.assessment_requested',
  'ai.answers_generated',
  'ai.questions_suggested',
  'session.started',
  'session.status_changed',
  'question.selected',
  'submission.resubmission_allowed',
  'grade.drafted',
  'grade.published',
  'grade.overridden',
  'policy.version_created',
  'penalty.waived',
  'system.setting_changed',
  'ai.configuration_changed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  actorUid: string;
  actorRole: string;
  /** Document the action targeted, as `collection/id`. */
  target: string;
  classId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  ip?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<string> {
  const doc = getDb().collection(COLLECTIONS.auditLogs).doc();
  await doc.set({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
  return doc.id;
}
