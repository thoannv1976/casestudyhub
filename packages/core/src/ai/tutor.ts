import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  QUESTION_CATEGORIES,
  SUGGESTED_QUESTIONS_JSON_SCHEMA,
  TUTOR_GUARDRAILS,
  TUTOR_MODE_INSTRUCTIONS,
  TUTOR_RESPONSE_JSON_SCHEMA,
  suggestedQuestionsResponseSchema,
  transcriptForPrompt,
  trimTranscript,
  tutorResponseSchema,
  tutorSessionSchema,
  type QuestionCategory,
  type TutorMode,
  type TutorSession,
  type TutorTurn,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { getCase, readAttachment } from '../cases/cases';
import { getAiProvider } from './vertex';
import type { SessionUser } from '../auth/types';
import type { AiFilePart } from './provider';

/**
 * The tutor, and question suggestions for the lecturer (SRS Module 12.4).
 *
 * Both read the case material and nothing else. The tutor in particular is
 * never given a mark, a rubric score or another group's work: it has nothing
 * to leak because it was never told anything to leak.
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

async function caseMaterial(caseStudyId: string): Promise<AiFilePart[]> {
  const caseStudy = await getCase(caseStudyId);
  if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  const files: AiFilePart[] = [];
  for (const attachment of caseStudy.attachments) {
    if (!INLINE_MIME_TYPES.has(attachment.contentType)) continue;
    if (attachment.sizeBytes > MAX_INLINE_BYTES) continue;
    const { body } = await readAttachment(caseStudyId, attachment.id);
    files.push({ mimeType: attachment.contentType, data: body.toString('base64') });
  }

  if (files.length === 0) throw new AppError('POLICY_VIOLATION', 'errors.nothingToEvaluate');
  return files;
}

export function tutorSessionId(caseStudyId: string, uid: string): string {
  return `${caseStudyId}__${uid}`;
}

export async function getTutorSession(
  caseStudyId: string,
  uid: string,
): Promise<TutorSession | null> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.aiTutorSessions)
    .doc(tutorSessionId(caseStudyId, uid))
    .get();
  if (!snapshot.exists) return null;
  const parsed = tutorSessionSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

export async function askTutor(
  student: SessionUser,
  caseStudyId: string,
  mode: TutorMode,
  message: string,
): Promise<TutorSession> {
  const existing = await getTutorSession(caseStudyId, student.uid);
  const history = trimTranscript(existing?.turns ?? []);

  const provider = getAiProvider();
  const result = await provider.generate({
    system: `${TUTOR_GUARDRAILS}\n\n${TUTOR_MODE_INSTRUCTIONS[mode]}`,
    prompt: [
      'The case material is attached.',
      history.length > 0 ? `\nSo far in this conversation:\n${transcriptForPrompt(history)}` : '',
      // Delimited and labelled: a message that itself says "ignore the rules
      // above" is a student's words, not an instruction to follow.
      '\nThe student now says, between the markers:',
      '<<<STUDENT_MESSAGE',
      message,
      'STUDENT_MESSAGE>>>',
    ]
      .filter(Boolean)
      .join('\n'),
    files: await caseMaterial(caseStudyId),
    schema: tutorResponseSchema,
    responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
    temperature: 0.4,
    maxOutputTokens: 1024,
  });

  const now = new Date().toISOString();
  const turns: TutorTurn[] = trimTranscript([
    ...history,
    { role: 'student', text: message.slice(0, 4000), mode, at: now },
    {
      role: 'tutor',
      text: [result.value.reply, result.value.pointer ? `\n\n→ ${result.value.pointer}` : '']
        .join('')
        .slice(0, 4000),
      mode,
      at: now,
    },
  ]);

  const session: TutorSession = {
    id: tutorSessionId(caseStudyId, student.uid),
    caseStudyId,
    studentUid: student.uid,
    turns,
    model: result.model,
    updatedAt: now,
  };

  await getDb()
    .collection(COLLECTIONS.aiTutorSessions)
    .doc(session.id)
    .set({ ...session, savedAt: FieldValue.serverTimestamp() });

  return session;
}

/** A student may throw away the conversation and start again. */
export async function clearTutorSession(caseStudyId: string, uid: string): Promise<void> {
  await getDb()
    .collection(COLLECTIONS.aiTutorSessions)
    .doc(tutorSessionId(caseStudyId, uid))
    .delete();
}

export interface SuggestedQuestion {
  text: string;
  category: QuestionCategory;
  whyItIsWorthAsking: string;
}

/**
 * Questions a lecturer might put to a presenting group.
 *
 * Suggestions only: they are shown on screen and never written into the
 * question wall, because a wall that fills itself stops being the class's.
 */
export async function suggestQuestions(
  actor: SessionUser,
  caseStudyId: string,
  count = 6,
): Promise<SuggestedQuestion[]> {
  const provider = getAiProvider();
  const result = await provider.generate({
    system:
      'You help a university lecturer prepare the Q&A after a student case study presentation. Propose questions that test understanding rather than recall, and that the attached case material can settle.',
    prompt: [
      `Propose ${Math.min(Math.max(count, 1), 12)} questions about the attached case.`,
      `Use these categories: ${QUESTION_CATEGORIES.join(', ')}.`,
      'For each, say in one sentence what asking it would reveal about the group.',
      'Vary the categories; do not propose six of the same kind.',
    ].join('\n'),
    files: await caseMaterial(caseStudyId),
    schema: suggestedQuestionsResponseSchema,
    responseSchema: SUGGESTED_QUESTIONS_JSON_SCHEMA,
    temperature: 0.6,
  });

  await writeAuditLog({
    action: 'ai.questions_suggested',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseStudies}/${caseStudyId}`,
    after: { count: result.value.questions.length },
  });

  const allowed = new Set<string>(QUESTION_CATEGORIES);
  return result.value.questions
    .filter((question) => question.text.trim().length >= 10)
    .map((question) => ({
      text: question.text.trim().slice(0, 1000),
      category: (allowed.has(question.category)
        ? question.category
        : 'clarification') as QuestionCategory,
      whyItIsWorthAsking: question.whyItIsWorthAsking.trim().slice(0, 500),
    }))
    .slice(0, 12);
}
