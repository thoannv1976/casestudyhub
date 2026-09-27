import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { toCsv } from '@casestudyhub/shared';
import { assertCanManageClass, classOverview, getClassById } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The class's whole workload in one table: both pieces of work, every group,
 * what has been handed in, what is still unmarked and what has been published.
 *
 * `?format=csv` returns the same rows as a spreadsheet, because the mark that
 * counts for the university is entered in the university's own system and
 * retyping thirty rows by hand is how a digit gets lost.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const actor = await requirePermission('grade.viewClass');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const overview = await classOverview(classId);
    if (request.nextUrl.searchParams.get('format') !== 'csv') {
      return NextResponse.json({ overview });
    }

    const details = await getClassById(classId);
    const rows: (readonly unknown[])[] = [
      [
        'Group',
        'Members',
        'Work',
        'Subject',
        'Deadline',
        'Handed in',
        'Required',
        'Late items',
        'Progress',
        'Marking',
        'Group score',
        'Bonus',
        'Average final',
        'Students graded',
      ],
      ...overview.rows.map((row) => [
        row.groupName,
        row.memberCount,
        row.kind,
        row.subject ?? 'group project',
        row.submissionDeadline,
        row.handedInCount,
        row.requiredCount,
        row.progress.lateItems,
        row.progress.state,
        row.marking,
        row.groupScoreRaw ?? '',
        row.bonusPoints ?? '',
        row.averageFinalScore ?? '',
        row.gradedStudents,
      ]),
      [],
      ['Totals'],
      ['Pieces of work', overview.totals.work],
      ['Nothing missing', overview.totals.complete],
      ['Something missing', overview.totals.missing],
      ['With something late', overview.totals.late],
      ['Not marked', overview.totals.unmarked],
      ['Draft', overview.totals.draft],
      ['Published', overview.totals.published],
    ];

    return new Response(`﻿${toCsv(rows)}`, {
      headers: {
        // The BOM is what makes Excel open UTF-8 Vietnamese correctly.
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${details?.classCode || classId}-overview.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
