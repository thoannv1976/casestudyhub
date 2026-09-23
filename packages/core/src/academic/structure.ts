import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_PRESENTATION_POLICY,
  type CreateAcademicYearRequest,
  type CreateClassRequest,
  type CreateCourseRequest,
  type CreateSemesterRequest,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * Academic structure (SRS 3.2):
 * University -> Academic Year -> Semester -> Course -> Class
 *
 * Each level only stores a reference to its parent. Deleting is never a hard
 * delete: academic records must survive, so everything is archived instead.
 */

export async function createAcademicYear(
  actor: SessionUser,
  input: CreateAcademicYearRequest,
): Promise<string> {
  if (input.endDate <= input.startDate) {
    throw new AppError('VALIDATION_FAILED', 'errors.endBeforeStart');
  }

  const ref = getDb().collection(COLLECTIONS.academicYears).doc();
  await ref.set({
    id: ref.id,
    ...input,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });
  return ref.id;
}

export async function createSemester(
  actor: SessionUser,
  input: CreateSemesterRequest,
): Promise<string> {
  const db = getDb();
  const year = await db.collection(COLLECTIONS.academicYears).doc(input.academicYearId).get();
  if (!year.exists) throw new AppError('NOT_FOUND', 'errors.academicYearNotFound');

  const ref = db.collection(COLLECTIONS.semesters).doc();
  await ref.set({
    id: ref.id,
    ...input,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });
  return ref.id;
}

export async function createCourse(
  actor: SessionUser,
  input: CreateCourseRequest,
): Promise<string> {
  const db = getDb();
  const code = input.code.trim().toUpperCase();

  // Course codes appear on transcripts and in the case library, so a duplicate
  // would be worse than a rejected form.
  const clash = await db.collection(COLLECTIONS.courses).where('code', '==', code).limit(1).get();
  if (!clash.empty) throw new AppError('CONFLICT', 'errors.courseCodeTaken');

  const ref = db.collection(COLLECTIONS.courses).doc();
  await ref.set({
    id: ref.id,
    ...input,
    code,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });
  return ref.id;
}

/**
 * Creating a class freezes the presentation policy version it runs under, so a
 * later change to the framework cannot alter a class already under way.
 */
export async function createClass(actor: SessionUser, input: CreateClassRequest): Promise<string> {
  const db = getDb();
  const classCode = input.classCode.trim().toUpperCase();

  const [course, semester, clash] = await Promise.all([
    db.collection(COLLECTIONS.courses).doc(input.courseId).get(),
    db.collection(COLLECTIONS.semesters).doc(input.semesterId).get(),
    db.collection(COLLECTIONS.classes).where('classCode', '==', classCode).limit(1).get(),
  ]);

  if (!course.exists) throw new AppError('NOT_FOUND', 'errors.courseNotFound');
  if (!semester.exists) throw new AppError('NOT_FOUND', 'errors.semesterNotFound');
  // The class code is what students type to join; two classes sharing one would
  // put students in the wrong class.
  if (!clash.empty) throw new AppError('CONFLICT', 'errors.classCodeTaken');

  const lecturerIds = Array.from(new Set([actor.uid, ...input.lecturerIds]));

  const ref = db.collection(COLLECTIONS.classes).doc();
  await ref.set({
    id: ref.id,
    ...input,
    classCode,
    lecturerIds,
    presentationPolicyId: DEFAULT_PRESENTATION_POLICY.id,
    presentationPolicyVersion: DEFAULT_PRESENTATION_POLICY.version,
    studentCount: 0,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAuditLog({
    action: 'class.created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${ref.id}`,
    classId: ref.id,
    after: { classCode, className: input.className },
  });

  return ref.id;
}

/** A lecturer may only act on their own classes; an admin on any. */
export async function assertCanManageClass(actor: SessionUser, classId: string): Promise<void> {
  if (actor.role === 'admin') return;

  const snapshot = await getDb().collection(COLLECTIONS.classes).doc(classId).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  const lecturerIds = (snapshot.get('lecturerIds') as string[] | undefined) ?? [];
  if (!lecturerIds.includes(actor.uid)) {
    throw new AppError('FORBIDDEN', 'errors.notYourClass');
  }
}

export async function archiveClass(
  actor: SessionUser,
  classId: string,
  reason: string,
): Promise<void> {
  await assertCanManageClass(actor, classId);

  await getDb().collection(COLLECTIONS.classes).doc(classId).update({
    status: 'archived',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'class.archived',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    reason,
  });
}

/** Read helpers used by the server-rendered pages. */

export interface ClassSummary {
  id: string;
  classCode: string;
  className: string;
  courseId: string;
  semesterId: string;
  language: string;
  joinMode: string;
  status: string;
  studentCount: number;
}

function toClassSummary(data: FirebaseFirestore.DocumentData): ClassSummary {
  return {
    id: data.id as string,
    classCode: data.classCode as string,
    className: data.className as string,
    courseId: data.courseId as string,
    semesterId: data.semesterId as string,
    language: data.language as string,
    joinMode: data.joinMode as string,
    status: data.status as string,
    studentCount: (data.studentCount as number | undefined) ?? 0,
  };
}

export async function listClassesOfLecturer(uid: string): Promise<ClassSummary[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.classes)
    .where('lecturerIds', 'array-contains', uid)
    .get();
  return snapshot.docs.map((doc) => toClassSummary(doc.data()));
}

export async function listAllClasses(limit = 100): Promise<ClassSummary[]> {
  const snapshot = await getDb().collection(COLLECTIONS.classes).limit(limit).get();
  return snapshot.docs.map((doc) => toClassSummary(doc.data()));
}

export async function getClassById(classId: string): Promise<ClassSummary | null> {
  const snapshot = await getDb().collection(COLLECTIONS.classes).doc(classId).get();
  return snapshot.exists ? toClassSummary(snapshot.data() as FirebaseFirestore.DocumentData) : null;
}

export interface NamedRecord {
  id: string;
  name: string;
  parentId?: string;
}

export async function listAcademicYears(): Promise<NamedRecord[]> {
  const snapshot = await getDb().collection(COLLECTIONS.academicYears).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, name: doc.get('name') as string }));
}

