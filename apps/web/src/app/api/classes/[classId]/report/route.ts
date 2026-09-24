import { type NextRequest } from 'next/server';
import { toCsv } from '@casestudyhub/shared';
import { assertCanManageClass, classReport, policyOfClass } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The class report as a spreadsheet, for a faculty office that works in one.
 *
 * Served as an attachment and never rendered: a downloaded report carries
 * student names and free-text notes, and `toCsv` defuses any cell a
 * spreadsheet would otherwise run as a formula.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('grade.viewClass');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const report = await classReport(classId);
    const rubric = (await policyOfClass(classId)).rubric;

    const rows: unknown[][] = [
      ['CaseStudy Hub — class report'],
      ['Class', report.className, report.classCode],
      ['Generated', new Date().toISOString()],
      ['Grades counted', 'published only'],
      [
        'CLO mapping',
        report.cloMappingConfirmed
          ? 'confirmed against the syllabus by the faculty'
          : 'illustrative; confirm against the syllabus before reporting',
      ],
      [],
      ['Grade distribution'],
      ['Band', 'Students', 'Share'],
      ...report.distribution.rows.map((row) => [row.key, row.count, row.share]),
      ['Mean', report.distribution.mean],
      ['Median', report.distribution.median],
      ['Lowest', report.distribution.lowest],
      ['Highest', report.distribution.highest],
      [],
      ['Rubric criteria'],
      ['Criterion', 'Mean', 'Out of', 'Share', 'Marked'],
      ...report.criteria.map((row) => [
        rubric.criteria.find((criterion) => criterion.id === row.criterionId)?.key ??
          row.criterionId,
        row.mean,
        row.maxPoints,
        row.meanShare,
        row.count,
      ]),
      [],
      ['CLO attainment', `threshold ${report.cloThreshold}`],
      ['CLO', 'Name', 'Criteria', 'Attainment', 'At or above threshold', 'Marked'],
      ...report.clos.map((clo) => [
        clo.cloId,
        report.cloNames[clo.cloId] ?? '',
        clo.criterionIds.join(' '),
        clo.attainment,
        clo.atOrAboveThreshold,
        clo.count,
      ]),
      [],
      ['Participation'],
      ['Enrolled', report.participation.enrolled],
      ['Asked a question', report.participation.asked],
      ['Answered aloud', report.participation.answered],
      ['Scored a group', report.participation.scored],
      ['Took no part at all', report.participation.silentUids.length],
    ];

    const fileName = `${report.classCode || classId}-report.csv`;

    return new Response(`﻿${toCsv(rows)}`, {
      headers: {
        // The BOM is what makes Excel open UTF-8 Vietnamese correctly.
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
