import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanReadCase,
  getCase,
  readAttachment,
  removeAttachment,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Serves a case document.
 *
 * Every download passes through here rather than a public or signed URL, so
 * the check below is not something a shared link can walk around: a student
 * only reads a case that has been published.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ caseId: string; attachmentId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { caseId, attachmentId } = await context.params;

    const study = await getCase(caseId);
    if (!study) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    await assertCanReadCase(caller, study);

    const { attachment, body } = await readAttachment(caseId, attachmentId);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Length': String(attachment.sizeBytes),
        // `attachment` rather than `inline`: a document opened in place could
        // run script in the platform's own origin.
        'Content-Disposition': `attachment; filename="${attachment.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ caseId: string; attachmentId: string }> },
) {
  try {
    const actor = await requirePermission('case.upload');
    const { caseId, attachmentId } = await context.params;
    await removeAttachment(actor, caseId, attachmentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}
