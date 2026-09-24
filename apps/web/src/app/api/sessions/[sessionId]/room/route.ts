import { NextResponse, type NextRequest } from 'next/server';
import { redactForViewer, type ClassQuestion } from '@casestudyhub/shared';
import {
  AppError,
  assertCanViewClass,
  findMembership,
  getOwnPeerReview,
  getSession,
  listSessionQuestions,
  votesOf,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Everything one person needs to see of a live session, in one request.
 *
 * The room used to be rendered once on the server and never updated: a
 * lecturer opening peer review, or closing the question window, reached
 * nobody until each of sixty students pressed reload. The page now polls this
 * endpoint every ten seconds, so the room's state travels with the questions.
 */

/**
 * The question list is the same for everyone in the room, so it is read once
 * per session rather than once per student. Sixty students polling every ten
 * seconds is six requests a second; without this, each one re-read every
 * question in the session.
 *
 * The session itself is deliberately NOT cached. That is the part a lecturer
 * changes mid-class, and ten seconds is already as long as anyone should wait
 * to be told the scoring window is open.
 */
const QUESTION_CACHE_MS = 5_000;
const questionCache = new Map<string, { at: number; questions: ClassQuestion[] }>();

async function questionsFor(sessionId: string): Promise<ClassQuestion[]> {
  const cached = questionCache.get(sessionId);
  if (cached && Date.now() - cached.at < QUESTION_CACHE_MS) return cached.questions;

  const questions = await listSessionQuestions(sessionId);
  questionCache.set(sessionId, { at: Date.now(), questions });

  // One entry per live session is nothing, but a process that runs for weeks
  // should not accumulate every session of the term.
  if (questionCache.size > 50) {
    for (const [key, value] of questionCache) {
      if (Date.now() - value.at > QUESTION_CACHE_MS) questionCache.delete(key);
    }
  }

  return questions;
}

/** Test seam: the cache is per process, and a test needs a clean one. */
export function clearRoomCache(): void {
  questionCache.clear();
}

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

    const isStaff = caller.role === 'admin' || caller.role === 'lecturer';
    const [questions, myVotes, membership, ownReview] = await Promise.all([
      questionsFor(sessionId),
      votesOf(caller.uid, sessionId),
      findMembership(session.classId, caller.uid),
      getOwnPeerReview(sessionId, caller.uid),
    ]);

    return NextResponse.json({
      session,
      // Anonymity is applied here, not in the markup: the browser receives
      // only what this viewer is entitled to see.
      questions: questions.map((question) =>
        redactForViewer(question, { uid: caller.uid, isStaff }),
      ),
      myVotes,
      ownReview,
      isPresenter: membership?.groupId === session.groupId,
    });
  } catch (error) {
    return respondWithError(error);
  }
}
