import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission, studentIdSchema, classCodeSchema } from '../index';

describe('role permission matrix (SRS Module 02)', () => {
  it('lets only lecturers publish a grade', () => {
    expect(hasPermission('lecturer', 'grade.publish')).toBe(true);
    expect(hasPermission('admin', 'grade.publish')).toBe(false);
    expect(hasPermission('student', 'grade.publish')).toBe(false);
  });

  it('never lets a student manage users or configure the system', () => {
    expect(hasPermission('student', 'user.manage')).toBe(false);
    expect(hasPermission('student', 'system.configure')).toBe(false);
    expect(hasPermission('student', 'ai.configure')).toBe(false);
  });

  it('lets all three roles ask a question', () => {
    for (const role of ['admin', 'lecturer', 'student'] as const) {
      expect(hasPermission(role, 'question.ask')).toBe(true);
    }
  });

  it('reserves platform-wide grade access for admins', () => {
    expect(hasPermission('admin', 'grade.viewPlatform')).toBe(true);
    expect(hasPermission('lecturer', 'grade.viewPlatform')).toBe(false);
  });

  it('gives students the narrowest set of permissions', () => {
    expect(ROLE_PERMISSIONS.student.length).toBeLessThan(ROLE_PERMISSIONS.lecturer.length);
  });
});

describe('business identifiers', () => {
  it('accepts a realistic student id', () => {
    expect(studentIdSchema.parse(' SV001 ')).toBe('SV001');
  });

  it('rejects a student id with spaces or symbols', () => {
    expect(() => studentIdSchema.parse('SV 001')).toThrow();
    expect(() => studentIdSchema.parse('SV#001')).toThrow();
  });

  it('accepts the sample class code and rejects lower case', () => {
    expect(classCodeSchema.parse('ECOM-2026-A01')).toBe('ECOM-2026-A01');
    expect(() => classCodeSchema.parse('ecom-a01')).toThrow();
  });
});
