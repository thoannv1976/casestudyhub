import { describe, expect, it } from 'vitest';
import {
  passwordSchema,
  profileUpdateSchema,
  registerRequestSchema,
  studentIdSchema,
} from '../index';

const valid = {
  studentId: 'SV001',
  fullName: 'Nguyen Van A',
  email: 'sv001@university.edu.vn',
  password: 'matkhau2026',
  confirmPassword: 'matkhau2026',
  preferredLanguage: 'vi' as const,
};

describe('registerRequestSchema', () => {
  it('accepts a complete registration', () => {
    expect(registerRequestSchema.parse(valid).studentId).toBe('SV001');
  });

  it('rejects mismatched passwords, pointing at the confirmation field', () => {
    const result = registerRequestSchema.safeParse({ ...valid, confirmPassword: 'khac2026' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'confirmPassword');
      expect(issue?.message).toBe('errors.passwordMismatch');
    }
  });

  it('rejects a password with no digit or under eight characters', () => {
    expect(passwordSchema.safeParse('matkhaudai').success).toBe(false);
    expect(passwordSchema.safeParse('abc123').success).toBe(false);
    expect(passwordSchema.safeParse('abc12345').success).toBe(true);
  });

  it('reports password problems with an i18n key, not English prose', () => {
    const result = passwordSchema.safeParse('short1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/^errors\./);
    }
  });

  it('rejects an invalid email or a name that is too short', () => {
    expect(registerRequestSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(
      false,
    );
    expect(registerRequestSchema.safeParse({ ...valid, fullName: 'A' }).success).toBe(false);
  });

  it('rejects a language outside the supported set', () => {
    expect(registerRequestSchema.safeParse({ ...valid, preferredLanguage: 'fr' }).success).toBe(
      false,
    );
  });

  it('never lets the client choose its own role', () => {
    const parsed = registerRequestSchema.parse({ ...valid, globalRole: 'admin' });
    expect(parsed).not.toHaveProperty('globalRole');
  });
});

describe('studentIdSchema', () => {
  it('rejects the ids Firestore reserves as document names', () => {
    expect(studentIdSchema.safeParse('.').success).toBe(false);
    expect(studentIdSchema.safeParse('..').success).toBe(false);
  });

  it('rejects a path separator smuggled into the id', () => {
    expect(studentIdSchema.safeParse('SV/001').success).toBe(false);
    expect(studentIdSchema.safeParse('../admin').success).toBe(false);
  });
});

describe('profileUpdateSchema', () => {
  it('accepts either field on its own', () => {
    expect(profileUpdateSchema.safeParse({ fullName: 'Tran Thi B' }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ preferredLanguage: 'en' }).success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('ignores fields a user may not change about themselves', () => {
    const parsed = profileUpdateSchema.parse({
      fullName: 'Tran Thi B',
      globalRole: 'admin',
      status: 'active',
      studentId: 'SV999',
    });
    expect(parsed).toEqual({ fullName: 'Tran Thi B' });
  });
});

describe('every validation message is translatable', () => {
  it('reports i18n keys, never English prose, for a fully invalid form', () => {
    const result = registerRequestSchema.safeParse({
      studentId: 'x',
      fullName: 'A',
      email: 'not-an-email',
      password: 'short',
      confirmPassword: 'different',
      preferredLanguage: 'fr',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      for (const issue of result.error.issues) {
        expect(issue.message, `${issue.path.join('.')} must carry an i18n key`).toMatch(
          /^errors\./,
        );
      }
    }
  });

  it('reports an i18n key for an invalid profile update too', () => {
    const result = profileUpdateSchema.safeParse({ fullName: 'A' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/^errors\./);
    }
  });
});
