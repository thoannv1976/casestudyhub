import { NextResponse, type NextRequest } from 'next/server';
import { registerRequestSchema } from '@casestudyhub/shared';
import { clientAddress, enforceRateLimit, registerStudent } from '@casestudyhub/core';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Student self-registration (SRS 1.1). Always creates a `student`; lecturer and
 * admin accounts are only ever granted by an admin, never self-selected.
 */
export async function POST(request: NextRequest) {
  try {
    // The endpoint is reachable without signing in, so it is the one an abuser
    // would hammer to create accounts or to probe which emails exist.
    await enforceRateLimit({
      key: `register:${clientAddress(request.headers)}`,
      max: 5,
      windowMs: 15 * 60 * 1000,
    });

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
