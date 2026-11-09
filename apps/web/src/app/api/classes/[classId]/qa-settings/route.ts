import { NextResponse, type NextRequest } from 'next/server';
import { qaSettingsRequestSchema } from '@casestudyhub/shared';
import { assertCanManageClass, qaPolicyOfClass, saveQaSettings } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** How long Q&A stays open after class, and how attendance is scored. */
export async function PUT(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const input = qaSettingsRequestSchema.parse(await request.json());
    await saveQaSettings(caller, classId, input);
    return NextResponse.json(await qaPolicyOfClass(classId));
  } catch (error) {
    return respondWithError(error);
  }
}
