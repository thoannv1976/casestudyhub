import { NextResponse, type NextRequest } from 'next/server';
import { submitPeerReviewSchema, summarisePeerReviews } from '@casestudyhub/shared';
import {
  AppError,
  assertCanViewClass,
  getOwnPeerReview,
  getSession,
  getUserProfile,
  listPeerReviews,
  policyOfAssignmentId,
  submitPeerReview,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * A student reads back their own review and nothing else. Only the staff see
 * the distribution, and only the staff see who gave what: a class that could
 * read each other's scores would start scoring each other's scores.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { sessionId } = await context.params;

    const session = await getSession(sessionId);
    if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
    await assertCanViewClass(caller, session.classId);

    const own = await getOwnPeerReview(sessionId, caller.uid);
    if (caller.role !== 'admin' && caller.role !== 'lecturer') {
      return NextResponse.json({ own });
    }

    const reviews = await listPeerReviews(sessionId);
    return NextResponse.json({
      own,
      reviews,
      summary: summarisePeerReviews(
        reviews,
        (await policyOfAssignmentId(session.assignmentId)).rubric,
      ),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { sessionId } = await context.params;

    const session = await getSession(sessionId);
    if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
    await assertCanViewClass(caller, session.classId);

    const profile = await getUserProfile(caller.uid);
    if (!profile?.studentId) {
      throw new AppError('POLICY_VIOLATION', 'errors.studentIdRequiredToJoin');
    }

    const input = submitPeerReviewSchema.parse(await request.json());
    const review = await submitPeerReview(
      caller,
      sessionId,
      { fullName: profile.fullName, studentId: profile.studentId },
      { scores: input.scores, comment: input.comment },
    );

    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
