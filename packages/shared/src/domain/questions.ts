import { z } from 'zod';
import { presentationRoleIdSchema } from './roles';

/**
 * Class questions (SRS Module 10.3).
 *
 * A question belongs to the *case study*, not only to the session it was asked
 * in. One presentation gathers fifty to seventy of them, the group answers two
 * or three aloud, and the rest are the point: they accumulate into what the
 * class collectively wanted to know about that case, ready to be answered and
 * handed to the cohorts that follow.
 */

export const QUESTION_CATEGORIES = [
  'clarification',
  'evidence',
  'critical',
  'application',
  'decision',
] as const;
export const questionCategorySchema = z.enum(QUESTION_CATEGORIES, {
  error: 'errors.questionCategoryInvalid',
});
export type QuestionCategory = z.infer<typeof questionCategorySchema>;

export const QUESTION_STATUSES = ['submitted', 'selected', 'answered', 'closed'] as const;
export const questionStatusSchema = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const classQuestionSchema = z.object({
  id: z.string().min(1),
  /** The key that makes the bank outlive the session. */
  caseStudyId: z.string().min(1),
  sessionId: z.string().min(1),
  classId: z.string().min(1),
  /** The group being asked. */
  groupId: z.string().min(1),
  askedByUid: z.string().min(1),
  askedByName: z.string().min(1),
  askedByStudentId: z.string().min(1),
  /** True hides the name from classmates; the lecturer still sees it. */
  anonymousToClass: z.boolean().default(true),
  roleId: presentationRoleIdSchema.nullable().default(null),
  category: questionCategorySchema,
  text: z.string().trim().min(10, 'errors.questionTooShort').max(1000, 'errors.questionTooLong'),
  upvotes: z.number().int().nonnegative().default(0),
  status: questionStatusSchema,
  answerText: z.string().max(4000).optional(),
  answeredByUid: z.string().optional(),
  answeredByName: z.string().optional(),
  answeredAt: z.string().optional(),
  /** Set when the answer came from the AI pass rather than from the room. */
  answeredByAi: z.boolean().default(false),
  /**
   * False when the AI said the case material does not contain the answer.
   * Kept and shown rather than hidden: "the case does not say" is itself
   * worth knowing, and it warns a reader not to treat the answer as sourced.
   */
  aiGroundedInCase: z.boolean().optional(),
});
export type ClassQuestion = z.infer<typeof classQuestionSchema>;

export const askQuestionSchema = z.object({
  category: questionCategorySchema,
  roleId: presentationRoleIdSchema.nullable().default(null),
  text: z
    .string({ error: 'errors.questionTooShort' })
    .trim()
    .min(10, 'errors.questionTooShort')
    .max(1000, 'errors.questionTooLong'),
  anonymousToClass: z.boolean().default(true),
});
export type AskQuestionRequest = z.input<typeof askQuestionSchema>;

export const answerQuestionSchema = z.object({
  questionId: z.string().min(1),
  answerText: z
    .string({ error: 'errors.answerTooShort' })
    .trim()
    .min(10, 'errors.answerTooShort')
    .max(4000),
});

/** How many questions a group answers aloud; the rest go to the bank. */
export const MAX_SELECTED_QUESTIONS = 3;

/**
 * Strips the asker's identity for reuse by a later cohort. A student of 2026
 * should not have their name read off a question by a class in 2030, but the
 * question itself is worth keeping.
 */
export function anonymiseForReuse(question: ClassQuestion): ClassQuestion {
  return {
    ...question,
    askedByUid: 'anonymous',
    askedByName: 'Anonymous',
    askedByStudentId: 'anonymous',
    anonymousToClass: true,
  };
}

/** What a classmate is allowed to see of who asked. */
export function displayAsker(question: ClassQuestion, viewerIsStaff: boolean): string | null {
  if (viewerIsStaff) return question.askedByName;
  return question.anonymousToClass ? null : question.askedByName;
}

/**
 * What one viewer is allowed to receive of a question.
 *
 * Hiding the asker's name in the markup is not hiding it: the whole question
 * object reaches the browser. So the identity is removed on the server before
 * it is sent. The lecturer still sees who asked - the questions are part of
 * the individual mark - and a student always sees their own question, which is
 * how the form knows there is one to edit.
 */
export function redactForViewer(
  question: ClassQuestion,
  viewer: { uid: string; isStaff: boolean },
): ClassQuestion {
  if (viewer.isStaff) return question;
  if (question.askedByUid === viewer.uid) return question;
  if (!question.anonymousToClass) return { ...question, askedByStudentId: 'hidden' };
  return anonymiseForReuse(question);
}
