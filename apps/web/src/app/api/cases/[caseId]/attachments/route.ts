import { NextResponse, type NextRequest } from 'next/server';
import { MAX_UPLOAD_BYTES, attachmentUploadSchema } from '@casestudyhub/shared';
import { AppError, addAttachment } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Uploads a document to a case study.
 *
 * The body is a multipart form, and the file is buffered here before it
 * reaches storage, which is why the platform keeps a ceiling well under what
 * a policy may allow for a deliverable.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  try {
    const actor = await requirePermission('case.upload');
    const { caseId } = await context.params;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', 'errors.fileMissing');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'errors.fileTooLarge', {
        details: { maxMb: Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024)) },
      });
    }

    const { kind } = attachmentUploadSchema.parse({ kind: form.get('kind') ?? 'case' });
    const body = Buffer.from(await file.arrayBuffer());

    const attachment = await addAttachment(actor, caseId, {
      fileName: file.name,
      contentType: file.type,
      kind,
      body,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
