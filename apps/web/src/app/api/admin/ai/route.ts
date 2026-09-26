import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  aiCredentialStatus,
  aiStatus,
  probeAi,
  saveAiCredential,
} from '@casestudyhub/core';
import { aiProviderSchema } from '@casestudyhub/shared';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** How the model is configured, without any part of the credential. */
export async function GET() {
  try {
    await requirePermission('system.configure');
    return NextResponse.json({
      status: await aiStatus(),
      credentials: await aiCredentialStatus(),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Stores or clears one vendor's API key.
 *
 * Nothing reads it back out over HTTP, here or anywhere else: the page is told
 * that a key exists and its last four characters, which is enough for whoever
 * stored it to know which key it is.
 */
export async function PUT(request: NextRequest) {
  try {
    const actor = await requirePermission('system.configure');
    const body = (await request.json()) as { provider?: string; apiKey?: string | null };

    const provider = aiProviderSchema.safeParse(body.provider);
    if (!provider.success) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    // An empty box means "leave what is stored alone", so clearing a key is a
    // separate, deliberate request rather than a slip of the keyboard.
    if (!apiKey && body.apiKey !== null) {
      throw new AppError('VALIDATION_FAILED', 'errors.apiKeyRequired');
    }

    await saveAiCredential(actor, provider.data, apiKey || null);
    return NextResponse.json({ credentials: await aiCredentialStatus() });
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
