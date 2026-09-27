import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  questionClusterSetSchema,
  reconcileClusters,
  type QuestionClusterSet,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { getSession } from '../sessions/sessions';
import { listSessionQuestions } from '../questions/questions';
import { getAiProvider } from './gateway';
import type { SessionUser } from '../auth/types';

/**
 * Grouping a question wall into themes (SRS Module 12.5).
 *
 * Sixty students ask sixty questions and a good half of them are the same
 * question in different words. The group has ten minutes of Q&A. Grouping the
 * wall is what turns it into an agenda: answer the theme once and you have
 * answered eleven people.
 *
 * The model proposes; nothing is decided. The grouping is stored beside the
 * questions, never inside them - no question is edited, no status changes, and
 * running it again simply replaces the previous reading.
 */

const SYSTEM_PROMPT = `You are helping a university lecturer run a question and answer session.
You will be given the questions a class asked one presenting group.
Group them into three to six themes, so that answering one theme answers every question in it.
Give each theme a short title in the same language the questions were asked in - six words at most, naming what the theme is about rather than describing it.
Put every question in exactly one theme. Use the question ids exactly as given; never invent one.
Answer only in the JSON shape you were given.`;

const clusterResponseSchema = z.object({
  clusters: z.array(
    z.object({
      title: z.string(),
      questionIds: z.array(z.string()),
    }),
  ),
});

const CLUSTER_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          questionIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'questionIds'],
      },
    },
  },
  required: ['clusters'],
};

export async function getQuestionClusters(sessionId: string): Promise<QuestionClusterSet | null> {
  const snapshot = await getDb().collection(COLLECTIONS.questionClusters).doc(sessionId).get();
  if (!snapshot.exists) return null;
  const parsed = questionClusterSetSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

/** Below this there is nothing to group: the wall is already an agenda. */
export const MIN_QUESTIONS_TO_CLUSTER = 3;

export async function clusterSessionQuestions(
  actor: SessionUser,
  sessionId: string,
): Promise<QuestionClusterSet> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');

  const questions = await listSessionQuestions(sessionId);
  if (questions.length < MIN_QUESTIONS_TO_CLUSTER) {
    throw new AppError('POLICY_VIOLATION', 'errors.tooFewQuestionsToCluster');
  }

  const provider = await getAiProvider();
  const result = await provider.generate({
    system: SYSTEM_PROMPT,
    prompt: [
      'Group these questions into themes.',
      '',
      ...questions.map((question) => `${question.id} [${question.category}]: ${question.text}`),
    ].join('\n'),
    schema: clusterResponseSchema,
    responseSchema: CLUSTER_RESPONSE_JSON_SCHEMA,
    temperature: 0.2,
  });

  // Brought inside the questions that exist before anything is stored: an id
  // the model invented would otherwise become a theme pointing at nothing.
  const reconciled = reconcileClusters(
    result.value.clusters,
    questions.map((question) => question.id),
  );

  const set: QuestionClusterSet = {
    sessionId,
    classId: session.classId,
    clusters: reconciled.clusters,
    unclustered: reconciled.unclustered,
    model: result.model,
    createdAt: new Date().toISOString(),
    requestedByUid: actor.uid,
  };

  await getDb()
    .collection(COLLECTIONS.questionClusters)
    .doc(sessionId)
    .set({ ...set, savedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'ai.questions_clustered',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.questionClusters}/${sessionId}`,
    classId: session.classId,
    after: {
      model: result.model,
      clusters: set.clusters.length,
      unclustered: set.unclustered.length,
    },
  });

  return set;
}
