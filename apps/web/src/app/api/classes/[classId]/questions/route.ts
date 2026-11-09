import { type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { toCsv } from '@casestudyhub/shared';
import {
  assertCanManageClass,
  getClassById,
  listCases,
  listClassQuestions,
  listGroups,
  listSessions,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Every question the class asked and every answer it got, as a spreadsheet:
 * the summary report of a term's Q&A. `?featured=1` keeps only what the
 * lecturer marked as a good question or a good answer.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const params = request.nextUrl.searchParams;
    const locale = params.get('locale') === 'en' ? 'en' : 'vi';
    const featuredOnly = params.get('featured') === '1';
    const t = await getTranslations({ locale, namespace: 'qaReview' });

    const [questions, sessions, groups, cases, details] = await Promise.all([
      listClassQuestions(classId),
      listSessions(classId),
      listGroups(classId),
      listCases(),
      getClassById(classId),
    ]);
    const groupName = new Map(groups.map((group) => [group.id, group.groupName]));
    const caseTitle = new Map(cases.map((study) => [study.id, `${study.caseCode} ${study.title}`]));
    const sessionOrder = new Map(
      [...sessions]
        .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
        .map((session, index) => [session.id, index]),
    );

    const shown = questions
      .filter((question) => !featuredOnly || question.featuredQuestion || question.featuredAnswer)
      .sort(
        (a, b) =>
          (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0) ||
          b.upvotes - a.upvotes,
      );

    const rows: unknown[][] = [
      [t('csvTitle'), details?.className ?? classId],
      [t('csvGenerated'), new Date().toISOString()],
      [],
      [
        t('csvGroup'),
        t('csvCase'),
        t('csvCategory'),
        t('csvUpvotes'),
        t('csvAskedBy'),
        t('csvStudentId'),
        t('csvQuestion'),
        t('csvFeaturedQuestion'),
        t('csvGroupAnswer'),
        t('csvChannel'),
        t('csvAnsweredBy'),
        t('csvSuggestion'),
        t('csvFinal'),
        t('csvFinalSource'),
        t('csvFeaturedAnswer'),
      ],
      ...shown.map((question) => [
        groupName.get(question.groupId) ?? question.groupId,
        question.caseStudyId ? (caseTitle.get(question.caseStudyId) ?? '') : '',
        question.category,
        question.upvotes,
        question.askedByName,
        question.askedByStudentId,
        question.text,
        question.featuredQuestion ? 'x' : '',
        question.answeredByAi ? '' : (question.answerText ?? ''),
        question.answerText && !question.answeredByAi ? (question.answerChannel ?? 'class') : '',
        question.answeredByAi ? '' : (question.answeredByName ?? ''),
        question.aiSuggestion?.text ?? (question.answeredByAi ? (question.answerText ?? '') : ''),
        question.finalAnswer ?? '',
        question.finalSource ?? '',
        question.featuredAnswer ? 'x' : '',
      ]),
    ];

    return new Response(`﻿${toCsv(rows)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="questions-${details?.classCode ?? classId}${featuredOnly ? '-featured' : ''}.csv"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
