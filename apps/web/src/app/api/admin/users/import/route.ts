import { NextResponse, type NextRequest } from 'next/server';
import { parseStudentRoster } from '@casestudyhub/shared';
import { AppError, getSystemSettings, importAccounts } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Creates accounts from a list, for students who cannot register themselves.
 *
 * With `?dryRun=1` nothing is created: the administrator sees which lines are
 * wrong and who already has an account, and fixes the file before committing
 * to it. The temporary passwords come back only on the real run, once.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('user.manage');

    const content = await request.text();
    const maxBytes = (await getSystemSettings()).maxImportKb * 1024;
    if (content.length > maxBytes) {
      throw new AppError('VALIDATION_FAILED', 'errors.importFileTooLarge');
    }

    const parsed = parseStudentRoster(content);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ problems: parsed.problems, created: [], skipped: [] });
    }

    const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
    const outcome = await importAccounts(
      actor,
      parsed.rows.map((row) => row.student),
      { dryRun },
    );

    return NextResponse.json({ ...outcome, problems: parsed.problems, dryRun });
  } catch (error) {
    return respondWithError(error);
  }
}
