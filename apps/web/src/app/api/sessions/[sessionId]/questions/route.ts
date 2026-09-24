import { NextResponse, type NextRequest } from 'next/server';
import { answerQuestionSchema, askQuestionSchema, redactForViewer } from '@casestudyhub/shared';
import {
  AppError,
  answerQuestion,
  askQuestion,
  assertCanViewClass,
  findMembership,
  getSession,
  getUserProfile,
  listSessionQuestions,
  selectQuestion,
  toggleUpvote,
  votesOf,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Everyone in the class reads the wall; the identities shown are filtered in the page. */
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

    const [questions, myVotes] = await Promise.all([
      listSessionQuestions(sessionId),
      votesOf(caller.uid, sessionId),
    ]);

    // Anonymity is applied here, not in the markup: the browser receives only
    // what this viewer is entitled to see.
    const viewer = {
      uid: caller.uid,
      isStaff: caller.role === 'admin' || caller.role === 'lecturer',
    };

    return NextResponse.json({
      questions: questions.map((question) => redactForViewer(question, viewer)),
      myVotes,
    });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * One endpoint for the four things that happen on the wall: asking, voting,
 * the group choosing what to answer, and recording the answer given.
 */
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

    const body = (await request.json()) as Record<string, unknown>;
    const profile = await getUserProfile(caller.uid);
    const membership = await findMembership(session.classId, caller.uid);
    const isPresenter = membership?.groupId === session.groupId;
    const isStaff = caller.role === 'admin' || caller.role === 'lecturer';

    switch (body.action) {
      case 'ask': {
        if (!profile?.studentId) {
          throw new AppError('POLICY_VIOLATION', 'errors.studentIdRequiredToJoin');
        }
        const input = askQuestionSchema.parse(body);
        const question = await askQuestion(
          caller,
          sessionId,
          { fullName: profile.fullName, studentId: profile.studentId },
          {
            category: input.category,
            text: input.text,
            roleId: input.roleId,
            anonymousToClass: input.anonymousToClass,
          },
        );
        return NextResponse.json({ question }, { status: 201 });
      }

      case 'upvote': {
        const upvotes = await toggleUpvote(caller, String(body.questionId ?? ''));
        return NextResponse.json({ upvotes });
      }

      case 'select': {
        // The group being asked chooses what it will answer aloud.
        if (!isPresenter && !isStaff) throw new AppError('FORBIDDEN', 'errors.notPresentingGroup');
        await selectQuestion(caller, String(body.questionId ?? ''), body.selected === true);
        return NextResponse.json({ ok: true });
      }

      case 'answer': {
        if (!isPresenter && !isStaff) throw new AppError('FORBIDDEN', 'errors.notPresentingGroup');
        const input = answerQuestionSchema.parse(body);
        await answerQuestion(
          caller,
          profile?.fullName ?? caller.email,
          input.questionId,
          input.answerText,
        );
        return NextResponse.json({ ok: true });
      }

      default:
        throw new AppError('VALIDATION_FAILED', 'errors.unknownKind');
    }
  } catch (error) {
    return respondWithError(error);
  }
}
