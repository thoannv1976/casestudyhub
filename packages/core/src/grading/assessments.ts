import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_PRESENTATION_POLICY,
  computeStudentScore,
  gradeSchema,
  lecturerAssessmentSchema,
  sumRubricScores,
  type Grade,
  type IndividualAssessment,
  type LecturerAssessment,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { notify } from '../notifications/notifications';
import { AppError } from '../errors';
import { getAssignment } from '../assignments/assignments';
import { getCase } from '../cases/cases';
import { currentVersions, listSubmissions } from '../submissions/submissions';
import { listMembers } from '../groups/groups';
import type { SessionUser } from '../auth/types';

/**
 * Marking and publishing (SRS Module 13).
 *
 * The assessment is keyed by assignment, so one group's presentation of one
 * case has exactly one mark. Publishing is a transaction: either every member
 * of the group has a grade and the assessment is published, or nothing moved.
 * A half-published group would mean some students seeing a mark and others
 * being told to wait, with no way to tell which is which.
 */

function parse(data: FirebaseFirestore.DocumentData): LecturerAssessment | null {
  const parsed = lecturerAssessmentSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function getLecturerAssessment(
  assignmentId: string,
): Promise<LecturerAssessment | null> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.lecturerAssessments)
    .doc(assignmentId)
    .get();
  return snapshot.exists ? parse(snapshot.data() as FirebaseFirestore.DocumentData) : null;
}

/** Whether the group's required work arrived after the deadline. */
export async function groupSubmittedLate(assignmentId: string): Promise<boolean> {
  const submissions = currentVersions(await listSubmissions(assignmentId));
  return submissions.some((submission) => submission.isLate);
}

export interface SaveAssessmentInput {
  criterionScores: Record<string, number>;
  comment?: string;
  latePenaltyWaived: boolean;
  latePenaltyWaiverReason?: string;
  individual: Record<string, IndividualAssessment>;
}

