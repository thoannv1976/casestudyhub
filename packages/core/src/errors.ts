/** Error codes the API layer maps to HTTP statuses and translated messages. */
export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  POLICY_VIOLATION: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** i18n key so the client can show the message in the user's language. */
  readonly messageKey: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    messageKey: string,
    options?: { message?: string; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(options?.message ?? messageKey, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.messageKey = messageKey;
    if (options?.details) this.details = options.details;
  }

  toJSON(): { code: ErrorCode; messageKey: string; details?: Record<string, unknown> } {
    return this.details
      ? { code: this.code, messageKey: this.messageKey, details: this.details }
      : { code: this.code, messageKey: this.messageKey };
  }
}

export const forbidden = (messageKey = 'errors.forbidden') => new AppError('FORBIDDEN', messageKey);
export const unauthenticated = (messageKey = 'errors.unauthenticated') =>
  new AppError('UNAUTHENTICATED', messageKey);
export const notFound = (messageKey = 'errors.notFound') => new AppError('NOT_FOUND', messageKey);
