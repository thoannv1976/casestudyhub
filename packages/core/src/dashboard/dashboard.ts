import {
  COLLECTIONS,
  assignmentProgress,
  currentVersionsOf,
  type AssignmentProgress,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { listClassesOfStudent } from '../academic/enrollment';
import { listAssignments } from '../assignments/assignments';
import { listMembers } from '../groups/groups';
import { policyOfAssignment } from '../policy/policy-store';
import type { SessionUser } from '../auth/types';

/**
 * What each person has to do next (SRS Modules 03 and 04).
 *
 * Nothing here is new information: it is the same assignments, sessions and
 * grades every other page reads, sorted by what is outstanding. The dashboard
 * existed before this and said "Phase 1 is being built" to everybody, which
 * was both useless and, by the time four phases were done, untrue.
 *
 * Every read is bounded. A lecturer with six classes and thirty groups should
 * not pay for a full scan to be told which three are behind, so the work is
 * done per active class and the lists are capped.
 */

const MAX_ROWS = 8;

export interface DashboardAssignment {
  assignmentId: string;
  classId: string;
  className: string;
  groupId: string;
  groupName: string;
  caseTitle: string;
  submissionDeadline: string;
  progress: AssignmentProgress;
}

export interface DashboardSession {
  sessionId: string;
  classId: string;
  className: string;
  groupName: string;
  caseTitle: string;
}

export interface Dashboard {
  /** Assignments with something outstanding, soonest deadline first. */
  outstanding: DashboardAssignment[];
  /** Sessions running right now in a class this person belongs to. */
  live: DashboardSession[];
  /** Marks published to this student recently. Empty for staff. */
  published: DashboardAssignment[];
  /** Classes this person teaches or is enrolled on. */
  classes: { classId: string; className: string; classCode: string }[];
}

interface ClassContext {
  classId: string;
  className: string;
  classCode: string;
}

async function classesOfStaff(uid: string): Promise<ClassContext[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.classes)
    .where('lecturerIds', 'array-contains', uid)
    .where('status', '==', 'active')
    .get();

  return snapshot.docs.map((doc) => ({
    classId: doc.id,
    className: (doc.get('className') as string | undefined) ?? doc.id,
    classCode: (doc.get('classCode') as string | undefined) ?? '',
  }));
}

async function classesOfStudent(uid: string): Promise<ClassContext[]> {
  const enrollments = (await listClassesOfStudent(uid)).filter(
    (enrollment) => enrollment.status === 'active',
  );
  if (enrollments.length === 0) return [];

  const db = getDb();
  const docs = await Promise.all(
    enrollments.map((enrollment) =>
      db.collection(COLLECTIONS.classes).doc(enrollment.classId).get(),
    ),
  );

  return docs
    .filter((doc) => doc.exists)
    .map((doc) => ({
      classId: doc.id,
      className: (doc.get('className') as string | undefined) ?? doc.id,
      classCode: (doc.get('classCode') as string | undefined) ?? '',
    }));
}

/** Titles are read once per class rather than once per assignment. */
async function caseTitles(caseIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(caseIds)];
  if (unique.length === 0) return new Map();

  const db = getDb();
  const docs = await Promise.all(
    unique.map((id) => db.collection(COLLECTIONS.caseStudies).doc(id).get()),
  );

  return new Map(docs.map((doc) => [doc.id, (doc.get('title') as string | undefined) ?? doc.id]));
}

async function groupNames(classId: string): Promise<Map<string, string>> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.groups)
    .where('classId', '==', classId)
    .get();
  return new Map(
    snapshot.docs.map((doc) => [doc.id, (doc.get('groupName') as string | undefined) ?? doc.id]),
  );
}

/**
 * How far each of these assignments has got.
 *
 * Read per assignment rather than per class so the same function answers for
 * one group's work on the dashboard and for a whole class on the teaching
 * page - there is only one definition of "behind", and it lives here.
 */
