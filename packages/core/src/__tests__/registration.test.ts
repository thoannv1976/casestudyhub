import { describe, expect, it } from 'vitest';
import { studentIdKey } from '../users/registration';

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
