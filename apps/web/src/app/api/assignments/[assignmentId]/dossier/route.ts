import { type NextRequest } from 'next/server';
import { toCsv } from '@casestudyhub/shared';
import { assertCanManageClass, presentationDossier } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The presentation dossier as a spreadsheet, for a lecturer marking away from
 * the screen or keeping a record with the rest of the module's paperwork.
 *
 * `toCsv` defuses any cell beginning with `=`, `+`, `-` or `@`: every question
 * and every peer comment in this file was typed by a student, and a
 * spreadsheet runs such a cell as a formula when it opens.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { assignmentId } = await context.params;

    const dossier = await presentationDossier(assignmentId);
    await assertCanManageClass(caller, dossier.classId);

    const rows: unknown[][] = [
      ['CaseStudy Hub — presentation dossier'],
      ['Case', dossier.caseTitle],
      ['Group', dossier.groupName],
      ['Generated', new Date().toISOString()],
      [],
      ['Questions the class asked'],
      [
        'Upvotes',
        'Category',
        'Asked of role',
        'Answered aloud',
        'Asked by',
        'Student ID',
        'Anonymous to class',
        'Question',
        'Answer',
      ],
      ...dossier.questions.map((question) => [
        question.upvotes,
        question.category,
        question.askedOfRoleId ?? '',
        question.status === 'answered' ? 'yes' : 'no',
        question.askedByName,
        question.askedByStudentId,
        question.anonymousToClass ? 'yes' : 'no',
        question.text,
        question.answerText ?? '',
      ]),
      [],
      ['Presenters who answered nothing', dossier.presentersWhoAnsweredNothing.join('; ')],
      [],
      ['Peer scores'],
      ['Scored by', 'Student ID', 'Their group', 'Total', 'Out of', 'Comment'],
      ...dossier.reviews.map((review) => [
        review.reviewerName,
        review.reviewerStudentId,
        review.reviewerGroupName ?? '',
        review.total,
        dossier.policy.rubric.totalPoints,
        review.comment ?? '',
      ]),
      [],
      ['Per criterion', 'Mean', 'Out of', 'Lowest', 'Highest'],
      ...dossier.policy.rubric.criteria.map((criterion) => [
        criterion.key,
        dossier.summary.byCriterion[criterion.id]?.mean ?? 0,
        criterion.maxPoints,
        dossier.summary.byCriterion[criterion.id]?.lowest ?? 0,
        dossier.summary.byCriterion[criterion.id]?.highest ?? 0,
      ]),
      [],
      ['Scores counted', dossier.summary.count],
      ['Eligible scorers', dossier.eligibleScorers],
      ['Mean', dossier.summary.mean],
      ['Median', dossier.summary.median],
    ];

    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dossier-${dossier.groupName}.csv"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
