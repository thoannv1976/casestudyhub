import { NextResponse, type NextRequest } from 'next/server';
import { readSubmissionFile } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { assertCanAccessAssignment } from '@/lib/api/assignment-access';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Serves a submitted file to the group that handed it in, or to the staff
 * marking it. Nobody else, and no link that escapes the page.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { submissionId } = await context.params;

    const { submission, body } = await readSubmissionFile(submissionId);
    await assertCanAccessAssignment(caller, submission.assignmentId);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': submission.contentType,
        'Content-Length': String(submission.sizeBytes),
        'Content-Disposition': `attachment; filename="v${submission.versionNumber}-${submission.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}
