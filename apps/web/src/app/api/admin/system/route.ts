import { NextResponse, type NextRequest } from 'next/server';
import { saveSystemSettingsSchema } from '@casestudyhub/shared';
import { getSystemSettings, saveSystemSettings } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Platform settings. Operational, and applying to everybody at once. */
export async function GET() {
  try {
    await requirePermission('system.configure');
    return NextResponse.json({ settings: await getSystemSettings() });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requirePermission('system.configure');
    const body = saveSystemSettingsSchema.parse(await request.json());
    await saveSystemSettings(actor, body.settings, body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}
