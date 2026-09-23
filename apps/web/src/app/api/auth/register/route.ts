import { NextResponse, type NextRequest } from 'next/server';
import { registerRequestSchema } from '@casestudyhub/shared';
import { registerStudent } from '@casestudyhub/core';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Student self-registration (SRS 1.1). Always creates a `student`; lecturer and
 * admin accounts are only ever granted by an admin, never self-selected.
 */
export async function POST(request: NextRequest) {
  try {
    const input = registerRequestSchema.parse(await request.json());

    const { uid } = await registerStudent({
      studentId: input.studentId,
      fullName: input.fullName,
      email: input.email,
      password: input.password,
      preferredLanguage: input.preferredLanguage,
    });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
