import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe for Cloud Run and the deployment workflow. */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'casestudyhub-web',
    phase: 1,
    timestamp: new Date().toISOString(),
  });
}
