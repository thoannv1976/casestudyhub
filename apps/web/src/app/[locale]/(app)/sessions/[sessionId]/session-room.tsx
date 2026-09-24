'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ClassQuestion,
  PeerReview,
  PresentationPolicy,
  PresentationSession,
} from '@casestudyhub/shared';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { PeerReviewForm } from './peer-review';
import { QuestionWall } from './question-wall';
import { SessionTimer } from './session-timer';

/**
 * The live part of the room, driven by one poll.
 *
 * The clock, the question wall and the scoring form all depend on the same
 * thing: what the lecturer has opened. Before this, each was rendered once on
 * the server, so a lecturer opening scoring reached nobody until every student
 * in the room pressed reload. Now one request every ten seconds carries the
 * session's state alongside the questions, and the three panels read it.
 *
 * One poll for the whole room rather than one per panel: sixty students at
 * three requests each would be eighteen a second for the same information.
 */
export const ROOM_POLL_MS = 10_000;

export interface RoomState {
  session: PresentationSession;
  questions: ClassQuestion[];
  myVotes: string[];
  ownReview: PeerReview | null;
  isPresenter: boolean;
}

export function SessionRoom({
  sessionId,
  policy,
  initial,
  ownUid,
  isStaff,
  isStudent,
  title,
  subtitle,
}: {
  sessionId: string;
  /** The framework this session runs under, frozen when the case was set. */
  policy: PresentationPolicy;
  initial: RoomState;
  ownUid: string;
  isStaff: boolean;
  isStudent: boolean;
  /** The heading lives here because the badge beside it is live state. */
  title: string;
  subtitle: string;
}) {
  const t = useTranslations('session');
  const tQuestions = useTranslations('questions');
  const tPeer = useTranslations('peerReview');

  const [room, setRoom] = useState(initial);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/sessions/${sessionId}/room`);
    if (!response.ok) return;
    const body = (await response.json()) as Partial<RoomState>;
    if (!body.session) return;
    setRoom({
      session: body.session,
      questions: body.questions ?? [],
      myVotes: body.myVotes ?? [],
      ownReview: body.ownReview ?? null,
      isPresenter: body.isPresenter ?? false,
    });
  }, [sessionId]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), ROOM_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { session, isPresenter } = room;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted mt-2 text-sm">{subtitle}</p>
        </div>
        <Badge tone={session.status === 'completed' ? 'neutral' : 'brand'}>
          {t(`status.${session.status}`)}
        </Badge>
      </div>

      <Card>
        <CardTitle>{t('timerTitle')}</CardTitle>
        <div className="mt-4">
          <SessionTimer
            session={session}
            policy={policy}
            canControl={isStaff}
            onChanged={refresh}
          />
        </div>
      </Card>

      {isStudent && !isPresenter ? (
        <Card>
          <CardTitle>{tPeer('title')}</CardTitle>
          <div className="mt-4">
            <PeerReviewForm
              sessionId={sessionId}
              rubric={policy.rubric}
              own={room.ownReview}
              open={session.peerReviewOpen}
              onChanged={refresh}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{tQuestions('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tQuestions('purpose')}</p>
        <div className="mt-4">
          <QuestionWall
            sessionId={sessionId}
            questions={room.questions}
            votes={room.myVotes}
            ownUid={ownUid}
            isStaff={isStaff}
            isPresenter={isPresenter}
            canAsk={isStudent && !isPresenter}
            questionsOpen={session.questionsOpen}
            onChanged={refresh}
          />
        </div>
      </Card>
    </div>
  );
}
