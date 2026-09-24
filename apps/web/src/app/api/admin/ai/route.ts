import { NextResponse } from 'next/server';
import { aiStatus, probeAi } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** How the model is configured, without any part of the credential. */
export async function GET() {
  try {
    await requirePermission('system.configure');
    return NextResponse.json({ status: aiStatus() });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * One real call to the model, reported verbatim.
 *
 * It costs a call against the month's budget, deliberately: a check that went
 * around the gateway would prove nothing about the calls that go through it.
 */
export async function POST() {
  try {
    await requirePermission('system.configure');
    return NextResponse.json({ probe: await probeAi() });
  } catch (error) {
    return respondWithError(error);
  }
}
