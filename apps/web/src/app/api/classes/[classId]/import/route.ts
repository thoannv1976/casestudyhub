import { NextResponse, type NextRequest } from 'next/server';
import { parseStudentRoster } from '@casestudyhub/shared';
import { assertCanManageClass, importRoster } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { AppError } from '@casestudyhub/core';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** A faculty list is a few kilobytes; anything larger is not a class list. */
const MAX_IMPORT_BYTES = 512 * 1024;

/**
 * Imports a student list into a class.
 *
 * With `?dryRun=1` nothing is written: the lecturer sees what would be created
 * and which lines are wrong, and fixes the file before committing to it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const content = await request.text();
    if (content.length > MAX_IMPORT_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'errors.importFileTooLarge');
    }

    const parsed = parseStudentRoster(content);
    const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';

    if (dryRun || parsed.rows.length === 0) {
      return NextResponse.json({
        dryRun: true,
        wouldImport: parsed.rows.length,
        preview: parsed.rows.slice(0, 20).map((row) => row.student),
        problems: parsed.problems,
      });
    }

    const outcome = await importRoster(
      actor,
      classId,
      parsed.rows.map((row) => row.student),
    );

    return NextResponse.json({ dryRun: false, ...outcome, problems: parsed.problems });
  } catch (error) {
    return respondWithError(error);
  }
}
