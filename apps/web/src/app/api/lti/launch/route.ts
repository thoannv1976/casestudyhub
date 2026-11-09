import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, handleLtiLaunch, isLtiEnabled, verifyLtiTicket } from '@casestudyhub/core';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ ticket: z.string().min(20).max(8000) });

/**
 * Opening the platform from Moodle. The page at /lti-launch posts the ticket
 * UniGame Hub put in its URL fragment; the answer is a custom token the
 * browser exchanges for the usual session cookie, and where to go next.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isLtiEnabled()) throw new AppError('NOT_FOUND', 'errors.ltiNotEnabled');
    const { ticket } = bodySchema.parse(await request.json());
    const context = await verifyLtiTicket(ticket);
    const result = await handleLtiLaunch(context);
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error);
  }
}
