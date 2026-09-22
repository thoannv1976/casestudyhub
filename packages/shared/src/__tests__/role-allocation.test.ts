import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  RoleAllocationError,
  autoAssignRoles,
  isAllocationComplete,
  membersWithoutRole,
  rolesOfMember,
} from '../index';

const policy = DEFAULT_PRESENTATION_POLICY;
const members = (n: number) => Array.from({ length: n }, (_, i) => `sv${i + 1}`);

describe('autoAssignRoles (Guide Table 3)', () => {
  it('gives a team of six one role each', () => {
    const assignments = autoAssignRoles(members(6), policy);
    expect(assignments).toEqual([
      { roleId: 'R1', memberId: 'sv1' },
      { roleId: 'R2', memberId: 'sv2' },
      { roleId: 'R3', memberId: 'sv3' },
      { roleId: 'R4', memberId: 'sv4' },
      { roleId: 'R5', memberId: 'sv5' },
      { roleId: 'R6', memberId: 'sv6' },
    ]);
  });

  it('merges R5 into member 1 for a team of five', () => {
    const assignments = autoAssignRoles(members(5), policy);
    expect(rolesOfMember(assignments, 'sv1')).toEqual(['R1', 'R5']);
    expect(rolesOfMember(assignments, 'sv5')).toEqual(['R6']);
  });

  it('merges R5 into member 1 and R6 into member 4 for a team of four', () => {
    const assignments = autoAssignRoles(members(4), policy);
    expect(rolesOfMember(assignments, 'sv1')).toEqual(['R1', 'R5']);
    expect(rolesOfMember(assignments, 'sv4')).toEqual(['R4', 'R6']);
  });

  it('never drops R3 or R4, whatever the team size', () => {
    for (const size of [4, 5, 6]) {
      const assignments = autoAssignRoles(members(size), policy);
      const owners = new Map(assignments.map((a) => [a.roleId, a.memberId]));
      expect(owners.get('R3')).toBeDefined();
      expect(owners.get('R4')).toBeDefined();
      expect(isAllocationComplete(assignments)).toBe(true);
    }
  });

  it('leaves no member without a role', () => {
    for (const size of [4, 5, 6]) {
      const ids = members(size);
      expect(membersWithoutRole(autoAssignRoles(ids, policy), ids)).toEqual([]);
    }
  });

  it('keeps the chain of reasoning in order', () => {
    expect(autoAssignRoles(members(6), policy).map((a) => a.roleId)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
    ]);
  });

  it('refuses a group below the policy minimum', () => {
    expect(() => autoAssignRoles(members(3), policy)).toThrow(RoleAllocationError);
    try {
      autoAssignRoles(members(3), policy);
    } catch (error) {
      expect((error as RoleAllocationError).code).toBe('GROUP_TOO_SMALL');
    }
  });

  it('refuses a group above the policy maximum', () => {
    try {
      autoAssignRoles(members(7), policy);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as RoleAllocationError).code).toBe('GROUP_TOO_LARGE');
    }
  });

  it('follows a policy that allows other group sizes only when a table exists', () => {
    const widerPolicy = { ...policy, groupSize: { min: 2, max: 8 } };
    expect(() => autoAssignRoles(members(3), widerPolicy)).toThrow(/No role allocation table/);
  });
});

describe('slide skeleton', () => {
  it('maps 16 slides onto the six roles', () => {
    expect(policy.slideSkeleton).toHaveLength(16);
    expect(policy.slideSkeleton[0]?.roleId).toBeNull();
    const roleSlides = policy.slideSkeleton.filter((s) => s.roleId !== null);
    expect(roleSlides).toHaveLength(15);
    expect(new Set(roleSlides.map((s) => s.roleId)).size).toBe(6);
  });

  it('stays within the slide count the policy allows', () => {
    const contentSlides = policy.slideSkeleton.filter((s) => s.roleId !== null).length;
    expect(contentSlides).toBeGreaterThanOrEqual(policy.slides.min);
    expect(contentSlides).toBeLessThanOrEqual(policy.slides.max);
  });
});

describe('required deliverables', () => {
  it('requires the deliverables of the guide checklist', () => {
    const required = policy.deliverables.filter((d) => d.required).map((d) => d.id);
    expect(required).toEqual(
      expect.arrayContaining([
        'slides-pdf',
        'slides-source',
        'role-allocation-sheet',
        'reference-list',
        'ai-usage-disclosure',
      ]),
    );
  });

  it('leaves the analysis report optional for the lecturer to decide', () => {
    expect(policy.deliverables.find((d) => d.id === 'case-analysis-report')?.required).toBe(false);
  });
});
