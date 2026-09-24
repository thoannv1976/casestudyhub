import { FieldValue } from 'firebase-admin/firestore';
import {
  AI_EVALUATION_RESPONSE_JSON_SCHEMA,
  COLLECTIONS,
  aiAssessmentSchema,
  aiEvaluationResponseSchema,
  reconcileWithRubric,
  type AiAssessment,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { policyOfAssignment } from '../policy/policy-store';
import { AppError } from '../errors';
import { getAssignment } from '../assignments/assignments';
import { getCase, readAttachment } from '../cases/cases';
import { currentVersions, listSubmissions, readSubmissionFile } from '../submissions/submissions';
import { getAiProvider } from './vertex';
import type { SessionUser } from '../auth/types';
import type { AiFilePart } from './provider';

/**
 * Marking help, with its sources attached (SRS Module 12.3).
 *
 * The model is given the same three documents a lecturer would open - the
 * case, the group's slides, the group's report - and asked to score only the
 * criteria that can honestly be judged from them. Delivery in the room is not
 * one of them and is never sent.
 *
 * What comes back is a suggestion with citations. It is stored in its own
 * collection and never touches a grade: `reconcileWithRubric` brings it inside
 * the rubric's rules, and the lecturer decides.
 */

/** Files a model will accept inline, and the ceiling we send. */
const INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

const SYSTEM_PROMPT = `You are helping a university lecturer mark a student case study presentation.
You never award a final grade: you propose points and you show where in the documents you read them.
Every judgement must cite the document, the place in it (a slide number or a page), and quote the words you relied on.
If the documents do not support a judgement, say so in "gaps" and score conservatively rather than inventing evidence.
Answer only in the JSON shape you were given.`;

/**
 * Whether a document is worth downloading at all. Checked before the file is
 * fetched, not after: a hundred-megabyte PPTX we are going to skip should
 * never leave the bucket.
 */
function canBeRead(mimeType: string, sizeBytes: number): boolean {
  return INLINE_MIME_TYPES.has(mimeType) && sizeBytes <= MAX_INLINE_BYTES;
}

export interface EvaluationSources {
  files: AiFilePart[];
  described: string[];
  skipped: string[];
}

/**
 * Collects what the model is allowed to read. Office formats are skipped
 * rather than half-parsed: a PPTX read badly would produce citations pointing
 * at slides that do not say what the citation claims, which is worse than no
 * citation at all.
 */
export async function gatherEvaluationSources(assignmentId: string): Promise<EvaluationSources> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const files: AiFilePart[] = [];
  const described: string[] = [];
  const skipped: string[] = [];

  const caseStudy = await getCase(assignment.caseStudyId);
  for (const attachment of caseStudy?.attachments ?? []) {
    if (!canBeRead(attachment.contentType, attachment.sizeBytes)) {
      skipped.push(`case: ${attachment.fileName}`);
      continue;
    }
    const { body } = await readAttachment(assignment.caseStudyId, attachment.id);
    files.push({ mimeType: attachment.contentType, data: body.toString('base64') });
    described.push(`case: ${attachment.fileName}`);
  }

  for (const submission of currentVersions(await listSubmissions(assignmentId))) {
    if (
      submission.deliverableId !== 'slides-pdf' &&
      submission.deliverableId !== 'case-analysis-report'
    ) {
      continue;
    }
    const label = submission.deliverableId === 'slides-pdf' ? 'slides' : 'report';
    if (!canBeRead(submission.contentType, submission.sizeBytes)) {
      skipped.push(`${label}: ${submission.fileName}`);
      continue;
    }
    const { body } = await readSubmissionFile(submission.id);
    files.push({ mimeType: submission.contentType, data: body.toString('base64') });
    described.push(`${label}: ${submission.fileName}`);
  }

  return { files, described, skipped };
}

export async function getAiAssessment(assignmentId: string): Promise<AiAssessment | null> {
  const snapshot = await getDb().collection(COLLECTIONS.aiAssessments).doc(assignmentId).get();
  if (!snapshot.exists) return null;
  const parsed = aiAssessmentSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

export async function evaluateSubmission(
  actor: SessionUser,
  assignmentId: string,
): Promise<AiAssessment> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const sources = await gatherEvaluationSources(assignmentId);
  if (sources.files.length === 0) {
    throw new AppError('POLICY_VIOLATION', 'errors.nothingToEvaluate');
  }

  // The same framework the lecturer will mark against: a model scoring
  // criteria that no longer match the marking screen is worse than none.
  const policy = await policyOfAssignment(assignment);
  const assessable = policy.rubric.criteria.filter((criterion) => criterion.aiAssessable);

  const prompt = [
    `Documents attached, in order: ${sources.described.join('; ')}.`,
    '',
    'Score each of these criteria and no others:',
    ...assessable.map(
      (criterion) => `- ${criterion.id} (out of ${criterion.maxPoints}): ${criterion.key}`,
    ),
    '',
    'For each criterion give suggestedPoints, your reasoning, and at least one citation',
    'naming the document (slides, report or case), the slide or page, and the quoted words.',
    'List in "gaps" anything the rubric asks for that the documents do not contain.',
  ].join('\n');

  const provider = getAiProvider();
  const result = await provider.generate({
    system: SYSTEM_PROMPT,
    prompt,
    files: sources.files,
    schema: aiEvaluationResponseSchema,
    responseSchema: AI_EVALUATION_RESPONSE_JSON_SCHEMA,
    temperature: 0.1,
  });

  const reconciled = reconcileWithRubric(result.value, policy.rubric);

  const assessment: AiAssessment = {
    id: assignmentId,
    assignmentId,
    classId: assignment.classId,
    groupId: assignment.groupId,
    caseStudyId: assignment.caseStudyId,
    criteria: reconciled.criteria,
    suggestedTotal: reconciled.suggestedTotal,
    assessableMaxPoints: reconciled.assessableMaxPoints,
    gaps: [
      ...result.value.gaps.slice(0, 20).map((gap) => gap.slice(0, 500)),
      // A document we could not send is a gap in the evidence, not a silence.
      ...sources.skipped.map((name) => `Not read by the model: ${name}`),
    ].slice(0, 20),
    rubricId: policy.rubric.id,
    rubricVersion: assignment.rubricVersion,
    model: result.model,
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    createdAt: new Date().toISOString(),
    requestedByUid: actor.uid,
  };

  await getDb()
    .collection(COLLECTIONS.aiAssessments)
    .doc(assignmentId)
    .set({ ...assessment, savedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'ai.assessment_requested',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.aiAssessments}/${assignmentId}`,
    classId: assignment.classId,
    after: {
      model: result.model,
      suggestedTotal: reconciled.suggestedTotal,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
    },
  });

  return assessment;
}
