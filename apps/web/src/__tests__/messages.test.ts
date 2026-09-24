import { describe, expect, it } from 'vitest';
import {
  LOCALES,
  addClassLecturerSchema,
  answerQuestionSchema,
  askQuestionSchema,
  changePasswordSchema,
  createClassSchema,
  createCourseSchema,
  createStaffAccountSchema,
  NOTIFICATION_KINDS,
  notificationKeyOf,
  joinClassSchema,
  parseStudentRoster,
  profileUpdateSchema,
  registerRequestSchema,
  removeEnrollmentSchema,
  saveLecturerAssessmentSchema,
  sessionRequestSchema,
} from '@casestudyhub/shared';
import en from '../../messages/en.json';
import vi from '../../messages/vi.json';

/**
 * Acceptance test 10: both languages work throughout the interface.
 *
 * Two ways that breaks in practice, both caught here: a key added to one
 * catalogue and forgotten in the other, and a validation message that never
 * had a translation at all.
 */

type Messages = Record<string, unknown>;

function flatten(messages: Messages, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flatten(value as Messages, path)) keys.add(nested);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

const enKeys = flatten(en);
const viKeys = flatten(vi);

describe('message catalogues', () => {
  it('covers every supported locale', () => {
    expect(LOCALES).toEqual(['vi', 'en']);
  });

  it('has no key present in one language but missing in the other', () => {
    expect([...enKeys].filter((key) => !viKeys.has(key))).toEqual([]);
    expect([...viKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it('has no empty translation', () => {
    for (const [locale, messages] of [
      ['en', en],
      ['vi', vi],
    ] as const) {
      const empty: string[] = [];
      const walk = (node: Messages, prefix = '') => {
        for (const [key, value] of Object.entries(node)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === 'object') walk(value as Messages, path);
          else if (typeof value !== 'string' || value.trim() === '') empty.push(path);
        }
      };
      walk(messages);
      expect(empty, `${locale} has empty messages`).toEqual([]);
    }
  });
});

describe('every notification kind has a sentence', () => {
  /**
   * A kind without a message reaches a student as its own key. That happened
   * once, because a kind carries a dot and a message key reads a dot as a
   * namespace - so the bridge between the two is checked here rather than
   * trusted.
   */
  it.each(NOTIFICATION_KINDS)('reads as a sentence in both languages: %s', (kind) => {
    const key = `notifications.kind.${notificationKeyOf(kind)}`;
    expect(enKeys.has(key), `${key} missing from en.json`).toBe(true);
    expect(viKeys.has(key), `${key} missing from vi.json`).toBe(true);
  });
});

describe('validation messages are translated', () => {
  /** Collects every message the schema can produce from a fully invalid input. */
  function messagesOf(schema: { safeParse: (value: unknown) => unknown }, input: unknown) {
    const result = schema.safeParse(input) as {
      success: boolean;
      error?: { issues: { message: string }[] };
    };
    return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
  }

  const produced = [
    ...messagesOf(registerRequestSchema, {
      studentId: '.',
      fullName: 'A',
      email: 'nope',
      password: 'short',
      confirmPassword: 'other',
      preferredLanguage: 'fr',
    }),
    ...messagesOf(registerRequestSchema, { studentId: 'SV001' }),
    ...messagesOf(profileUpdateSchema, {}),
    ...messagesOf(profileUpdateSchema, { fullName: 'A' }),
    ...messagesOf(sessionRequestSchema, { idToken: '' }),
    ...messagesOf(changePasswordSchema, { newPassword: 'short', confirmPassword: 'other' }),
    ...messagesOf(joinClassSchema, { classCode: 'x' }),
    ...messagesOf(createClassSchema, {
      classCode: 'x',
      className: 'A',
      courseId: '',
      semesterId: '',
      language: 'fr',
      joinMode: 'whatever',
    }),
    ...messagesOf(createCourseSchema, { code: 'x', name: 'A', defaultLanguage: 'fr' }),
    ...messagesOf(createStaffAccountSchema, {
      email: 'nope',
      fullName: 'A',
      role: 'superuser',
      temporaryPassword: 'short',
      preferredLanguage: 'fr',
    }),
    ...messagesOf(removeEnrollmentSchema, { enrollmentId: 'e1', reason: 'x' }),
    // The question wall is the one form the whole class types into at once.
    ...messagesOf(askQuestionSchema, {}),
    ...messagesOf(askQuestionSchema, { category: 'nope', text: 'hi' }),
    ...messagesOf(askQuestionSchema, { category: 'critical', text: 'x'.repeat(1001) }),
    ...messagesOf(answerQuestionSchema, { questionId: 'q1', answerText: 'no' }),
    // Marking: what the lecturer sees when the form is incomplete.
    ...messagesOf(saveLecturerAssessmentSchema, {
      criterionScores: { understanding: 'not a number' },
      individual: { uid1: { rawScore: 'x' } },
      latePenaltyWaived: true,
    }),
    ...messagesOf(addClassLecturerSchema, { email: 'nope' }),
    // Import problems are shown to the lecturer the same way form errors are.
    ...parseStudentRoster('studentId,email\nSV001,a@x.edu.vn').problems.map((p) => p.messageKey),
    ...parseStudentRoster('').problems.map((p) => p.messageKey),
    ...parseStudentRoster('studentId,fullName,email\nx,A,bad').problems.map((p) => p.messageKey),
  ];

  it('produces something to check', () => {
    expect(produced.length).toBeGreaterThan(5);
  });

  it('has a translation in both languages for every message a form can show', () => {
    const missing = produced.filter((key) => !enKeys.has(key) || !viKeys.has(key));
    expect(missing).toEqual([]);
  });
});
