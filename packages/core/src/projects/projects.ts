import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  classProjectSchema,
  parseProjectTargetId,
  projectTargetId,
  type ClassProject,
  type Deliverable,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { getPolicy, policyOfClass } from '../policy/policy-store';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * The class group project (E-commerce 2026 Group Project Guide, section 6).
 *
 * Separate from the case study assignments on purpose. A class runs several
 * case studies through the term, each with its own group, case, presentation
 * date and room; the project is one piece of work that every group hands in
 * once, in the final week. Modelling it as another assignment would have meant
 * an assignment with no case and no presentation, and every screen that reads
 * those fields learning to cope with their absence.
 *
 * What it does share is the whole submission machinery: versions, the late
 * flag decided by the server clock, the files streamed through a route that
 * checks who is asking. That is what `submissionTarget` is for.
 */

export async function getClassProject(classId: string): Promise<ClassProject | null> {
  const snapshot = await getDb().collection(COLLECTIONS.classProjects).doc(classId).get();
  if (!snapshot.exists) return null;
  const parsed = classProjectSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

/**
 * Sets or moves the project deadline for a class.
 *
 * The framework version is stamped the first time and never restamped: what a
 * group must hand in is fixed the moment the project is set, exactly as an
 * assignment freezes its own. Moving the deadline afterwards is a scheduling
 * decision and leaves that alone.
 *
 * A deadline that has already passed is allowed. Unlike a presentation, which
 * cannot be held yesterday, a lecturer may well be recording a date the class
 * was told about weeks ago - and work handed in after it should be marked
 * late, which is precisely what recording the real date achieves.
 */
export async function setProjectDeadline(
  actor: SessionUser,
  classId: string,
  deadlineIso: string,
  reason: string,
): Promise<ClassProject> {
  const deadlineMs = Date.parse(deadlineIso);
  if (Number.isNaN(deadlineMs)) throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');
  if (reason.trim().length < 10) throw new AppError('VALIDATION_FAILED', 'errors.reasonTooShort');

  const deadline = new Date(deadlineMs).toISOString();
  const existing = await getClassProject(classId);

  if (existing && existing.deadline === deadline) {
    throw new AppError('VALIDATION_FAILED', 'errors.nothingToUpdate');
  }

  const policy = existing
    ? await getPolicy(existing.policyId, existing.policyVersion)
    : await policyOfClass(classId);

  const project: ClassProject = {
    classId,
    deadline,
    policyId: existing?.policyId ?? policy.id,
    policyVersion: existing?.policyVersion ?? policy.version,
  };

  await getDb()
    .collection(COLLECTIONS.classProjects)
    .doc(classId)
    .set(
      {
        ...project,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }),
      },
      { merge: true },
    );

  await writeAuditLog({
    action: existing ? 'project.deadline_changed' : 'project.scheduled',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classProjects}/${classId}`,
    classId,
    ...(existing ? { before: { deadline: existing.deadline } } : {}),
    after: { deadline },
    reason,
  });

  return project;
}

/** What the project asks for, from the framework version it froze. */
export async function projectDeliverables(project: ClassProject): Promise<Deliverable[]> {
  const policy = await getPolicy(project.policyId, project.policyVersion);
  return [...policy.projectDeliverables];
}

/**
 * Everything a submission needs to know about what it is being handed in
 * against, whether that is a case study assignment or the class project.
 *
 * Keeping the two behind one shape is what lets the upload route, the version
 * counter, the late flag and the file reader stay single implementations. The
 * caller never branches on which kind it got.
 */
export interface SubmissionTarget {
  id: string;
  classId: string;
  groupId: string;
  submissionDeadline: string;
  deliverables: Deliverable[];
  /** The framework version this work froze, which decides how it is marked. */
  policyId: string;
  policyVersion: string;
}

/** The project's target for one group, or null when no project is set. */
export async function projectTarget(
  classId: string,
  groupId: string,
): Promise<SubmissionTarget | null> {
  const project = await getClassProject(classId);
  if (!project) return null;

  return {
    id: projectTargetId(classId, groupId),
    classId,
    groupId,
    submissionDeadline: project.deadline,
    deliverables: await projectDeliverables(project),
    policyId: project.policyId,
    policyVersion: project.policyVersion,
  };
}

/**
 * Resolves a target id, of either kind.
 *
 * A project id carries its class and group, so there is no stored row per
 * group to keep in step with the deadline. It is still checked against the
 * database: the group has to exist and has to belong to that class, or an id
 * typed by hand would open a submission slot for a group in somebody else's
 * course.
 */
export async function projectTargetOf(id: string): Promise<SubmissionTarget | null> {
  const parsed = parseProjectTargetId(id);
  if (!parsed) return null;

  const group = await getDb().collection(COLLECTIONS.groups).doc(parsed.groupId).get();
  if (!group.exists || group.get('classId') !== parsed.classId) {
    throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  }

  const target = await projectTarget(parsed.classId, parsed.groupId);
  if (!target) throw new AppError('NOT_FOUND', 'errors.projectNotSet');
  return target;
}
