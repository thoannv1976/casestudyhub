import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, isLtiEnabled, linkLtiCourse, relinkLtiCourse } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  key: z.string().regex(/^[a-f0-9]{40}$/),
  classId: z.string().min(1).max(200),
});

/** A lecturer links the Moodle course they just opened to one of their classes. */
export async function POST(request: NextRequest) {
  try {
    if (!isLtiEnabled()) throw new AppError('NOT_FOUND', 'errors.ltiNotEnabled');
    const actor = await requireSessionUser();
    const { key, classId } = bodySchema.parse(await request.json());
    await linkLtiCourse(actor, key, classId);
    return NextResponse.json({ classId });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * A lecturer points an already linked Moodle course at another class of
 * theirs: a new cohort, or a link made to the wrong class.
 */
export async function PUT(request: NextRequest) {
  try {
    if (!isLtiEnabled()) throw new AppError('NOT_FOUND', 'errors.ltiNotEnabled');
    const actor = await requireSessionUser();
    const { key, classId } = bodySchema.parse(await request.json());
    const result = await relinkLtiCourse(actor, key, classId);
    return NextResponse.json({ classId, ...result });
  } catch (error) {
    return respondWithError(error);
  }
}
