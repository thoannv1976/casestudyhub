import { describe, expect, it } from 'vitest';
import { AppError, forbidden, notFound, unauthenticated } from '../errors';

describe('AppError', () => {
  it('maps a code to its HTTP status', () => {
    expect(new AppError('FORBIDDEN', 'errors.forbidden').status).toBe(403);
    expect(new AppError('CONFLICT', 'errors.groupFull').status).toBe(409);
    expect(new AppError('POLICY_VIOLATION', 'errors.groupTooSmall').status).toBe(422);
  });

  it('serialises to a client-safe payload carrying an i18n key', () => {
    const error = new AppError('POLICY_VIOLATION', 'errors.groupFull', {
      details: { groupId: 'G01', maxMembers: 6 },
    });
    expect(error.toJSON()).toEqual({
      code: 'POLICY_VIOLATION',
      messageKey: 'errors.groupFull',
      details: { groupId: 'G01', maxMembers: 6 },
    });
  });

  it('never leaks an internal message when none was given', () => {
    expect(forbidden().message).toBe('errors.forbidden');
    expect(unauthenticated().status).toBe(401);
    expect(notFound().status).toBe(404);
  });
});
