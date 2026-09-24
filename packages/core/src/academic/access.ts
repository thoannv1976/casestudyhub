import { COLLECTIONS, type CaseStudy } from '@casestudyhub/shared';
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

/**
 * A student reads a case study when it has been published *and* belongs to a
 * course they are taking. Publishing a case for one course should not hand it
 * to the whole university.
 */
export async function assertCanReadCase(caller: SessionUser, study: CaseStudy): Promise<void> {
  if (caller.role === 'admin' || caller.role === 'lecturer') return;

  if (study.status !== 'published') {
    throw new AppError('FORBIDDEN', 'errors.caseNotPublished');
  }

  const courseIds = await courseIdsOfStudent(caller.uid);
  if (!courseIds.includes(study.courseId)) {
    throw new AppError('FORBIDDEN', 'errors.caseNotYourCourse');
  }
}

/** The published cases of the courses this student is actually taking. */
export async function filterCasesForStudent(
  uid: string,
  cases: readonly CaseStudy[],
): Promise<CaseStudy[]> {
  const courseIds = new Set(await courseIdsOfStudent(uid));
  return cases.filter((study) => study.status === 'published' && courseIds.has(study.courseId));
}
