import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  classProjectSchema,
  parseProjectTargetId,
  projectTargetId,
  projectVolunteerId,
  projectVolunteerSchema,
  volunteeringWindow,
  type ClassProject,
  type Deliverable,
  type ProjectVolunteer,
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
    // Untouched by a change of deadline: who may present is a separate
    // decision from when the work is due.
    presentationSlots: existing?.presentationSlots ?? 0,
    ...(existing?.volunteerDeadline ? { volunteerDeadline: existing.volunteerDeadline } : {}),
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

/**
 * How many groups the lecturer will let present, and by when they must say so.
 *
 * Separate from the deadline on purpose: opening the floor is a teaching
 * decision taken in a different week from setting the hand-in date.
 */
export async function setProjectPresentationSlots(
  actor: SessionUser,
  classId: string,
  slots: number,
  volunteerDeadlineIso?: string,
): Promise<ClassProject> {
  const project = await getClassProject(classId);
  if (!project) throw new AppError('NOT_FOUND', 'errors.projectNotSet');

  if (!Number.isSafeInteger(slots) || slots < 0 || slots > 20) {
    throw new AppError('VALIDATION_FAILED', 'errors.slotsInvalid');
  }

  let volunteerDeadline: string | undefined;
  if (volunteerDeadlineIso) {
    const ms = Date.parse(volunteerDeadlineIso);
    if (Number.isNaN(ms)) throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');
    volunteerDeadline = new Date(ms).toISOString();
  }

  // Never below what has already been taken: a group told it is presenting
  // must not find out otherwise because a number was typed down.
  const taken = (await listProjectVolunteers(classId)).length;
  if (slots < taken) throw new AppError('CONFLICT', 'errors.slotsBelowVolunteers');

  await getDb()
    .collection(COLLECTIONS.classProjects)
    .doc(classId)
    .set(
      {
        presentationSlots: slots,
        ...(volunteerDeadline ? { volunteerDeadline } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  await writeAuditLog({
    action: 'project.slots_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classProjects}/${classId}`,
    classId,
    before: { presentationSlots: project.presentationSlots },
    after: { presentationSlots: slots, ...(volunteerDeadline ? { volunteerDeadline } : {}) },
  });

  return {
    ...project,
    presentationSlots: slots,
    ...(volunteerDeadline ? { volunteerDeadline } : {}),
  };
}

export async function listProjectVolunteers(classId: string): Promise<ProjectVolunteer[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.projectVolunteers)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => projectVolunteerSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Whether the floor is open, who has already volunteered, and why it is closed.
 *
 * The clock lives here rather than on the page, for the same reason the case
 * picker's does: a window decided in the browser is a different window for
 * every student, and the React Compiler is right to refuse it.
 */
export interface VolunteeringState {
  project: ClassProject | null;
  volunteers: ProjectVolunteer[];
  open: boolean;
  closedBecause: 'notOpened' | 'full' | 'deadline' | null;
}

export async function volunteering(classId: string): Promise<VolunteeringState> {
  const [project, volunteers] = await Promise.all([
    getClassProject(classId),
    listProjectVolunteers(classId),
  ]);

  if (!project) {
    return { project: null, volunteers, open: false, closedBecause: 'notOpened' };
  }

  const window = volunteeringWindow(project, volunteers.length, Date.now());
  return { project, volunteers, ...window };
}

/**
 * A group puts its hand up to present the project.
 *
 * Two rules, and neither survives a read-then-write: a group volunteers once,
 * and only as many groups as there are slots. The first is the document id; the
 * second is settled inside a transaction that counts the volunteers it can see.
 * Two members of two groups pressing at the same instant on the last slot leave
 * exactly one of them presenting.
 */
export async function volunteerToPresent(
  student: SessionUser,
  classId: string,
  groupId: string,
): Promise<ProjectVolunteer> {
  const db = getDb();
  const project = await getClassProject(classId);
  if (!project) throw new AppError('NOT_FOUND', 'errors.projectNotSet');

  const group = await db.collection(COLLECTIONS.groups).doc(groupId).get();
  if (!group.exists || group.get('classId') !== classId) {
    throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  }

  const ref = db
    .collection(COLLECTIONS.projectVolunteers)
    .doc(projectVolunteerId(classId, groupId));

  return db.runTransaction(async (tx) => {
    const taken = await tx.get(
      db.collection(COLLECTIONS.projectVolunteers).where('classId', '==', classId),
    );
    const mine = taken.docs.find((doc) => doc.id === ref.id);
    if (mine) throw new AppError('CONFLICT', 'errors.alreadyVolunteered');

    // The window is decided by the server's clock and the server's count, so
    // the answer is the same for everybody in the class.
    const window = volunteeringWindow(project, taken.size, Date.now());
    if (!window.open) {
      throw new AppError(
        'POLICY_VIOLATION',
        window.closedBecause === 'full'
          ? 'errors.presentationSlotsFull'
          : window.closedBecause === 'deadline'
            ? 'errors.volunteeringClosed'
            : 'errors.volunteeringNotOpen',
      );
    }

    const volunteer: ProjectVolunteer = {
      id: ref.id,
      classId,
      groupId,
      volunteeredByUid: student.uid,
      volunteeredAt: new Date().toISOString(),
      slot: taken.size + 1,
    };

    tx.create(ref, { ...volunteer, createdAt: FieldValue.serverTimestamp() });
    return volunteer;
  });
}

/**
 * The lecturer takes a group off the list.
 *
 * Refused once the group's session has opened: by then the class has asked it
 * questions, and a volunteer row that disappears would leave those questions
 * attached to a presentation nobody volunteered for.
 */
export async function withdrawVolunteer(
  actor: SessionUser,
  classId: string,
  groupId: string,
): Promise<void> {
  const db = getDb();
  const ref = db
    .collection(COLLECTIONS.projectVolunteers)
    .doc(projectVolunteerId(classId, groupId));
  const existing = await ref.get();
  if (!existing.exists) throw new AppError('NOT_FOUND', 'errors.notVolunteered');

  const session = await db
    .collection(COLLECTIONS.presentationSessions)
    .where('assignmentId', '==', projectTargetId(classId, groupId))
    .limit(1)
    .get();
  if (!session.empty) throw new AppError('CONFLICT', 'errors.presentationAlreadyRunning');

  await ref.delete();

  await writeAuditLog({
    action: 'project.volunteer_withdrawn',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.projectVolunteers}/${ref.id}`,
    classId,
    before: { groupId },
  });
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
