import { NextResponse, type NextRequest } from 'next/server';
import { saveLecturerAssessmentSchema } from '@casestudyhub/shared';
import {
  AppError,
  assertCanManageClass,
  getAssignment,
  getLecturerAssessment,
  projectTargetOf,
  getUserProfile,
  previewGrades,
  publishGrades,
  saveLecturerAssessment,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Which class a piece of work belongs to, of either kind. Marking the class
 * group project goes through this same route: the pipeline behind it is one
 * pipeline, so the permission check has to be one check too.
 */
async function classOfWork(assignmentId: string): Promise<string> {
  const project = await projectTargetOf(assignmentId);
  if (project) return project.classId;

  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  return assignment.classId;
}

/**
 * Saving a mark and publishing it are deliberately separate permissions and
 * separate requests (SRS 13.4). Marking is a draft the lecturer can revise;
 * publishing is a statement to students.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const { assignmentId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const publishing = body.action === 'publish';

    const actor = await requirePermission(publishing ? 'grade.publish' : 'grade.draft');

    await assertCanManageClass(actor, await classOfWork(assignmentId));

    if (publishing) {
      const grades = await publishGrades(actor, assignmentId);
      return NextResponse.json({ grades });
    }

    const profile = await getUserProfile(actor.uid);
    const input = saveLecturerAssessmentSchema.parse(body);
    const assessment = await saveLecturerAssessment(
      actor,
      profile?.fullName ?? actor.email,
      assignmentId,
      {
        criterionScores: input.criterionScores,
        comment: input.comment,
        latePenaltyWaived: input.latePenaltyWaived,
        latePenaltyWaiverReason: input.latePenaltyWaiverReason,
        individual: input.individual,
        ...(input.bonus ? { bonus: input.bonus } : {}),
      },
    );

    return NextResponse.json({
      assessment,
      preview: await previewGrades(assignmentId),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const actor = await requirePermission('grade.draft');
    const { assignmentId } = await context.params;

    await assertCanManageClass(actor, await classOfWork(assignmentId));

    const assessment = await getLecturerAssessment(assignmentId);
    return NextResponse.json({
      assessment,
      preview: assessment ? await previewGrades(assignmentId) : [],
    });
  } catch (error) {
    return respondWithError(error);
  }
}
