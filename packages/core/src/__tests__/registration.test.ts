import { describe, expect, it } from 'vitest';
import { studentIdKey } from '../users/registration';
import { enrollmentId } from '../academic/enrollment';

describe('studentIdKey', () => {
  it('treats ids differing only in case as the same code', () => {
    expect(studentIdKey('sv001')).toBe('SV001');
    expect(studentIdKey('SV001')).toBe('SV001');
    expect(studentIdKey(' Sv001 ')).toBe('SV001');
  });

  it('keeps the characters the schema allows', () => {
    expect(studentIdKey('sv-001_a.b')).toBe('SV-001_A.B');
  });
});

describe('enrollmentId', () => {
  it('gives one deterministic row per student per class', () => {
    expect(enrollmentId('ECOM-A01', 'SV001')).toBe('ECOM-A01__SV001');
    // An imported row and the student's own join must land on the same
    // document, whatever case the two sources used.
    expect(enrollmentId('ECOM-A01', 'sv001')).toBe(enrollmentId('ECOM-A01', 'SV001'));
    expect(enrollmentId('ECOM-A01', ' SV001 ')).toBe(enrollmentId('ECOM-A01', 'SV001'));
  });

  it('keeps students of different classes apart', () => {
    expect(enrollmentId('ECOM-A01', 'SV001')).not.toBe(enrollmentId('ECOM-A02', 'SV001'));
  });
});
