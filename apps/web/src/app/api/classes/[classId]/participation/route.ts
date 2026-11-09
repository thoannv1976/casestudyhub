import { type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { toCsv } from '@casestudyhub/shared';
import { assertCanManageClass, classParticipation, getClassById } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Participation and attendance (chuyên cần) as a spreadsheet, one row per
 * student. Opened in Excel by a Vietnamese faculty, so it starts with a byte
 * order mark: without one, Excel reads UTF-8 as the local code page and every
 * Vietnamese name comes out garbled.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const locale = request.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'vi';
    const t = await getTranslations({ locale, namespace: 'participation' });
    const [data, details] = await Promise.all([classParticipation(classId), getClassById(classId)]);

    const rows: unknown[][] = [
      [t('csvTitle'), details?.className ?? classId],
      [t('csvGenerated'), new Date().toISOString()],
      [
        t('csvPolicy'),
        t('policySummary', {
          question: data.policy.questionWeight,
          review: data.policy.reviewWeight,
          bonus: data.policy.featuredBonus,
        }),
      ],
      [],
      [
        t('studentId'),
        t('fullName'),
        t('group'),
        t('eligible'),
        t('asked'),
        t('reviewed'),
        t('questions'),
        t('featuredQuestions'),
        t('upvotesReceived'),
        t('upvotesGiven'),
        t('answersInClass'),
        t('answersInApp'),
        t('featuredAnswers'),
        t('attendance'),
      ],
      ...data.rows.map((row) => [
        row.studentId,
        row.fullName,
        row.groupName ?? '',
        row.eligibleSessions,
        row.sessionsAsked,
        row.sessionsReviewed,
        row.questions,
        row.featuredQuestions,
        row.upvotesReceived,
        row.upvotesGiven,
        row.answersInClass,
        row.answersInApp,
        row.featuredAnswers,
        row.attendance ?? '',
      ]),
    ];

    return new Response(`﻿${toCsv(rows)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="participation-${details?.classCode ?? classId}.csv"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
