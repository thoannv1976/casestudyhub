import {
  COLLECTIONS,
  assignmentProgress,
  currentVersionsOf,
  gradeSchema,
  lecturerAssessmentSchema,
  projectTargetId,
  type AssignmentProgress,
  type Deliverable,
  type GradedWorkKind,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { listAssignments } from '../assignments/assignments';
import { listCases } from '../cases/cases';
import { listGroups, listMembers } from '../groups/groups';
import { getClassProject } from '../projects/projects';
import { getPolicy, policyOfAssignment } from '../policy/policy-store';

/**
 * One table for a whole class: who has handed in, what is still unmarked, and
 * what has been published - across both pieces of work a group owes.
 *
 * The three answers already existed in three places: the progress table on the
 * class page, the project table beside it, and the class report, which shows
 * published marks only. None of them answered the question a lecturer actually
 * asks in the last fortnight of a term, which is "what is left".
 *
 * The number of reads is the design here. Done the obvious way - per group,
 * per piece of work, per kind of record - a twenty-group class costs about a
 * hundred and eighty queries and gets slower every week it is used. Instead
 * everything is fetched in a handful of class-wide queries and joined in
 * memory: eight queries for a class of any size. `onQuery` exists so a test
 * can hold that down rather than trusting it.
 */

/** Firestore takes at most thirty values in an `in` filter. */
const GROUP_BATCH = 30;

export interface OverviewRow {
  /** What submissions and marks are recorded against. */
  targetId: string;
  kind: GradedWorkKind;
  groupId: string;
  groupName: string;
  memberCount: number;
  /** The case's title; null for the project, which the interface names. */
  subject: string | null;
  submissionDeadline: string;
  requiredCount: number;
  handedInCount: number;
  progress: AssignmentProgress;
  marking: 'unmarked' | 'draft' | 'published';
  /** The group's rubric total as the lecturer saved it, before weighting. */
  groupScoreRaw: number | null;
  /** Points earned outside the rubric. Null for a case study, which has none. */
  bonusPoints: number | null;
  /** Mean published final mark across the group's members. */
  averageFinalScore: number | null;
  gradedStudents: number;
}

export interface OverviewTotals {
  work: number;
  complete: number;
  missing: number;
  late: number;
  unmarked: number;
  draft: number;
  published: number;
}

export interface ClassOverview {
  rows: OverviewRow[];
  totals: OverviewTotals;
}

export interface OverviewOptions {
  now?: number;
  /** Test seam: called once per database query, with a name for it. */
  onQuery?: (label: string) => void;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export async function classOverview(
  classId: string,
  options: OverviewOptions = {},
): Promise<ClassOverview> {
  const now = options.now ?? Date.now();
  const note = options.onQuery ?? (() => {});
  const db = getDb();

  note('groups');
  note('members');
  note('assignments');
  note('cases');
  note('project');
  const [groups, members, assignments, cases, project] = await Promise.all([
    listGroups(classId),
    listMembers(classId),
    listAssignments(classId),
    listCases(),
    getClassProject(classId),
  ]);

  const groupIds = groups.map((group) => group.id);

  // Class-wide rather than per row. A group belongs to exactly one class, so
  // filtering by group id cannot reach another course's work.
  const [assessmentDocs, submissionDocs, gradeDocs] = await Promise.all([
    (async () => {
      note('assessments');
      return (
        await db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', classId).get()
      ).docs;
    })(),
    (async () => {
      const batches = await Promise.all(
        chunk(groupIds, GROUP_BATCH).map(async (batch) => {
          note('submissions');
          return (await db.collection(COLLECTIONS.submissions).where('groupId', 'in', batch).get())
            .docs;
        }),
      );
      return batches.flat();
    })(),
    (async () => {
      const batches = await Promise.all(
        chunk(groupIds, GROUP_BATCH).map(async (batch) => {
          note('grades');
          return (await db.collection(COLLECTIONS.grades).where('groupId', 'in', batch).get()).docs;
        }),
      );
      return batches.flat();
    })(),
  ]);

  const assessments = new Map(
    assessmentDocs
      .map((doc) => lecturerAssessmentSchema.safeParse(doc.data()))
      .filter((parsed) => parsed.success)
      .map((parsed) => [parsed.data.assignmentId, parsed.data]),
  );

  const grades = gradeDocs
    .map((doc) => gradeSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  const submittedFor = (targetId: string) =>
    currentVersionsOf(
      submissionDocs
        .filter((doc) => doc.get('assignmentId') === targetId)
        .map((doc) => ({
          deliverableId: doc.get('deliverableId') as string,
          versionNumber: doc.get('versionNumber') as number,
          isLate: Boolean(doc.get('isLate')),
        })),
    );

  const nameOf = (groupId: string) =>
    groups.find((group) => group.id === groupId)?.groupName ?? groupId;
  const membersOf = (groupId: string) =>
    members.filter((member) => member.groupId === groupId).length;

  const rows: OverviewRow[] = [];

  const rowFor = (input: {
    targetId: string;
    kind: GradedWorkKind;
    groupId: string;
    subject: string | null;
    submissionDeadline: string;
    required: readonly Deliverable[];
    bonusPoints: number | null;
  }): OverviewRow => {
    const submitted = submittedFor(input.targetId);
    const assessment = assessments.get(input.targetId) ?? null;
    const published = grades.filter(
      (grade) => grade.assignmentId === input.targetId && grade.status === 'published',
    );

    return {
      targetId: input.targetId,
      kind: input.kind,
      groupId: input.groupId,
      groupName: nameOf(input.groupId),
      memberCount: membersOf(input.groupId),
      subject: input.subject,
      submissionDeadline: input.submissionDeadline,
      requiredCount: input.required.filter((item) => item.required).length,
      handedInCount: submitted.length,
      progress: assignmentProgress({
        requiredDeliverables: input.required,
        submitted,
        submissionDeadline: input.submissionDeadline,
        nowMs: now,
        marked: assessment !== null,
        published: published.length > 0,
      }),
      marking:
        published.length > 0 ? 'published' : assessment === null ? 'unmarked' : assessment.status,
      groupScoreRaw: assessment?.groupScoreRaw ?? null,
      bonusPoints: input.bonusPoints,
      averageFinalScore: mean(published.map((grade) => grade.finalScore)),
      gradedStudents: published.length,
    };
  };

  for (const assignment of assignments) {
    // The framework this assignment froze, which is what decides how many
    // deliverables it owes. Versions are immutable and cached, so a class of
    // thirty assignments on one framework costs one read, not thirty.
    const policy = await policyOfAssignment(assignment);
    rows.push(
      rowFor({
        targetId: assignment.id,
        kind: 'case_study',
        groupId: assignment.groupId,
        subject:
          cases.find((study) => study.id === assignment.caseStudyId)?.title ??
          assignment.caseStudyId,
        submissionDeadline: assignment.submissionDeadline,
        required: policy.deliverables,
        bonusPoints: null,
      }),
    );
  }

  if (project) {
    const policy = await getPolicy(project.policyId, project.policyVersion);
    for (const group of groups) {
      const assessment = assessments.get(projectTargetId(classId, group.id));
      rows.push(
        rowFor({
          targetId: projectTargetId(classId, group.id),
          kind: 'group_project',
          groupId: group.id,
          subject: null,
          submissionDeadline: project.deadline,
          required: policy.projectDeliverables,
          // What the awards were worth under the version the project froze,
          // not under whatever the framework says today.
          bonusPoints:
            (assessment?.bonus?.mvp ? policy.projectBonus.mvpPoints : 0) +
            (assessment?.bonus?.video ? policy.projectBonus.videoPoints : 0),
        }),
      );
    }
  }

  // Soonest deadline first: the lecturer's own order of work.
  rows.sort(
    (a, b) =>
      a.submissionDeadline.localeCompare(b.submissionDeadline) ||
      a.groupName.localeCompare(b.groupName),
  );

  return {
    rows,
    totals: {
      work: rows.length,
      complete: rows.filter((row) => row.progress.missing === 0).length,
      missing: rows.filter((row) => row.progress.missing > 0).length,
      late: rows.filter((row) => row.progress.lateItems > 0).length,
      unmarked: rows.filter((row) => row.marking === 'unmarked').length,
      draft: rows.filter((row) => row.marking === 'draft').length,
      published: rows.filter((row) => row.marking === 'published').length,
    },
  };
}
