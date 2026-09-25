import { NextResponse, type NextRequest } from 'next/server';
import { MAX_UPLOAD_BYTES } from '@casestudyhub/shared';
import { AppError, listSubmissions, submitDeliverable, submitLink } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { assertCanAccessAssignment } from '@/lib/api/assignment-access';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { assignmentId } = await context.params;
    await assertCanAccessAssignment(caller, assignmentId);

    return NextResponse.json({ submissions: await listSubmissions(assignmentId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * A group member hands in a deliverable. Staff do not submit on a group's
 * behalf: the record of who handed in what has to stay truthful.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { assignmentId } = await context.params;
    const assignment = await assertCanAccessAssignment(caller, assignmentId);

    if (caller.role !== 'student') {
      throw new AppError('FORBIDDEN', 'errors.onlyGroupMembersSubmit');
    }

    const form = await request.formData();
    const file = form.get('file');
    const deliverableId = form.get('deliverableId');
    const url = form.get('url');

    if (typeof deliverableId !== 'string' || deliverableId.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    }

    // A deliverable satisfied by a link carries no bytes, so the upload rules
    // below have nothing to check and the link rules apply instead.
    if (typeof url === 'string' && url.trim().length > 0) {
      const submission = await submitLink(caller, assignment.groupId, {
        assignmentId,
        deliverableId,
        url,
      });
      return NextResponse.json({ submission }, { status: 201 });
    }

    if (!(file instanceof File)) throw new AppError('VALIDATION_FAILED', 'errors.fileMissing');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'errors.fileTooLarge', {
        details: { maxMb: Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024)) },
      });
    }

    const submission = await submitDeliverable(caller, assignment.groupId, {
      assignmentId,
      deliverableId,
      fileName: file.name,
      contentType: file.type,
      body: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
