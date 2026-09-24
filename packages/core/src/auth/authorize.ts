import type { Permission, UserRole } from '@casestudyhub/shared';
import { hasPermission } from '@casestudyhub/shared';
import { AppError } from '../errors';
import { requireSessionUser } from './session';
import type { SessionUser } from './types';

/**
 * Authorization checks that run on the server (SRS Module 02).
 *
 * Firestore Security Rules repeat these conditions at the database layer.
 * Neither layer trusts the interface: a hidden button is not a permission.
 */

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!hasPermission(user.role, permission)) {
    throw new AppError('FORBIDDEN', 'errors.forbidden', {
      details: { permission, role: user.role },
    });
  }
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!roles.includes(user.role)) {
    throw new AppError('FORBIDDEN', 'errors.forbidden', {
      details: { required: roles, role: user.role },
    });
  }
  return user;
}

/** A user may always read their own record; staff may read anyone's. */
export function canReadUser(caller: SessionUser, targetUid: string): boolean {
  return caller.uid === targetUid || caller.role === 'admin' || caller.role === 'lecturer';
}
