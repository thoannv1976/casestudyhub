import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  type ClassEnrollment,
  type ImportedStudent,
  classEnrollmentSchema,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { studentIdKey } from '../users/registration';
import type { SessionUser } from '../auth/types';

/**
 * Class enrolment (SRS 1.2).
 *
 * One document per student per class, keyed by the student code. An imported
 * faculty list and the student's own join therefore meet in the same document
 * instead of becoming two records that have to be reconciled later.
 */

export function enrollmentId(classId: string, studentId: string): string {
  return `${classId}__${studentIdKey(studentId)}`;
}

export interface JoinResult {
  classId: string;
  className: string;
  /** True when the student was already on the imported faculty list. */
  wasExpected: boolean;
}

/**
 * A student joins by typing the class code.
 *
 * The lecturer's choice decides what happens: `code` lets them straight in,
 * `approval` puts them in a queue, `closed` refuses. Everything runs in one
 * transaction, so a student pressing the button twice cannot create two rows.
 */
export async function joinClassByCode(
  student: SessionUser,
  studentProfile: { studentId?: string; fullName: string; email: string },
  classCode: string,
): Promise<JoinResult> {
  if (!studentProfile.studentId) {
    throw new AppError('POLICY_VIOLATION', 'errors.studentIdRequiredToJoin');
  }

  const db = getDb();
  const normalised = classCode.trim().toUpperCase();

  const matches = await db
    .collection(COLLECTIONS.classes)
    .where('classCode', '==', normalised)
    .limit(1)
    .get();

  const classDoc = matches.docs[0];
  if (!classDoc) throw new AppError('NOT_FOUND', 'errors.classCodeNotFound');

  const classData = classDoc.data();
  if (classData.status !== 'active') {
    throw new AppError('POLICY_VIOLATION', 'errors.classNotActive');
  }
  if (classData.joinMode === 'closed') {
    throw new AppError('POLICY_VIOLATION', 'errors.classClosed');
  }

  const targetStatus = classData.joinMode === 'approval' ? 'pending' : 'active';
  const ref = db
    .collection(COLLECTIONS.classEnrollments)
    .doc(enrollmentId(classDoc.id, studentProfile.studentId));

  const wasExpected = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);

    if (existing.exists) {
      const status = existing.get('status') as string;
      const holderUid = existing.get('studentUid') as string | undefined;

      if (status === 'removed') {
        throw new AppError('FORBIDDEN', 'errors.removedFromClass');
      }
      // The row belongs to somebody else's account: two accounts are claiming
      // one student code, which the lecturer must sort out.
      if (holderUid && holderUid !== student.uid) {
        throw new AppError('CONFLICT', 'errors.studentIdClaimed');
      }
      if (holderUid === student.uid && status === 'active') {
        throw new AppError('CONFLICT', 'errors.alreadyInClass');
      }

      // An imported row now claimed by the student it was created for.
      tx.update(ref, {
        studentUid: student.uid,
        fullName: studentProfile.fullName,
        email: studentProfile.email,
        status: targetStatus,
        joinedVia: 'class_code',
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (targetStatus === 'active' && status !== 'active') {
        tx.update(classDoc.ref, { studentCount: FieldValue.increment(1) });
      }
      return true;
    }

    tx.create(ref, {
      id: ref.id,
      classId: classDoc.id,
      studentId: studentProfile.studentId,
      studentUid: student.uid,
      fullName: studentProfile.fullName,
      email: studentProfile.email,
      status: targetStatus,
      joinedVia: 'class_code',
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (targetStatus === 'active') {
      tx.update(classDoc.ref, { studentCount: FieldValue.increment(1) });
    }
    return false;
  });

  return {
    classId: classDoc.id,
    className: classData.className as string,
    wasExpected,
  };
}

export async function listRoster(classId: string): Promise<ClassEnrollment[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.classEnrollments)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((docSnapshot) => classEnrollmentSchema.safeParse(docSnapshot.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

export async function listClassesOfStudent(studentUid: string): Promise<ClassEnrollment[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.classEnrollments)
    .where('studentUid', '==', studentUid)
    .where('status', 'in', ['active', 'pending'])
    .get();

  return snapshot.docs
    .map((docSnapshot) => classEnrollmentSchema.safeParse(docSnapshot.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

/**
 * A lecturer removes somebody who does not belong to the class. The row is
 * kept with `removed` so the same person cannot simply rejoin with the code,
 * and so the decision stays visible.
 */
export async function removeFromClass(
  actor: SessionUser,
  classId: string,
  enrollmentIdValue: string,
  reason: string,
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.classEnrollments).doc(enrollmentIdValue);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.enrollmentNotFound');
    if (snapshot.get('classId') !== classId) {
      throw new AppError('FORBIDDEN', 'errors.forbidden');
    }

    const wasActive = snapshot.get('status') === 'active';
    tx.update(ref, {
      status: 'removed',
      removedReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (wasActive) {
      tx.update(db.collection(COLLECTIONS.classes).doc(classId), {
        studentCount: FieldValue.increment(-1),
      });
    }
  });

  await writeAuditLog({
    action: 'class.student_removed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classEnrollments}/${enrollmentIdValue}`,
    classId,
    reason,
  });
}

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: { studentId: string; messageKey: string }[];
}

/**
 * Imports a faculty list into a class.
 *
 * Rows become `pending` enrolments holding a place for each student. Nothing
 * creates accounts and nothing distributes passwords: the student registers
 * themselves and, when they join with the class code, lands on the row already
 * waiting for their student code. The lecturer can see at a glance who has
 * signed up and who has not.
 */
export async function importRoster(
  actor: SessionUser,
  classId: string,
  students: readonly ImportedStudent[],
): Promise<ImportOutcome> {
  const db = getDb();
  const outcome: ImportOutcome = { created: 0, updated: 0, skipped: [] };

  // Firestore allows 500 writes per batch; import files are bigger than that
  // often enough to matter.
  const CHUNK = 400;
  for (let start = 0; start < students.length; start += CHUNK) {
    const chunk = students.slice(start, start + CHUNK);
    const refs = chunk.map((student) =>
      db.collection(COLLECTIONS.classEnrollments).doc(enrollmentId(classId, student.studentId)),
    );
    const existing = await db.getAll(...refs);

    const batch = db.batch();
    chunk.forEach((student, index) => {
      const ref = refs[index];
      const current = existing[index];
      if (!ref || !current) return;

      if (current.exists) {
        // Never overwrite a student who already joined, and never resurrect
        // somebody a lecturer removed on purpose.
        const status = current.get('status') as string;
        if (status === 'removed') {
          outcome.skipped.push({
            studentId: student.studentId,
            messageKey: 'errors.importSkippedRemoved',
          });
          return;
        }
        if (current.get('studentUid')) {
          outcome.skipped.push({
            studentId: student.studentId,
            messageKey: 'errors.importSkippedAlreadyJoined',
          });
          return;
        }
        batch.update(ref, {
          fullName: student.fullName,
          email: student.email,
          updatedAt: FieldValue.serverTimestamp(),
        });
        outcome.updated += 1;
        return;
      }

      batch.create(ref, {
        id: ref.id,
        classId,
        studentId: student.studentId,
        fullName: student.fullName,
        email: student.email,
        status: 'pending',
        joinedVia: 'import',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      outcome.created += 1;
    });

    await batch.commit();
  }

  await writeAuditLog({
    action: 'user.imported',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: {
      created: outcome.created,
      updated: outcome.updated,
      skipped: outcome.skipped.length,
    },
  });

  return outcome;
}

/**
 * A lecturer approves a student waiting in a class set to `approval` mode.
 *
 * Only a row a real account is waiting on can be approved: a `pending` row that
 * came from an imported list holds a place for somebody who has not signed up
 * yet, and approving it would put a student in the class who cannot sign in.
 */
export async function approveEnrollment(
  actor: SessionUser,
  classId: string,
  enrollmentIdValue: string,
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.classEnrollments).doc(enrollmentIdValue);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.enrollmentNotFound');
    if (snapshot.get('classId') !== classId) {
      throw new AppError('FORBIDDEN', 'errors.forbidden');
    }

    const status = snapshot.get('status') as string;
    if (status === 'active') {
      throw new AppError('CONFLICT', 'errors.alreadyApproved');
    }
    if (status === 'removed') {
      throw new AppError('POLICY_VIOLATION', 'errors.cannotApproveRemoved');
    }
    if (!snapshot.get('studentUid')) {
      throw new AppError('POLICY_VIOLATION', 'errors.nothingToApprove');
    }

    tx.update(ref, {
      status: 'active',
      approvedAt: FieldValue.serverTimestamp(),
      approvedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(db.collection(COLLECTIONS.classes).doc(classId), {
      studentCount: FieldValue.increment(1),
    });
  });

  await writeAuditLog({
    action: 'class.student_approved',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classEnrollments}/${enrollmentIdValue}`,
    classId,
    after: { status: 'active' },
  });
}

/** Students waiting for a decision: signed up, not yet let in. */
export function pendingApprovals(roster: readonly ClassEnrollment[]): ClassEnrollment[] {
  return roster.filter((row) => row.status === 'pending' && Boolean(row.studentUid));
}

/** On the faculty list but never signed up - nothing to approve yet. */
export function awaitingSignUp(roster: readonly ClassEnrollment[]): ClassEnrollment[] {
  return roster.filter((row) => row.status === 'pending' && !row.studentUid);
}
