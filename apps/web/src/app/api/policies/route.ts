import { NextResponse, type NextRequest } from 'next/server';
import { savePolicySchema } from '@casestudyhub/shared';
import { listPolicies, savePolicyVersion } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The assessment framework, read and versioned.
 *
 * Reading is open to anyone who may author one, because choosing what to
 * change means seeing what is there. Writing never edits: a POST creates a
 * version, and a version that exists is a conflict.
 */
export async function GET() {
  try {
    await requirePermission('policy.author');
    return NextResponse.json({ policies: await listPolicies() });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('policy.author');
    const body = savePolicySchema.parse(await request.json());

    const saved = await savePolicyVersion(actor, { policy: body.policy, reason: body.reason });
    return NextResponse.json({ policy: saved }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
