import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '@casestudyhub/core';

/**
 * Turns anything thrown inside a route handler into a response the client can
 * translate. Unexpected errors are logged in full but reach the client as a
 * generic message: an internal message could disclose how the system works.
 */
export function respondWithError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.toJSON() }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          messageKey: 'errors.validationFailed',
          details: {
            fields: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              messageKey: issue.message,
            })),
          },
        },
      },
      { status: 422 },
    );
  }

  console.error('Unhandled error in route handler:', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL', messageKey: 'errors.unexpected' } },
    { status: 500 },
  );
}
