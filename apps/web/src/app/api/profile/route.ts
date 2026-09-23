import { NextResponse, type NextRequest } from 'next/server';
import { profileUpdateSchema } from '@casestudyhub/shared';
import { getUserProfile, updateOwnProfile } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** A user reads their own profile. Reading someone else's goes through admin. */
export async function GET() {
  try {
    const caller = await requireSessionUser();
    const profile = await getUserProfile(caller.uid);
    return NextResponse.json({ profile });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * A user edits their own name and language only. The uid comes from the
 * session, never from the request body, so nobody can edit another profile by
 * changing a field.
 */
export async function PATCH(request: NextRequest) {
  try {
    const caller = await requireSessionUser();
    const update = profileUpdateSchema.parse(await request.json());
    await updateOwnProfile(caller.uid, update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}
