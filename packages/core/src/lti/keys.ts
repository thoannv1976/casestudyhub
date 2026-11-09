import { createHash } from 'node:crypto';
import type { GradedWorkKind } from '@casestudyhub/shared';

/**
 * Pure helpers for the Moodle connection: ids, the student code an LMS account
 * gets here, and the one number each Moodle column receives.
 *
 * Kept free of Firebase so the rules they encode are unit-tested on their own.
 */

/**
 * What a Moodle activity is for, chosen by the lecturer in UniGame Hub's
 * "Select content" dialog.
 *
 * - `class`: opens the class. Sends no grade - a column that never fills is
 *   worse than no column.
 * - `case_study`: the student's published case-study mark(s) in this class.
 * - `group_project`: the student's published class-project mark.
 * - `attendance`: the attendance score read from the class's presentations
 *   (Tham gia & chuyên cần). It changes after every presentation, so it is
 *   sent only when the lecturer presses send - never on its own.
 */
export const LTI_ACTIVITY_KINDS = ['class', 'case_study', 'group_project', 'attendance'] as const;
export type LtiActivityKind = (typeof LTI_ACTIVITY_KINDS)[number];

/** Anything the Hub did not set, or set to something this app does not know, opens the class. */
export function ltiActivityKind(activity: string | undefined): LtiActivityKind {
  return (LTI_ACTIVITY_KINDS as readonly string[]).includes(activity ?? '')
    ? (activity as LtiActivityKind)
    : 'class';
}

function digest(parts: readonly string[], length = 40): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, length);
}

/** Stable, path-safe id for one Moodle course. */
export function ltiContextKey(parts: {
  tenantId: string;
  issuer: string;
  contextId: string;
}): string {
  return digest([parts.tenantId, parts.issuer, parts.contextId]);
}

/** Stable, path-safe id for one Moodle activity. */
export function ltiResourceKey(parts: {
  tenantId: string;
  issuer: string;
  resourceLinkId: string;
}): string {
  return digest([parts.tenantId, parts.issuer, parts.resourceLinkId]);
}

const STUDENT_ID_ALLOWED = /[^A-Za-z0-9._-]/g;

/**
 * The student code a new account created from Moodle starts with.
 *
 * The Moodle username is the student code at most schools, so it is used when
 * it fits the platform's format (3-32 of letters, digits, `.`, `_`, `-`).
 * Otherwise the part of the e-mail before `@`, and failing that a code derived
 * from the Hub id - never empty, never `.` or `..`.
 */
export function studentIdFromLms(input: {
  username?: string;
  email?: string;
  hubUserId: string;
}): string {
  const candidates = [input.username, input.email?.split('@')[0]];
  for (const raw of candidates) {
    const cleaned = (raw ?? '').trim().replace(STUDENT_ID_ALLOWED, '').slice(0, 32);
    if (cleaned.length >= 3 && cleaned !== '.' && cleaned !== '..' && !/^\.+$/.test(cleaned)) {
      return cleaned;
    }
  }
  return `moodle-${digest([input.hubUserId], 8)}`;
}

/** When the student code is already someone else's: same code plus a short, stable suffix. */
export function alternativeStudentId(base: string, hubUserId: string): string {
  return `${base.slice(0, 27)}-${digest([hubUserId], 4)}`;
}

/** An address for an account whose LMS shares no e-mail. `.invalid` can never receive mail. */
export function placeholderEmail(hubUserId: string): string {
  return `moodle-${digest([hubUserId], 12)}@lti.invalid`;
}

/**
 * The single mark a Moodle column receives, on the platform's 0-100 scale.
 *
 * Only published marks count. A class may mark more than one case study for a
 * group; their average goes to the case-study column, so a second case moves
 * the mark rather than replacing it. The class project has one mark per
 * student; should two ever exist, the higher one is sent rather than guessing
 * which is current.
 *
 * Returns null when there is nothing published yet - an empty column, not a 0.
 */
export function ltiScore(
  kind: LtiActivityKind,
  grades: readonly { kind: GradedWorkKind; finalScore: number }[],
): number | null {
  if (kind === 'class' || kind === 'attendance') return null;
  const scores = grades.filter((grade) => grade.kind === kind).map((grade) => grade.finalScore);
  if (scores.length === 0) return null;

  const value =
    kind === 'case_study'
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : Math.max(...scores);
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

/**
 * The attendance score (out of ten) as the 0-100 number a Moodle column takes.
 * Null - an empty cell, not a 0 - before any presentation the student could attend.
 */
export function ltiAttendanceScore(attendance: number | null | undefined): number | null {
  if (attendance === null || attendance === undefined || !Number.isFinite(attendance)) return null;
  return Math.round(Math.min(100, Math.max(0, attendance * 10)) * 100) / 100;
}
