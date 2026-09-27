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
  /**
   * Which piece of work was being presented when this was asked. Defaulted, so
   * questions asked before the class group project existed still read as what
   * they are.
   */
  kind: z.enum(['case_study', 'group_project']).default('case_study'),
  /**
   * The key that makes the bank outlive the session - a case study accumulates
   * the questions of every cohort that studies it.
   *
   * Absent for the class group project: a project belongs to one group in one
   * class, so there is no bank for a later cohort to inherit, and its questions
   * must not leak into a case study's.
   */
  caseStudyId: z.string().min(1).optional(),
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

/**
 * The model's reading of a question wall, grouped into themes.
 *
 * A class of sixty asks sixty questions and half of them are the same question
 * in different words. Grouping them is what turns a wall into an agenda the
 * group can answer in ten minutes.
 *
 * The theme titles are written by the model, in the language the questions were
 * asked in, and stored as written. That is deliberate and it is not the thing
 * the bilingual rule forbids: a title here is *content*, of the same kind as a
 * student's question or a course learning outcome's name. Every label around it
 * - the headings, the counts, the buttons - stays a message key.
 */
export const questionClusterSchema = z.object({
  title: z.string().trim().min(1).max(120),
  questionIds: z.array(z.string().min(1)).min(1),
});
export type QuestionCluster = z.infer<typeof questionClusterSchema>;

export const questionClusterSetSchema = z.object({
  /** One per session, so the session id is the document id. */
  sessionId: z.string().min(1),
  classId: z.string().min(1),
  clusters: z.array(questionClusterSchema).max(10),
  /** Questions the model did not place anywhere, kept rather than hidden. */
  unclustered: z.array(z.string().min(1)).default([]),
  model: z.string().min(1),
  createdAt: z.string().min(1),
  requestedByUid: z.string().min(1),
});
export type QuestionClusterSet = z.infer<typeof questionClusterSetSchema>;

/**
 * Brings the model's grouping back inside the questions that actually exist.
 *
 * A model asked to group forty questions will now and then return an id it
 * invented, place one question in two themes, or quietly drop three. None of
 * that reaches the lecturer's screen: unknown ids are dropped, a question is
 * kept in the first theme that claims it, and whatever was left out is listed
 * as left out rather than disappearing.
 */
export function reconcileClusters(
  proposed: readonly { title: string; questionIds: readonly string[] }[],
  questionIds: readonly string[],
): { clusters: QuestionCluster[]; unclustered: string[] } {
  const known = new Set(questionIds);
  const placed = new Set<string>();
  const clusters: QuestionCluster[] = [];

  for (const cluster of proposed) {
    const title = cluster.title.trim().slice(0, 120);
    const ids = cluster.questionIds.filter((id) => known.has(id) && !placed.has(id));
    if (title.length === 0 || ids.length === 0) continue;

    for (const id of ids) placed.add(id);
    clusters.push({ title, questionIds: ids });
  }

  return {
    clusters: clusters.slice(0, 10),
    unclustered: questionIds.filter((id) => !placed.has(id)),
  };
}
