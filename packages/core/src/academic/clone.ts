import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, createClassSchema, type CloneClassRequest } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';
import { assertCanManageClass, createClass } from './structure';
import { createGroups } from '../groups/groups';

/**
 * A new cohort of a course that ran before (SRS 3.2).
 *
 * The lecturer's work on the old class is the course, the cases it offers and
 * how the class is run; none of that should be set up again by hand. The
 * people are the cohort, and none of them carries over: no students, no
 * groups' members, no assignments and no marks. The new class runs under the
 * newest framework version, exactly like any class created today.
 */
export async function cloneClassForNewCohort(
  actor: SessionUser,
  sourceClassId: string,
  input: CloneClassRequest,
): Promise<string> {
  await assertCanManageClass(actor, sourceClassId);
  const db = getDb();
  const source = await db.collection(COLLECTIONS.classes).doc(sourceClassId).get();
  if (!source.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');
  const data = source.data() as Record<string, unknown>;

  const classId = await createClass(
    actor,
    createClassSchema.parse({
      classCode: input.classCode,
      className: input.className,
      courseId: data.courseId,
      semesterId: data.semesterId,
      language: data.language,
      joinMode: data.joinMode,
      lecturerIds: ((data.lecturerIds as string[] | undefined) ?? []).slice(0, 10),
    }),
  );

  // How the class runs, as the lecturer last left it on the old one.
  const caseSelection = (data.caseSelection as string | undefined) ?? 'lecturer_assigns';
  const settings: Record<string, unknown> = {
    caseSelection,
    groupsPerCase: typeof data.groupsPerCase === 'number' ? data.groupsPerCase : 1,
    clonedFromClassId: sourceClassId,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (Array.isArray(data.caseSetIds)) settings.caseSetIds = data.caseSetIds;
  if (data.afterClassQa) settings.afterClassQa = data.afterClassQa;
  if (data.attendancePolicy) settings.attendancePolicy = data.attendancePolicy;
  if (typeof data.liveQaUrl === 'string') settings.liveQaUrl = data.liveQaUrl;
  if (caseSelection === 'groups_choose' && input.caseSelectionDeadline) {
    settings.caseSelectionDeadline = new Date(input.caseSelectionDeadline).toISOString();
  }
  await db.collection(COLLECTIONS.classes).doc(classId).update(settings);

  await createGroups(actor, classId, {
    count: input.groupCount,
    maxMembers: input.maxMembers,
    formationMode: 'student_self_join',
  });

  await writeAuditLog({
    action: 'class.cloned',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    before: { classId: sourceClassId },
    after: {
      classCode: input.classCode,
      groups: input.groupCount,
      cases: Array.isArray(data.caseSetIds) ? data.caseSetIds.length : null,
    },
  });
  return classId;
}
