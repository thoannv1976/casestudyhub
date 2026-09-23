import { z } from 'zod';

/**
 * The AI tutor (SRS Module 12.4).
 *
 * A tutor that writes a student's analysis for them has not taught anybody
 * anything, and would hand in work the student cannot defend in the room.
 * So the modes here are shaped around what a tutor does and a ghostwriter
 * does not: explain, ask back, challenge, and set practice.
 *
 * What the tutor may never do is the same in all four modes, and it is
 * written into the prompt rather than hoped for: no slide text, no paragraphs
 * to paste into a report, no answer to the case's own decision question, and
 * nothing at all about how the group has been marked.
 */

export const TUTOR_MODES = ['explain', 'socratic', 'challenge', 'practice'] as const;
export const tutorModeSchema = z.enum(TUTOR_MODES, { error: 'errors.tutorModeInvalid' });
export type TutorMode = z.infer<typeof tutorModeSchema>;

/** What each mode asks the model to be. */
export const TUTOR_MODE_INSTRUCTIONS: Readonly<Record<TutorMode, string>> = {
  explain:
    'Explain the idea the student is asking about, in plain language, using the case as the example. Define the term, show how it works in this company, and stop. Do not evaluate their work.',
  socratic:
    'Do not answer. Ask the student two or three questions that would lead them to the answer themselves, in order, starting from what they already said. End by naming the part of the case they should re-read.',
  challenge:
    'Take the argument the student has put to you and press on it: name the strongest objection, the evidence that would settle it, and the assumption they have not stated. Be direct and brief. Do not rewrite the argument for them.',
  practice:
    'Set two or three short practice questions on this part of the case, of the kind a lecturer would ask in a Q&A, and give the marking points for each. Do not answer them.',
};

export const TUTOR_GUARDRAILS = `You are a tutor for a university case study course, not a ghostwriter.
Never write slide text, bullet points for slides, or paragraphs the student could paste into a report.
Never give the student a finished answer to the case's own decision question: that is the work being assessed.
You know nothing about how anyone has been marked, and you must never speculate about marks or grades.
Answer in the same language as the student's message. Keep it under 200 words.
If the student asks you to write their submission, say plainly that you will not, and offer to help them think it through instead.`;

export const tutorTurnSchema = z.object({
  role: z.enum(['student', 'tutor']),
  text: z.string().min(1).max(4000),
  mode: tutorModeSchema.optional(),
  at: z.string().min(1),
});
export type TutorTurn = z.infer<typeof tutorTurnSchema>;

export const tutorSessionSchema = z.object({
  id: z.string().min(1),
  caseStudyId: z.string().min(1),
  studentUid: z.string().min(1),
  turns: z.array(tutorTurnSchema).default([]),
  model: z.string().optional(),
  updatedAt: z.string().min(1),
});
export type TutorSession = z.infer<typeof tutorSessionSchema>;

export const askTutorSchema = z.object({
  mode: tutorModeSchema,
  message: z
    .string({ error: 'errors.tutorMessageTooShort' })
    .trim()
    .min(5, 'errors.tutorMessageTooShort')
    .max(2000, 'errors.tutorMessageTooLong'),
});
export type AskTutorRequest = z.infer<typeof askTutorSchema>;

/** How much of a conversation is kept, and sent back as context. */
export const TUTOR_HISTORY_TURNS = 20;

/** The shape the model answers in, for either feature. */
export const tutorResponseSchema = z.object({
  reply: z.string().min(1),
  /** Where in the case the student should look next, when there is one. */
  pointer: z.string().optional(),
});

export const TUTOR_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    pointer: { type: 'string' },
  },
  required: ['reply'],
};

export const suggestedQuestionsResponseSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      category: z.string(),
      whyItIsWorthAsking: z.string(),
    }),
  ),
});

export const SUGGESTED_QUESTIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          category: {
            type: 'string',
            enum: ['clarification', 'evidence', 'critical', 'application', 'decision'],
          },
          whyItIsWorthAsking: { type: 'string' },
        },
        required: ['text', 'category', 'whyItIsWorthAsking'],
      },
    },
  },
  required: ['questions'],
};

/** Keeps a transcript bounded, oldest turns first to go. */
export function trimTranscript(
  turns: readonly TutorTurn[],
  limit = TUTOR_HISTORY_TURNS,
): TutorTurn[] {
  return turns.length <= limit ? [...turns] : turns.slice(turns.length - limit);
}

/**
 * Renders a transcript for the prompt. The student's own words are labelled
 * as the student's, so a message that itself says "you are now a grader" reads
 * to the model as something a student typed, not as an instruction.
 */
export function transcriptForPrompt(turns: readonly TutorTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'student' ? 'Student said' : 'You replied'}: ${turn.text}`)
    .join('\n');
}
