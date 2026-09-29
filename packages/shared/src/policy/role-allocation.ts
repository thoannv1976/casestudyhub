import {
  MAX_ALLOCATABLE_TEAM_SIZE,
  ROLE_ALLOCATION_BY_TEAM_SIZE,
  ROLE_PARTNER_ORDER,
  type PresentationRoleId,
  PRESENTATION_ROLE_IDS,
} from '../domain/roles';
import type { PresentationPolicy } from './presentation-policy';

export class RoleAllocationError extends Error {
  constructor(
    message: string,
    readonly code: 'GROUP_TOO_SMALL' | 'GROUP_TOO_LARGE' | 'NO_ALLOCATION_TABLE',
  ) {
    super(message);
    this.name = 'RoleAllocationError';
  }
}

export interface RoleAssignment {
  roleId: PresentationRoleId;
  /** Member id owning the role. A member may own two roles in a small team. */
  memberId: string;
}

/**
 * Auto Assign Roles (SRS 6.3 / Guide Table 3).
 *
 * Members are assigned in the given order, so the caller controls ordering
 * (for example by seniority, or by whatever the group leader arranged).
 * R3 and R4 are never merged away - they are the roles measuring analytical
 * and critical capability.
 */
export function autoAssignRoles(
  memberIds: readonly string[],
  policy: Pick<PresentationPolicy, 'groupSize'>,
): RoleAssignment[] {
  const size = memberIds.length;

  if (size < policy.groupSize.min) {
    throw new RoleAllocationError(
      `A group needs at least ${policy.groupSize.min} members, got ${size}`,
      'GROUP_TOO_SMALL',
    );
  }

  // Deliberately not `policy.groupSize.max`. A lecturer who raises one group's
  // limit to eight has made that decision explicitly, and refusing to seat the
  // eighth member because the course framework says six would leave them at a
  // dead end with no way forward but assigning every role by hand. What can
  // actually be seated is what the allocation knows how to seat.
  if (size > MAX_ALLOCATABLE_TEAM_SIZE) {
    throw new RoleAllocationError(
      `No role allocation for a team of ${size}; at most ${MAX_ALLOCATABLE_TEAM_SIZE} can be seated`,
      'GROUP_TOO_LARGE',
    );
  }

  // Above six, the first six are seated by the table and the rest partner an
  // existing role.
  const seated = Math.min(size, 6);
  const table = ROLE_ALLOCATION_BY_TEAM_SIZE[seated as 4 | 5 | 6];
  if (!table) {
    throw new RoleAllocationError(
      `No role allocation table defined for a team of ${seated}`,
      'NO_ALLOCATION_TABLE',
    );
  }

  const assignments: RoleAssignment[] = PRESENTATION_ROLE_IDS.map((roleId) => {
    const memberIndex = table[roleId];
    const memberId = memberIds[memberIndex - 1];
    if (!memberId) {
      throw new RoleAllocationError(
        `Allocation table for a team of ${seated} points at member ${memberIndex}`,
        'NO_ALLOCATION_TABLE',
      );
    }
    return { roleId, memberId };
  });

  for (let extra = 6; extra < size; extra += 1) {
    const roleId = ROLE_PARTNER_ORDER[extra - 6];
    const memberId = memberIds[extra];
    if (roleId && memberId) assignments.push({ roleId, memberId });
  }

  return assignments;
}

/** Roles owned by one member, in presentation order. */
export function rolesOfMember(
  assignments: readonly RoleAssignment[],
  memberId: string,
): PresentationRoleId[] {
  return assignments.filter((a) => a.memberId === memberId).map((a) => a.roleId);
}

/** True when every role of the framework has an owner. */
export function isAllocationComplete(assignments: readonly RoleAssignment[]): boolean {
  const covered = new Set(assignments.map((a) => a.roleId));
  return PRESENTATION_ROLE_IDS.every((roleId) => covered.has(roleId));
}

/** Members carrying no role at all - they would have nothing to be assessed on. */
export function membersWithoutRole(
  assignments: readonly RoleAssignment[],
  memberIds: readonly string[],
): string[] {
  const withRole = new Set(assignments.map((a) => a.memberId));
  return memberIds.filter((id) => !withRole.has(id));
}
