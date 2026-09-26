import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, currentAttachments, type ClassQuestion } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { getCase, readAttachment } from '../cases/cases';
import { listCaseQuestions } from '../questions/questions';
import { getAiProvider } from './gateway';
import type { SessionUser } from '../auth/types';
import type { AiFilePart } from './provider';

/**
 * Answering the whole question bank (SRS Module 12.5).
 *
 * This is the point of the question wall. A class of sixty asks sixty
 * questions about one case; the group answers two or three aloud and the rest
 * would otherwise be lost. Here they are answered against the case material
 * and kept with the case, so next year's class - and the year after - inherits
 * what this class wanted to know.
 *
 * An AI answer is marked as one (`answeredByAi`), and an answer given aloud in
 * the room is never overwritten by it. What a student said stands.
 */

const INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

/** How many questions go to the model at once. */
export const ANSWER_BATCH_SIZE = 10;

const SYSTEM_PROMPT = `You are writing a reference answer key for a university case study, to be read by students in later years.
Answer each question from the attached case material. Write for a student who has read the case but not the discussion.
Two to five sentences each: enough to be useful, short enough to read.
If the case material does not contain the answer, say plainly what is missing and what the reader would need to look up. Never invent a figure.
Answer only in the JSON shape you were given, in the same language as the question.`;

const answerResponseSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
      groundedInCase: z.boolean().default(true),
    }),
  ),
});

const ANSWER_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          answer: { type: 'string' },
          groundedInCase: { type: 'boolean' },
        },
        required: ['questionId', 'answer', 'groundedInCase'],
      },
    },
  },
  required: ['answers'],
};

async function caseMaterial(caseStudyId: string): Promise<AiFilePart[]> {
  const caseStudy = await getCase(caseStudyId);
  if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  const files: AiFilePart[] = [];
  for (const attachment of currentAttachments(caseStudy.attachments)) {
    if (!INLINE_MIME_TYPES.has(attachment.contentType)) continue;
    const { body } = await readAttachment(caseStudyId, attachment.id);
    if (body.byteLength > MAX_INLINE_BYTES) continue;
    files.push({ mimeType: attachment.contentType, data: body.toString('base64') });
  }
  return files;
}

export interface AnswerBankResult {
  considered: number;
  answered: number;
  ungrounded: number;
  skipped: number;
  model: string;
  promptTokens: number;
  outputTokens: number;
}

/** Questions the AI should take on: everything the room did not answer. */
export function questionsAwaitingAnswer(questions: readonly ClassQuestion[]): ClassQuestion[] {
  return questions.filter((question) => question.status !== 'answered' && !question.answerText);
}

export async function answerQuestionBank(
  actor: SessionUser,
  caseStudyId: string,
  options: { limit?: number } = {},
): Promise<AnswerBankResult> {
  const all = await listCaseQuestions(caseStudyId);
  const pending = questionsAwaitingAnswer(all).slice(0, options.limit ?? all.length);

  if (pending.length === 0) {
    return {
      considered: all.length,
      answered: 0,
      ungrounded: 0,
      skipped: 0,
      model: '-',
      promptTokens: 0,
      outputTokens: 0,
    };
  }

  const files = await caseMaterial(caseStudyId);
  if (files.length === 0) throw new AppError('POLICY_VIOLATION', 'errors.nothingToEvaluate');

  const provider = await getAiProvider();
  const db = getDb();

  let answered = 0;
  let ungrounded = 0;
  let promptTokens = 0;
  let outputTokens = 0;

  // In batches, so one very large class does not become one very large prompt
  // and so a failure halfway through still leaves the earlier answers written.
  for (let start = 0; start < pending.length; start += ANSWER_BATCH_SIZE) {
    const batch = pending.slice(start, start + ANSWER_BATCH_SIZE);

    const result = await provider.generate({
      system: SYSTEM_PROMPT,
      prompt: [
        'Answer each of these questions about the attached case material.',
        'Return the same questionId you were given for each answer.',
        '',
        ...batch.map((question) => `${question.id} [${question.category}]: ${question.text}`),
      ].join('\n'),
      files,
      schema: answerResponseSchema,
      responseSchema: ANSWER_RESPONSE_JSON_SCHEMA,
      temperature: 0.3,
    });

    promptTokens += result.promptTokens;
    outputTokens += result.outputTokens;

    const byId = new Map(batch.map((question) => [question.id, question]));
    const writes = db.batch();
    let queued = 0;

    for (const entry of result.value.answers) {
      const question = byId.get(entry.questionId);
      if (!question) continue;
      const text = entry.answer.trim();
      if (text.length < 10) continue;

      writes.update(db.collection(COLLECTIONS.questions).doc(question.id), {
        answerText: text.slice(0, 4000),
        answeredByAi: true,
        answeredByName: provider.model,
        answeredAt: new Date().toISOString(),
        // Deliberately not 'answered': that status means a member of the group
        // answered it in the room, and it feeds the Q&A checklist.
        status: 'closed',
        aiGroundedInCase: entry.groundedInCase,
        updatedAt: FieldValue.serverTimestamp(),
      });
      queued += 1;
      answered += 1;
      if (!entry.groundedInCase) ungrounded += 1;
    }

    if (queued > 0) await writes.commit();
  }

  await writeAuditLog({
    action: 'ai.answers_generated',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseStudies}/${caseStudyId}`,
    after: { answered, ungrounded, promptTokens, outputTokens },
  });

  return {
    considered: all.length,
    answered,
    ungrounded,
    skipped: pending.length - answered,
    model: provider.model,
    promptTokens,
    outputTokens,
  };
}
