import { NextResponse, type NextRequest } from 'next/server';
import { reviewQuestionSchema } from '@casestudyhub/shared';
import {
  AppError,
  assertCanManageClass,
  getQuestion,
  getUserProfile,
  reviewQuestion,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The lecturer settles an answer, or marks a question or an answer as worth
 * reading again. Only on a question of a class they teach.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const input = reviewQuestionSchema.parse(await request.json());
    const question = await getQuestion(input.questionId);
    // The class in the address is the one checked; the question must be in it.
    if (!question || question.classId !== classId) {
      throw new AppError('NOT_FOUND', 'errors.questionNotFound');
    }

    const profile = await getUserProfile(caller.uid);
    const reviewed = await reviewQuestion(caller, profile?.fullName ?? caller.email, input);
    return NextResponse.json({ question: reviewed });
  } catch (error) {
    return respondWithError(error);
  }
}
