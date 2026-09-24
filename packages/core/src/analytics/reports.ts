import {
  COLLECTIONS,
  cloAttainment,
  criterionAverages,
  distributionOf,
  lecturerAssessmentSchema,
  participationOf,
  gradeSchema,
  type CloAttainment,
  type CriterionAverage,
  type Distribution,
  type Grade,
  type Participation,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { policyOfClass } from '../policy/policy-store';
import { listRoster, listClassesOfStudent } from '../academic/enrollment';
import { listAssignments } from '../assignments/assignments';
import { listGroups, listMembers } from '../groups/groups';
import { getClassById } from '../academic/structure';
import { listSessions } from '../sessions/sessions';
import { getCase } from '../cases/cases';

/**
 * Class and CLO reporting (SRS Module 14).
 *
 * Reads what was already awarded and shapes it; it never computes or changes a
 * mark. Only published grades are counted: a draft is the lecturer's working
 * note, and a report built on drafts would move under the reader.
 */

/** The share of a learning outcome a piece of work must reach to have met it. */
export const DEFAULT_CLO_THRESHOLD = 0.5;

export interface ClassReport {
  classId: string;
  className: string;
  classCode: string;
  /** Marked assignments the report rests on. */
  markedAssignments: number;
  totalAssignments: number;
  publishedGrades: number;
  distribution: Distribution;
  criteria: CriterionAverage[];
  clos: CloAttainment[];
  cloThreshold: number;
  participation: Participation;
  lateGroups: number;
  /**
   * True while some work is marked but not published. The distribution counts
   * published grades only, so the reader needs to know what is missing.
   */
  hasUnpublishedMarking: boolean;
}

export async function classReport(
  classId: string,
  options: { cloThreshold?: number } = {},
): Promise<ClassReport> {
  const db = getDb();
  const threshold = options.cloThreshold ?? DEFAULT_CLO_THRESHOLD;

  const [policy, details, roster, assignments, sessions] = await Promise.all([
    policyOfClass(classId),
    getClassById(classId),
    listRoster(classId),
    listAssignments(classId),
    listSessions(classId),
  ]);

  const assignmentIds = assignments.map((assignment) => assignment.id);

  const [markingDocs, gradeSnapshots, questionDocs, responseDocs, peerDocs] = await Promise.all([
    db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', classId).get(),
    Promise.all(
      assignmentIds.map((assignmentId) =>
        db.collection(COLLECTIONS.grades).where('assignmentId', '==', assignmentId).get(),
      ),
    ),
    db.collection(COLLECTIONS.questions).where('classId', '==', classId).get(),
    db.collection(COLLECTIONS.questionResponses).where('classId', '==', classId).get(),
    db.collection(COLLECTIONS.peerReviews).where('classId', '==', classId).get(),
  ]);

  const marking = markingDocs.docs
    .map((doc) => lecturerAssessmentSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  // Published only: a draft is the lecturer's working note, and a
  // distribution built on drafts would move under the reader.
  const grades: Grade[] = gradeSnapshots
    .flatMap((snapshot) => snapshot.docs)
    .map((doc) => gradeSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .filter((grade) => grade.status === 'published');

  const marked = marking.map((entry) => ({ scores: entry.criterionScores }));
  const activeUids = roster
    .filter((row) => row.status === 'active' && row.studentUid)
    .map((row) => row.studentUid as string);

  return {
    classId,
    className: details?.className ?? classId,
    classCode: details?.classCode ?? '',
    markedAssignments: marking.length,
    totalAssignments: assignments.length,
    publishedGrades: grades.length,
    distribution: distributionOf(grades.map((grade) => grade.finalScore)),
    criteria: criterionAverages(marked, policy.rubric),
    clos: cloAttainment(marked, policy.rubric, threshold),
    cloThreshold: threshold,
    participation: participationOf({
      enrolledUids: activeUids,
      askedUids: questionDocs.docs.map((doc) => doc.get('askedByUid') as string),
      answeredUids: responseDocs.docs.map((doc) => doc.get('responderUid') as string),
      scoredUids: peerDocs.docs.map((doc) => doc.get('reviewerUid') as string),
    }),
    lateGroups: sessions.length === 0 ? 0 : await countLateGroups(assignmentIds),
    hasUnpublishedMarking: marking.some((entry) => entry.status !== 'published'),
  };
}

async function countLateGroups(assignmentIds: readonly string[]): Promise<number> {
  if (assignmentIds.length === 0) return 0;
  const db = getDb();
  const snapshots = await Promise.all(
    assignmentIds.map((assignmentId) =>
      db
        .collection(COLLECTIONS.submissions)
        .where('assignmentId', '==', assignmentId)
        .where('isLate', '==', true)
        .limit(1)
        .get(),
    ),
  );
  return snapshots.filter((snapshot) => !snapshot.empty).length;
}

export interface PortfolioEntry {
  classId: string;
  className: string;
  classCode: string;
  groupId: string | null;
  groupName: string | null;
  roleIds: string[];
  caseTitle: string | null;
  /** Only once published. A draft is not a result. */
  finalScore: number | null;
  groupScore: number | null;
  individualScore: number | null;
  questionsAsked: number;
  questionsAnsweredAloud: number;
  peerScoresGiven: number;
}

export interface Portfolio {
  entries: PortfolioEntry[];
  totals: {
    classes: number;
    questionsAsked: number;
    questionsAnsweredAloud: number;
    peerScoresGiven: number;
    rolesHeld: string[];
    publishedScores: number[];
  };
}

/**
 * What one student has done, across every class (SRS Module 14.3).
 *
 * Contribution rather than only marks: the roles they carried, the questions
 * they asked, the ones they answered in the room, the groups they scored. A
 * student who was quiet all semester sees that here, which is the point.
 */
export async function studentPortfolio(uid: string): Promise<Portfolio> {
  const db = getDb();
  const enrollments = (await listClassesOfStudent(uid)).filter(
    (enrollment) => enrollment.status !== 'removed',
  );

  const [questionDocs, responseDocs, peerDocs, gradeDocs] = await Promise.all([
    db.collection(COLLECTIONS.questions).where('askedByUid', '==', uid).get(),
    db.collection(COLLECTIONS.questionResponses).where('responderUid', '==', uid).get(),
    db.collection(COLLECTIONS.peerReviews).where('reviewerUid', '==', uid).get(),
    db
      .collection(COLLECTIONS.grades)
      .where('studentUid', '==', uid)
      .where('status', '==', 'published')
      .get(),
  ]);

  const countBy = (docs: readonly FirebaseFirestore.QueryDocumentSnapshot[], classId: string) =>
    docs.filter((doc) => doc.get('classId') === classId).length;

  const entries: PortfolioEntry[] = [];

  for (const enrollment of enrollments) {
    const [details, members, assignments, groups] = await Promise.all([
      getClassById(enrollment.classId),
      listMembers(enrollment.classId),
      listAssignments(enrollment.classId),
      listGroups(enrollment.classId),
    ]);

    const membership = members.find((member) => member.studentUid === uid);
    const assignment = assignments.find((candidate) => candidate.groupId === membership?.groupId);
    const caseStudy = assignment ? await getCase(assignment.caseStudyId) : null;

    const grade = gradeDocs.docs
      .map((doc) => gradeSchema.safeParse(doc.data()))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
      .find((candidate) => candidate.assignmentId === assignment?.id);

    entries.push({
      classId: enrollment.classId,
      className: details?.className ?? enrollment.classId,
      classCode: details?.classCode ?? '',
      groupId: membership?.groupId ?? null,
      groupName: groups.find((group) => group.id === membership?.groupId)?.groupName ?? null,
      roleIds: membership?.roleIds ?? [],
      caseTitle: caseStudy?.title ?? null,
      finalScore: grade?.finalScore ?? null,
      groupScore: grade?.groupScore ?? null,
      individualScore: grade?.individualScore ?? null,
      questionsAsked: countBy(questionDocs.docs, enrollment.classId),
      questionsAnsweredAloud: countBy(responseDocs.docs, enrollment.classId),
      peerScoresGiven: countBy(peerDocs.docs, enrollment.classId),
    });
  }

  return {
    entries,
    totals: {
      classes: entries.length,
      questionsAsked: questionDocs.size,
      questionsAnsweredAloud: responseDocs.size,
      peerScoresGiven: peerDocs.size,
      rolesHeld: [...new Set(entries.flatMap((entry) => entry.roleIds))].sort(),
      publishedScores: entries
        .map((entry) => entry.finalScore)
        .filter((score): score is number => score !== null),
    },
  };
}
