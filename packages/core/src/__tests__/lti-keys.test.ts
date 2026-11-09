import { describe, expect, it } from 'vitest';
import {
  alternativeStudentId,
  ltiActivityKind,
  ltiAttendanceScore,
  ltiContextKey,
  ltiScore,
  placeholderEmail,
  studentIdFromLms,
} from '../lti/keys';

describe('the activity a Moodle link is for', () => {
  it('reads the kinds the Hub offers and opens the class for anything else', () => {
    expect(ltiActivityKind('case_study')).toBe('case_study');
    expect(ltiActivityKind('group_project')).toBe('group_project');
    expect(ltiActivityKind('attendance')).toBe('attendance');
    expect(ltiActivityKind(undefined)).toBe('class');
    expect(ltiActivityKind('default')).toBe('class');
  });
});

describe('ids', () => {
  it('gives one course one stable, path-safe key', () => {
    const a = ltiContextKey({ tenantId: 't', issuer: 'https://m', contextId: '7' });
    expect(a).toMatch(/^[a-f0-9]{40}$/);
    expect(ltiContextKey({ tenantId: 't', issuer: 'https://m', contextId: '7' })).toBe(a);
    expect(ltiContextKey({ tenantId: 't', issuer: 'https://m', contextId: '8' })).not.toBe(a);
  });
});

describe('the student code of an account created from Moodle', () => {
  it('is the Moodle username when it fits the format', () => {
    expect(studentIdFromLms({ username: 'sv2026001', hubUserId: 'h' })).toBe('sv2026001');
  });

  it('drops characters the platform does not allow', () => {
    expect(studentIdFromLms({ username: 'an nguyễn/01', hubUserId: 'h' })).toBe('annguyn01');
  });

  it('falls back to the e-mail, then to the Hub id', () => {
    expect(studentIdFromLms({ username: 'a', email: 'an.nguyen@x.edu', hubUserId: 'h' })).toBe(
      'an.nguyen',
    );
    expect(studentIdFromLms({ username: '..', hubUserId: 'h' })).toMatch(/^moodle-[a-f0-9]{8}$/);
  });

  it('keeps within 32 characters, also with the suffix for a taken code', () => {
    const long = 'x'.repeat(40);
    expect(studentIdFromLms({ username: long, hubUserId: 'h' })).toHaveLength(32);
    expect(alternativeStudentId('x'.repeat(32), 'h').length).toBeLessThanOrEqual(32);
  });

  it('gets an address that can never receive mail when Moodle shares none', () => {
    expect(placeholderEmail('h')).toMatch(/^moodle-[a-f0-9]{12}@lti\.invalid$/);
  });
});

describe('the number a Moodle column receives', () => {
  const marks = [
    { kind: 'case_study' as const, finalScore: 80 },
    { kind: 'case_study' as const, finalScore: 65 },
    { kind: 'group_project' as const, finalScore: 92.5 },
  ];

  it('averages the published case studies', () => {
    expect(ltiScore('case_study', marks)).toBe(72.5);
  });

  it('takes the class project mark', () => {
    expect(ltiScore('group_project', marks)).toBe(92.5);
  });

  it('leaves the column empty, not zero, when nothing is published', () => {
    expect(ltiScore('group_project', [])).toBeNull();
    expect(ltiScore('class', marks)).toBeNull();
  });

  it('stays within 0-100', () => {
    expect(ltiScore('case_study', [{ kind: 'case_study', finalScore: 104 }])).toBe(100);
  });
});

describe('the attendance column', () => {
  it('takes the score out of ten as a number out of a hundred', () => {
    expect(ltiAttendanceScore(7.5)).toBe(75);
    expect(ltiAttendanceScore(0)).toBe(0);
    expect(ltiAttendanceScore(10)).toBe(100);
    expect(ltiAttendanceScore(6.67)).toBe(66.7);
  });

  it('stays empty before any presentation the student could attend', () => {
    expect(ltiAttendanceScore(null)).toBeNull();
    expect(ltiAttendanceScore(undefined)).toBeNull();
    expect(ltiAttendanceScore(Number.NaN)).toBeNull();
  });

  it('never fills from published marks', () => {
    expect(ltiScore('attendance', [{ kind: 'case_study', finalScore: 80 }])).toBeNull();
  });
});