export async function saveLecturerAssessment(
  actor: SessionUser,
  actorName: string,
  assignmentId: string,
  input: SaveAssessmentInput,
): Promise<LecturerAssessment> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const existing = await getLecturerAssessment(assignmentId);
  // A published grade is a statement to students. Changing it is a new
  // decision with its own audit trail, not an edit of the old one.
  if (existing?.status === 'published') {
    throw new AppError('CONFLICT', 'errors.gradeAlreadyPublished');
  }

  const policy = DEFAULT_PRESENTATION_POLICY;
  let groupScoreRaw: number;
  try {
    groupScoreRaw = sumRubricScores(
      Object.entries(input.criterionScores).map(([criterionId, points]) => ({
        criterionId,
        points,
      })),
      policy,
    );
  } catch {
    // `sumRubricScores` throws for an unknown criterion or a score above its
    // maximum; both reach the lecturer as one correctable message.
    throw new AppError('VALIDATION_FAILED', 'errors.criterionScoreOutOfRange');
  }

  // Every criterion must be marked: a rubric with a gap is not a mark.
  for (const criterion of policy.rubric.criteria) {
    if (input.criterionScores[criterion.id] === undefined) {
      throw new AppError('VALIDATION_FAILED', 'errors.criterionScoreRequired', {
        details: { criterionId: criterion.id },
      });
    }
  }

  const members = (await listMembers(assignment.classId)).filter(
    (member) => member.groupId === assignment.groupId,
  );
  for (const member of members) {
    if (!input.individual[member.studentUid]) {
      throw new AppError('VALIDATION_FAILED', 'errors.individualScoreRequired', {
        details: { studentUid: member.studentUid },
      });
    }
  }

  const assessment: LecturerAssessment = {
    id: assignmentId,
    assignmentId,
    classId: assignment.classId,
    groupId: assignment.groupId,
    caseStudyId: assignment.caseStudyId,
    criterionScores: input.criterionScores,
    groupScoreRaw,
    ...(input.comment ? { comment: input.comment } : {}),
    latePenaltyWaived: input.latePenaltyWaived,
    ...(input.latePenaltyWaiverReason
      ? { latePenaltyWaiverReason: input.latePenaltyWaiverReason }
      : {}),
    individual: input.individual,
    rubricId: policy.rubric.id,
    rubricVersion: assignment.rubricVersion,
    policyId: assignment.policyId,
    policyVersion: assignment.policyVersion,
    status: 'draft',
    assessedByUid: actor.uid,
    assessedByName: actorName,
    updatedAt: new Date().toISOString(),
  };

  await getDb()
    .collection(COLLECTIONS.lecturerAssessments)
    .doc(assignmentId)
    .set({ ...assessment, savedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'grade.drafted',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.lecturerAssessments}/${assignmentId}`,
    classId: assignment.classId,
    after: { groupScoreRaw },
  });

  return assessment;
}

export interface GradePreviewRow {
  studentUid: string;
  studentId: string;
  fullName: string;
  breakdown: ReturnType<typeof computeStudentScore>;
}

/**
 * What each student would get, computed from the saved assessment. The
 * lecturer sees this before publishing: the mark, the weighting, the late
 * penalty and any forfeited individual share, all traced to a policy version.
 */
export async function previewGrades(assignmentId: string): Promise<GradePreviewRow[]> {
  const assessment = await getLecturerAssessment(assignmentId);
  if (!assessment) throw new AppError('NOT_FOUND', 'errors.assessmentNotFound');

  const policy = DEFAULT_PRESENTATION_POLICY;
  const isLate = await groupSubmittedLate(assignmentId);
  const members = (await listMembers(assessment.classId)).filter(
    (member) => member.groupId === assessment.groupId,
  );

  return members.map((member) => {
    const individual = assessment.individual[member.studentUid];
    return {
      studentUid: member.studentUid,
      studentId: member.studentId,
      fullName: member.fullName,
      breakdown: computeStudentScore(
        {
          rawScore: assessment.groupScoreRaw,
          isLate,
          ...(assessment.latePenaltyWaived
            ? {
                latePenaltyOverride: {
                  waived: true,
                  reason: assessment.latePenaltyWaiverReason ?? '',
                  byUid: assessment.assessedByUid,
                },
              }
            : {}),
        },
        {
          rawScore: individual?.rawScore ?? 0,
          didNotPresent: individual?.didNotPresent ?? false,
          failedOwnRoleQuestion: individual?.failedOwnRoleQuestion ?? false,
        },
        policy,
      ),
    };
  });
}

/**
 * Publishes the group's grades. All of them, or none: a student told to wait
 * while their group-mate already sees a mark has no way to know why.
 */
export async function publishGrades(actor: SessionUser, assignmentId: string): Promise<Grade[]> {
  const rows = await previewGrades(assignmentId);
  const assessment = await getLecturerAssessment(assignmentId);
  if (!assessment) throw new AppError('NOT_FOUND', 'errors.assessmentNotFound');
  if (assessment.status === 'published') {
    throw new AppError('CONFLICT', 'errors.gradeAlreadyPublished');
  }
  if (rows.length === 0) throw new AppError('POLICY_VIOLATION', 'errors.noGroupMembersToGrade');

  const db = getDb();
  const publishedAt = new Date().toISOString();

  const grades: Grade[] = rows.map((row) => ({
    id: `${assignmentId}__${row.studentUid}`,
    assignmentId,
    groupId: assessment.groupId,
    studentUid: row.studentUid,
    groupScore: row.breakdown.groupScoreAfterPenalty,
    individualScore: row.breakdown.individualScoreApplied,
    finalScore: row.breakdown.finalScore,
    policyId: row.breakdown.policyId,
    policyVersion: row.breakdown.policyVersion,
    status: 'published',
    publishedAt,
    publishedByUid: actor.uid,
  }));

  await db.runTransaction(async (tx) => {
    const assessmentRef = db.collection(COLLECTIONS.lecturerAssessments).doc(assignmentId);
    const current = await tx.get(assessmentRef);
    if (current.get('status') === 'published') {
      throw new AppError('CONFLICT', 'errors.gradeAlreadyPublished');
    }

    for (const grade of grades) {
      tx.set(db.collection(COLLECTIONS.grades).doc(grade.id), {
        ...gradeSchema.parse(grade),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(assessmentRef, { status: 'published', publishedAt });
  });

  // The reason this module exists, from the student's side: a mark is out and
  // nobody had to be told in person.
  const assignment = await getAssignment(assignmentId);
  const caseStudy = assignment ? await getCase(assignment.caseStudyId) : null;
  await notify({
    recipientUids: grades.map((grade) => grade.studentUid),
    kind: 'grade.published',
    // Named, because a class marks several cases in a term and "your mark is
    // out" does not say which one.
    params: { case: caseStudy?.title ?? assignment?.caseStudyId ?? '' },
    href: `/classes/${assessment.classId}`,
  });

  await writeAuditLog({
    action: 'grade.published',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.lecturerAssessments}/${assignmentId}`,
    classId: assessment.classId,
    after: { students: grades.length },
  });

  return grades;
}

export async function listGradesForAssignment(assignmentId: string): Promise<Grade[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.grades)
    .where('assignmentId', '==', assignmentId)
    .get();

  return snapshot.docs
    .map((doc) => gradeSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

/** A student sees a mark only once it has been published. */
export async function listPublishedGradesOfStudent(uid: string): Promise<Grade[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.grades)
    .where('studentUid', '==', uid)
    .where('status', '==', 'published')
    .get();

  return snapshot.docs
    .map((doc) => gradeSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}