export async function progressOfAssignments(
  assignments: readonly {
    id: string;
    policyId: string;
    policyVersion: string;
    submissionDeadline: string;
  }[],
  now = Date.now(),
): Promise<Record<string, AssignmentProgress>> {
  const db = getDb();

  const entries = await Promise.all(
    assignments.map(async (assignment) => {
      const [policy, submissionDocs, assessment, grades] = await Promise.all([
        policyOfAssignment(assignment),
        db.collection(COLLECTIONS.submissions).where('assignmentId', '==', assignment.id).get(),
        db.collection(COLLECTIONS.lecturerAssessments).doc(assignment.id).get(),
        db.collection(COLLECTIONS.grades).where('assignmentId', '==', assignment.id).limit(1).get(),
      ]);

      const submitted = currentVersionsOf(
        submissionDocs.docs.map((doc) => ({
          deliverableId: doc.get('deliverableId') as string,
          versionNumber: doc.get('versionNumber') as number,
          isLate: Boolean(doc.get('isLate')),
        })),
      );

      return [
        assignment.id,
        assignmentProgress({
          requiredDeliverables: policy.deliverables,
          submitted,
          submissionDeadline: assignment.submissionDeadline,
          nowMs: now,
          marked: assessment.exists,
          published: !grades.empty,
        }),
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export async function dashboardFor(user: SessionUser, now = Date.now()): Promise<Dashboard> {
  const isStaff = user.role === 'admin' || user.role === 'lecturer';
  const classes = isStaff ? await classesOfStaff(user.uid) : await classesOfStudent(user.uid);

  const outstanding: DashboardAssignment[] = [];
  const published: DashboardAssignment[] = [];
  const live: DashboardSession[] = [];
  const db = getDb();

  for (const context of classes) {
    const [assignments, groups, members, sessions] = await Promise.all([
      listAssignments(context.classId),
      groupNames(context.classId),
      isStaff ? Promise.resolve([]) : listMembers(context.classId),
      db
        .collection(COLLECTIONS.presentationSessions)
        .where('classId', '==', context.classId)
        .where('status', '==', 'live')
        .get(),
    ]);

    // A student only sees their own group's work; a lecturer sees the class.
    const ownGroupId = isStaff
      ? null
      : (members.find((member) => member.studentUid === user.uid)?.groupId ?? null);
    const mine = isStaff
      ? assignments
      : assignments.filter((assignment) => assignment.groupId === ownGroupId);

    // Titles are needed for the live session too, and that session belongs to
    // a group this person may not be in - a student in the audience would
    // otherwise be told a presentation is running with no idea of what.
    const titles = await caseTitles([
      ...mine.map((assignment) => assignment.caseStudyId),
      ...sessions.docs.map((doc) => doc.get('caseStudyId') as string),
    ]);

    for (const session of sessions.docs) {
      live.push({
        sessionId: session.id,
        classId: context.classId,
        className: context.className,
        groupName: groups.get(session.get('groupId') as string) ?? '',
        caseTitle: titles.get(session.get('caseStudyId') as string) ?? '',
      });
    }

    const progressById = await progressOfAssignments(mine, now);

    for (const assignment of mine) {
      const progress = progressById[assignment.id];
      if (!progress) continue;

      const row: DashboardAssignment = {
        assignmentId: assignment.id,
        classId: context.classId,
        className: context.className,
        groupId: assignment.groupId,
        groupName: groups.get(assignment.groupId) ?? assignment.groupId,
        caseTitle: titles.get(assignment.caseStudyId) ?? assignment.caseStudyId,
        submissionDeadline: assignment.submissionDeadline,
        progress,
      };

      if (progress.state === 'published') published.push(row);
      // A student is shown what they still owe; a lecturer what is waiting on
      // them. Neither wants a list of work that is finished and marked.
      else if (isStaff ? progress.needsLecturer : progress.missing > 0) outstanding.push(row);
    }
  }

  const bySoonest = (a: DashboardAssignment, b: DashboardAssignment) =>
    a.submissionDeadline.localeCompare(b.submissionDeadline);

  return {
    outstanding: outstanding.sort(bySoonest).slice(0, MAX_ROWS),
    live,
    published: published.sort((a, b) => bySoonest(b, a)).slice(0, MAX_ROWS),
    classes,
  };
}