export async function listSemesters(): Promise<NamedRecord[]> {
  const snapshot = await getDb().collection(COLLECTIONS.semesters).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.get('name') as string,
    parentId: doc.get('academicYearId') as string,
  }));
}

export async function listCourses(): Promise<NamedRecord[]> {
  const snapshot = await getDb().collection(COLLECTIONS.courses).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: `${doc.get('code') as string} — ${doc.get('name') as string}`,
  }));
}

export interface ClassLecturer {
  uid: string;
  fullName: string;
  email: string;
}

export async function listClassLecturers(classId: string): Promise<ClassLecturer[]> {
  const snapshot = await getDb().collection(COLLECTIONS.classes).doc(classId).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  const lecturerIds = (snapshot.get('lecturerIds') as string[] | undefined) ?? [];
  if (lecturerIds.length === 0) return [];

  const profiles = await getDb().getAll(
    ...lecturerIds.map((uid) => getDb().collection(COLLECTIONS.users).doc(uid)),
  );

  return profiles
    .filter((profile) => profile.exists)
    .map((profile) => ({
      uid: profile.id,
      fullName: (profile.get('fullName') as string | undefined) ?? profile.id,
      email: (profile.get('email') as string | undefined) ?? '',
    }));
}

/**
 * Puts another lecturer in charge of a class.
 *
 * Until this existed, a lecturer account created by an administrator could
 * reach no class at all: `createClass` names its creator as the only lecturer,
 * and every teaching screen goes through `assertCanManageClass`. Marking is
 * the lecturer's alone (SRS 13), so the class has to be able to acquire one.
 */
export async function addClassLecturer(
  actor: SessionUser,
  classId: string,
  email: string,
): Promise<ClassLecturer> {
  await assertCanManageClass(actor, classId);

  const matches = await getDb()
    .collection(COLLECTIONS.users)
    .where('email', '==', email.trim().toLowerCase())
    .limit(1)
    .get();

  const profile = matches.docs[0];
  if (!profile) throw new AppError('NOT_FOUND', 'errors.noAccountWithThatEmail');

  const role = profile.get('globalRole') as string | undefined;
  if (role !== 'lecturer' && role !== 'admin') {
    throw new AppError('POLICY_VIOLATION', 'errors.notALecturerAccount');
  }

  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(classId)
    .update({
      lecturerIds: FieldValue.arrayUnion(profile.id),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await writeAuditLog({
    action: 'class.lecturer_added',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: { lecturerUid: profile.id },
  });

  return {
    uid: profile.id,
    fullName: (profile.get('fullName') as string | undefined) ?? profile.id,
    email: (profile.get('email') as string | undefined) ?? email,
  };
}
