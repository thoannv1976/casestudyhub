import {
  COLLECTIONS,
  studentMayReadCase,
  type CaseScopeClass,
  type CaseStudy,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * Who may read what, by class (SRS 20: "a student sees the data of the classes
 * they are in, and the material that has been published").
 *
 * Being signed in is not the same as belonging. Without these checks a student
 * of one cohort could read another cohort's group lists, the names in them,
 * and every deadline - none of which is theirs to see.
 */

export async function classIdsOfStudent(uid: string): Promise<string[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.classEnrollments)
    .where('studentUid', '==', uid)
    .where('status', '==', 'active')
    .get();
  return snapshot.docs.map((doc) => doc.get('classId') as string);
}

export async function courseIdsOfStudent(uid: string): Promise<string[]> {
  const classIds = await classIdsOfStudent(uid);
  if (classIds.length === 0) return [];

  const db = getDb();
  const classes = await db.getAll(
    ...classIds.map((classId) => db.collection(COLLECTIONS.classes).doc(classId)),
  );

  return [
    ...new Set(
      classes
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.get('courseId') as string),
    ),
  ];
}

/** Staff may look at any class; a student only at one they are enrolled in. */
export async function assertCanViewClass(caller: SessionUser, classId: string): Promise<void> {
  if (caller.role === 'admin' || caller.role === 'lecturer') return;

  const classIds = await classIdsOfStudent(caller.uid);
  if (!classIds.includes(classId)) {
    throw new AppError('FORBIDDEN', 'errors.notInThisClass');
  }
}

/** Firestore takes at most thirty values in one `in` filter. */
const IN_LIMIT = 30;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}

/**
 * What decides which cases a student may read: the classes they are in, and
 * the cases their own groups hold - claimed, or set as an assignment.
 */
export async function caseScopeOfStudent(
  uid: string,
): Promise<{ classes: CaseScopeClass[]; heldCaseIds: Set<string> }> {
  const classIds = await classIdsOfStudent(uid);
  if (classIds.length === 0) return { classes: [], heldCaseIds: new Set() };

  const db = getDb();
  const [classSnapshots, memberships] = await Promise.all([
    db.getAll(...classIds.map((classId) => db.collection(COLLECTIONS.classes).doc(classId))),
    db.collection(COLLECTIONS.groupMembers).where('studentUid', '==', uid).get(),
  ]);

  const classes = classSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({
      courseId: snapshot.get('courseId') as string,
      caseSetIds: Array.isArray(snapshot.get('caseSetIds'))
        ? (snapshot.get('caseSetIds') as string[])
        : undefined,
    }));

  // Only groups in classes the student is still in: a student removed from a
  // class leaves its cases behind with it.
  const groupIds = [
    ...new Set(
      memberships.docs
        .filter((doc) => classIds.includes(doc.get('classId') as string))
        .map((doc) => doc.get('groupId') as string | undefined)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  ];

  const heldCaseIds = new Set<string>();
  for (const batch of chunks(groupIds, IN_LIMIT)) {
    const [assignments, claims] = await Promise.all([
      db.collection(COLLECTIONS.assignments).where('groupId', 'in', batch).get(),
      db.collection(COLLECTIONS.caseClaims).where('groupId', 'in', batch).get(),
    ]);
    for (const doc of [...assignments.docs, ...claims.docs]) {
      heldCaseIds.add(doc.get('caseStudyId') as string);
    }
  }

  return { classes, heldCaseIds };
}

/**
 * A student reads a case study when it has been published *and* their class
 * works from it, or their own group holds it. Publishing a case for one class
 * should not hand it to the whole university; and a group must always be able
 * to open the case it was given, wherever in the library that case is filed.
 */
export async function assertCanReadCase(caller: SessionUser, study: CaseStudy): Promise<void> {
  if (caller.role === 'admin' || caller.role === 'lecturer') return;

  if (study.status !== 'published') {
    throw new AppError('FORBIDDEN', 'errors.caseNotPublished');
  }

  const scope = await caseScopeOfStudent(caller.uid);
  if (!studentMayReadCase(study, scope.classes, scope.heldCaseIds)) {
    throw new AppError('FORBIDDEN', 'errors.caseNotYourCourse');
  }
}

/** The published cases this student may read, by the same rule as above. */
export async function filterCasesForStudent(
  uid: string,
  cases: readonly CaseStudy[],
): Promise<CaseStudy[]> {
  const scope = await caseScopeOfStudent(uid);
  return cases.filter((study) => studentMayReadCase(study, scope.classes, scope.heldCaseIds));
}
