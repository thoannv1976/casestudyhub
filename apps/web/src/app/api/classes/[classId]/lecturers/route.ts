import { NextResponse, type NextRequest } from 'next/server';
import { addClassLecturerSchema } from '@casestudyhub/shared';
import { addClassLecturer, assertCanManageClass, listClassLecturers } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Who teaches this class, and putting another lecturer in charge of it. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    return NextResponse.json({ lecturers: await listClassLecturers(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { classId } = await context.params;

    const input = addClassLecturerSchema.parse(await request.json());
    const lecturer = await addClassLecturer(actor, classId, input.email);

    return NextResponse.json({ lecturer }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
