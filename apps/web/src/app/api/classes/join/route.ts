import { NextResponse, type NextRequest } from 'next/server';
import { joinClassSchema } from '@casestudyhub/shared';
import {
  clientAddress,
  enforceRateLimit,
  getUserProfile,
  joinClassByCode,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * A student joins a class by typing its code.
 *
 * Rate limited per account: a class code is short enough that an unlimited
 * endpoint would let somebody guess their way into a class they are not in.
 */
export async function POST(request: NextRequest) {
  try {
    const student = await requirePermission('group.join');

    await enforceRateLimit({
      key: `join:${student.uid}:${clientAddress(request.headers)}`,
      max: 10,
      windowMs: 10 * 60 * 1000,
    });

    const { classCode } = joinClassSchema.parse(await request.json());
    const profile = await getUserProfile(student.uid);
    if (!profile) {
      return respondWithError(new Error('Profile missing for an authenticated user'));
    }

    const result = await joinClassByCode(
      student,
      { studentId: profile.studentId, fullName: profile.fullName, email: profile.email },
      classCode,
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
