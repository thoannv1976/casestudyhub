import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness probe for Cloud Run and the deployment workflow.
 *
 * This endpoint is public, so it says only what an operator needs to know that
 * the service is up and which build is answering. It used to report
 * `phase: 1`, a constant written when there was one phase, which went on
 * saying so through four of them - the same untruth the dashboard told, in the
 * one place somebody checks to find out what is running.
 *
 * Whether the model is configured is deliberately not here. That is a
 * question for somebody who may already read the deployment's settings, and
 * it is answered on the system page.
 */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'casestudyhub-web',
    // Set by Cloud Run itself; absent when running locally or in a test.
    revision: process.env.K_REVISION ?? 'local',
    timestamp: new Date().toISOString(),
  });
}
