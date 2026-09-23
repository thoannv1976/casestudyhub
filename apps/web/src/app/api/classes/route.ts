import { NextResponse, type NextRequest } from 'next/server';
import { createClassSchema } from '@casestudyhub/shared';
import { createClass } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Lecturers and admins create classes (SRS Module 02). */
export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('class.create');
    const input = createClassSchema.parse(await request.json());
    const classId = await createClass(actor, input);
    return NextResponse.json({ classId }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
