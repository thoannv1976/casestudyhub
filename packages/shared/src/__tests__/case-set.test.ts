import { describe, expect, it } from 'vitest';
import {
  caseClaimId,
  caseOfferedToClass,
  classSchema,
  freeClaimSlot,
  studentMayReadCase,
} from '../index';

const amazon = { id: 'amazon', courseId: 'aug', status: 'published' as const };
const draft = { id: 'draft', courseId: 'aug', status: 'draft' as const };
const elsewhere = { id: 'netflix', courseId: 'other', status: 'published' as const };

describe('the places on a case', () => {
  it('keeps the id every claim had before places existed for the first place', () => {
    expect(caseClaimId('c1', 'amazon')).toBe('c1__amazon');
    expect(caseClaimId('c1', 'amazon', 1)).toBe('c1__amazon');
  });

  it('gives every further place an id of its own', () => {
    expect(caseClaimId('c1', 'amazon', 2)).toBe('c1__amazon__2');
    expect(caseClaimId('c1', 'amazon', 3)).not.toBe(caseClaimId('c1', 'amazon', 2));
  });

  it('hands out the lowest free place, and none once they are all taken', () => {
    expect(freeClaimSlot([], 1)).toBe(1);
    expect(freeClaimSlot([1], 1)).toBeNull();
    expect(freeClaimSlot([1], 2)).toBe(2);
    // A released first place is offered again before anything else.
    expect(freeClaimSlot([2], 2)).toBe(1);
    expect(freeClaimSlot([1, 2], 2)).toBeNull();
  });
});

describe('which cases a class works from', () => {
  it('is its course’s published cases while it has no set of its own', () => {
    const details = { courseId: 'aug' };
    expect(caseOfferedToClass(amazon, details)).toBe(true);
    expect(caseOfferedToClass(elsewhere, details)).toBe(false);
    expect(caseOfferedToClass(draft, details)).toBe(false);
  });

  it('is exactly its set once it has one, whatever course a case was filed under', () => {
    const details = { courseId: 'aug', caseSetIds: ['netflix'] };
    expect(caseOfferedToClass(elsewhere, details)).toBe(true);
    expect(caseOfferedToClass(amazon, details)).toBe(false);
  });

  it('never offers a draft, even one in the set', () => {
    expect(caseOfferedToClass(draft, { courseId: 'x', caseSetIds: ['draft'] })).toBe(false);
  });

  it('is nothing at all for a set saved empty, not the course again', () => {
    expect(caseOfferedToClass(amazon, { courseId: 'aug', caseSetIds: [] })).toBe(false);
  });
});

describe('which cases a student may read', () => {
  it('lets a group open the case it holds, even from another course', () => {
    // A group set a case filed under a course they are not taking used to be
    // refused its own material.
    const classes = [{ courseId: 'aug' }];
    expect(studentMayReadCase(elsewhere, classes, new Set())).toBe(false);
    expect(studentMayReadCase(elsewhere, classes, new Set(['netflix']))).toBe(true);
  });

  it('still refuses a draft, held or not', () => {
    expect(studentMayReadCase(draft, [{ courseId: 'aug' }], new Set(['draft']))).toBe(false);
  });

  it('follows the set of any class the student is in', () => {
    const classes = [{ courseId: 'none' }, { courseId: 'x', caseSetIds: ['amazon'] }];
    expect(studentMayReadCase(amazon, classes, new Set())).toBe(true);
    expect(studentMayReadCase(amazon, [], new Set())).toBe(false);
  });
});

describe('a class stored before sets existed', () => {
  it('reads as one place per case and no set of its own', () => {
    const parsed = classSchema.parse({
      id: 'c1',
      classCode: 'ECOM2',
      className: 'ECOM2',
      courseId: 'aug',
      semesterId: 's1',
      lecturerIds: ['l1'],
      language: 'vi',
      presentationPolicyId: 'p',
      presentationPolicyVersion: '1',
      joinMode: 'code',
      status: 'active',
    });
    expect(parsed.groupsPerCase).toBe(1);
    expect(parsed.caseSetIds).toBeUndefined();
  });
});
