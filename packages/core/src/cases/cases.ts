import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  caseStudySchema,
  safeFileName,
  validateUpload,
  type CaseAttachment,
  type CaseStudy,
  type DeliverableFormat,
} from '@casestudyhub/shared';
import { getAdminStorage, getDb } from '../firebase/admin';
import { getServerEnv } from '../env';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * Case Study Library (SRS Module 05).
 *
 * A case study is the source material - a template, reusable across classes
 * and semesters. Handing it to a particular group is a separate record, so
 * one upload serves many cohorts.
 *
 * Files never become public. Uploads and downloads both pass through the
 * server, which checks who is asking before a byte moves. That is slower than
 * handing out signed URLs, and it is the reason a link cannot leak a case
 * paper to somebody outside the course.
 */

export interface CreateCaseInput {
  caseCode: string;
  title: string;
  subtitle?: string;
  company?: string;
  industry?: string;
  courseId: string;
  chapter?: string;
  description?: string;
  language: 'vi' | 'en';
  learningObjectives: string[];
  cloIds: string[];
  mainQuestions: string[];
  references: string[];
}

export async function createCase(actor: SessionUser, input: CreateCaseInput): Promise<string> {
  const db = getDb();
  const caseCode = input.caseCode.trim().toUpperCase();

  const clash = await db
    .collection(COLLECTIONS.caseStudies)
    .where('caseCode', '==', caseCode)
    .limit(1)
    .get();
  if (!clash.empty) throw new AppError('CONFLICT', 'errors.caseCodeTaken');

  const ref = db.collection(COLLECTIONS.caseStudies).doc();
  await ref.set({
    id: ref.id,
    ...input,
    caseCode,
    supportingQuestions: [],
    attachments: [],
    status: 'draft',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });

  return ref.id;
}

export async function getCase(caseId: string): Promise<CaseStudy | null> {
  const snapshot = await getDb().collection(COLLECTIONS.caseStudies).doc(caseId).get();
  if (!snapshot.exists) return null;

  const parsed = caseStudySchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new AppError('INTERNAL', 'errors.corruptCase', {
      message: `Case ${caseId} does not match the schema`,
    });
  }
  return parsed.data;
}

export async function listCases(options: { publishedOnly?: boolean } = {}): Promise<CaseStudy[]> {
  let query = getDb().collection(COLLECTIONS.caseStudies).limit(200);
  if (options.publishedOnly) query = query.where('status', '==', 'published');

  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => caseStudySchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.caseCode.localeCompare(b.caseCode));
}

/**
 * Publishing is what makes a case visible to students, so it is deliberate and
 * audited. A case with nothing attached cannot be published: students would
 * see a title and no material.
 */
export async function setCaseStatus(
  actor: SessionUser,
  caseId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<void> {
  const existing = await getCase(caseId);
  if (!existing) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  if (status === 'published' && existing.attachments.length === 0) {
    throw new AppError('POLICY_VIOLATION', 'errors.caseHasNoMaterial');
  }

  await getDb().collection(COLLECTIONS.caseStudies).doc(caseId).update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'case.published',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseStudies}/${caseId}`,
    before: { status: existing.status },
    after: { status },
  });
}

const CASE_UPLOAD_FORMATS: DeliverableFormat[] = ['PDF', 'DOCX', 'PPTX', 'IMAGE'];

export interface UploadInput {
  fileName: string;
  contentType: string;
  kind: CaseAttachment['kind'];
  body: Buffer;
}

export async function addAttachment(
  actor: SessionUser,
  caseId: string,
  input: UploadInput,
): Promise<CaseAttachment> {
  const existing = await getCase(caseId);
  if (!existing) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  const problem = validateUpload(
    { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.body.byteLength },
    CASE_UPLOAD_FORMATS,
  );
  if (problem) {
    throw new AppError('VALIDATION_FAILED', problem.messageKey, { details: problem.details });
  }

  const db = getDb();
  const attachmentId = db.collection(COLLECTIONS.caseStudies).doc().id;
  const fileName = safeFileName(input.fileName);
  const storagePath = `cases/${caseId}/${attachmentId}-${fileName}`;

  const bucket = getAdminStorage().bucket(getServerEnv().FIREBASE_STORAGE_BUCKET);
  await bucket.file(storagePath).save(input.body, {
    contentType: input.contentType,
    // Nothing here is ever served from a cache the platform does not control.
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });

  const attachment: CaseAttachment = {
    id: attachmentId,
    kind: input.kind,
    fileName,
    contentType: input.contentType,
    sizeBytes: input.body.byteLength,
    storagePath,
  };

  await db
    .collection(COLLECTIONS.caseStudies)
    .doc(caseId)
    .update({
      attachments: FieldValue.arrayUnion(attachment),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await writeAuditLog({
    action: 'case.attachment_added',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseStudies}/${caseId}`,
    after: { fileName, sizeBytes: attachment.sizeBytes, kind: input.kind },
  });

  return attachment;
}

export async function readAttachment(
  caseId: string,
  attachmentId: string,
): Promise<{ attachment: CaseAttachment; body: Buffer }> {
  const existing = await getCase(caseId);
  if (!existing) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  const attachment = existing.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) throw new AppError('NOT_FOUND', 'errors.attachmentNotFound');

  const bucket = getAdminStorage().bucket(getServerEnv().FIREBASE_STORAGE_BUCKET);
  const [body] = await bucket.file(attachment.storagePath).download();

  return { attachment, body };
}

export async function removeAttachment(
  actor: SessionUser,
  caseId: string,
  attachmentId: string,
): Promise<void> {
  const existing = await getCase(caseId);
  if (!existing) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

  const attachment = existing.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) throw new AppError('NOT_FOUND', 'errors.attachmentNotFound');

  const bucket = getAdminStorage().bucket(getServerEnv().FIREBASE_STORAGE_BUCKET);
  await bucket
    .file(attachment.storagePath)
    .delete()
    .catch(() => {
      // The record is what students see; a file already gone must not block it.
    });

  await getDb()
    .collection(COLLECTIONS.caseStudies)
    .doc(caseId)
    .update({
      attachments: FieldValue.arrayRemove(attachment),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await writeAuditLog({
    action: 'case.attachment_removed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseStudies}/${caseId}`,
    before: { fileName: attachment.fileName },
  });
}
