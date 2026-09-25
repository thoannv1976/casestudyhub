import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  currentVersionsOf,
  safeFileName,
  submissionSchema,
  hostOfLink,
  validateLink,
  validateUpload,
  type Assignment,
  type Submission,
} from '@casestudyhub/shared';
import { getAdminStorage, getDb } from '../firebase/admin';
import { getServerEnv } from '../env';
import { writeAuditLog } from '../audit/audit-log';
import { policyOfAssignment } from '../policy/policy-store';
import { AppError } from '../errors';
import { getAssignment, lateAtServerTime } from '../assignments/assignments';
import type { SessionUser } from '../auth/types';

/**
 * Submissions (SRS Module 09).
 *
 * Every upload is a new version. Nothing is ever overwritten, because a
 * lecturer must be able to see what a group actually handed in at the
 * deadline, not only the last thing they uploaded afterwards.
 */

export interface SubmitInput {
  assignmentId: string;
  deliverableId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}

interface VersionSlot {
  versionNumber: number;
  submittedAt: string;
  isLate: boolean;
  ref: FirebaseFirestore.DocumentReference;
  previous: FirebaseFirestore.DocumentReference | null;
}

/**
 * The next version of one deliverable, worked out inside a transaction.
 *
 * Two group members submitting at the same moment must not both become
 * version 3, and the older one must be marked superseded by whichever wins.
 * Shared by the file and the link paths so the two cannot drift.
 */
async function nextVersion(
  tx: FirebaseFirestore.Transaction,
  assignment: Assignment,
  deliverableId: string,
): Promise<VersionSlot> {
  const db = getDb();
  const previous = await tx.get(
    db
      .collection(COLLECTIONS.submissions)
      .where('assignmentId', '==', assignment.id)
      .where('deliverableId', '==', deliverableId)
      .orderBy('versionNumber', 'desc')
      .limit(1),
  );

  const latest = previous.docs[0];
  const submittedAt = Timestamp.now();
  return {
    versionNumber: ((latest?.get('versionNumber') as number | undefined) ?? 0) + 1,
    submittedAt: submittedAt.toDate().toISOString(),
    isLate: lateAtServerTime(assignment, submittedAt),
    ref: db.collection(COLLECTIONS.submissions).doc(),
    previous: latest?.ref ?? null,
  };
}

/**
 * A deliverable satisfied by a link rather than a file.
 *
 * Versioned exactly like an upload: a group that re-records its video submits
 * again and the earlier link stays readable. Nothing is fetched from the
 * address - this platform does not hold those bytes and does not pretend to.
 */
export async function submitLink(
  actor: SessionUser,
  groupId: string,
  input: { assignmentId: string; deliverableId: string; url: string },
): Promise<Submission> {
  const assignment = await getAssignment(input.assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  if (assignment.groupId !== groupId) throw new AppError('FORBIDDEN', 'errors.notYourAssignment');

  const policy = await policyOfAssignment(assignment);
  const deliverable = policy.deliverables.find((item) => item.id === input.deliverableId);
  if (!deliverable) throw new AppError('NOT_FOUND', 'errors.deliverableNotFound');

  const url = input.url.trim();
  const problem = validateLink(url, deliverable.formats);
  if (problem) throw new AppError('VALIDATION_FAILED', problem.messageKey);

  const db = getDb();
  const submission = await db.runTransaction(async (tx) => {
    const slot = await nextVersion(tx, assignment, input.deliverableId);

    const record = {
      id: slot.ref.id,
      assignmentId: input.assignmentId,
      groupId,
      deliverableId: input.deliverableId,
      submittedByUid: actor.uid,
      submittedAt: slot.submittedAt,
      // The host, because that is what a lecturer needs to see before they
      // follow a link a student chose.
      fileName: hostOfLink(url) ?? url,
      sizeBytes: 0,
      externalUrl: url,
      versionNumber: slot.versionNumber,
      isLate: slot.isLate,
      status: 'ready' as const,
    };

    if (slot.previous) tx.update(slot.previous, { status: 'superseded' });
    tx.create(slot.ref, { ...record, createdAt: FieldValue.serverTimestamp() });
    return record;
  });

  await writeAuditLog({
    action: 'submission.created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.submissions}/${submission.id}`,
    classId: assignment.classId,
    after: {
      deliverableId: input.deliverableId,
      versionNumber: submission.versionNumber,
      isLate: submission.isLate,
      // The address itself, so a link swapped after the deadline is visible.
      externalUrl: submission.externalUrl,
    },
  });

  return submission;
}

export async function submitDeliverable(
  actor: SessionUser,
  groupId: string,
  input: SubmitInput,
): Promise<Submission> {
  const assignment = await getAssignment(input.assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  if (assignment.groupId !== groupId) throw new AppError('FORBIDDEN', 'errors.notYourAssignment');

  const policy = await policyOfAssignment(assignment);
  const deliverable = policy.deliverables.find((candidate) => candidate.id === input.deliverableId);
  if (!deliverable) throw new AppError('NOT_FOUND', 'errors.deliverableNotFound');

  const problem = validateUpload(
    { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.body.byteLength },
    deliverable.formats,
    deliverable.maxFileSizeMb,
  );
  if (problem) {
    throw new AppError('VALIDATION_FAILED', problem.messageKey, { details: problem.details });
  }

  const db = getDb();
  const fileName = safeFileName(input.fileName);

  // The version number and the "supersede the previous one" step have to agree
  // even when two group members upload at the same moment.
  const submission = await db.runTransaction(async (tx) => {
    const previous = await tx.get(
      db
        .collection(COLLECTIONS.submissions)
        .where('assignmentId', '==', input.assignmentId)
        .where('deliverableId', '==', input.deliverableId)
        .orderBy('versionNumber', 'desc')
        .limit(1),
    );

    const latest = previous.docs[0];
    const versionNumber = ((latest?.get('versionNumber') as number | undefined) ?? 0) + 1;
    const submittedAt = Timestamp.now();
    const isLate = lateAtServerTime(assignment, submittedAt);

    const ref = db.collection(COLLECTIONS.submissions).doc();
    const record = {
      id: ref.id,
      assignmentId: input.assignmentId,
      groupId,
      deliverableId: input.deliverableId,
      submittedByUid: actor.uid,
      submittedAt: submittedAt.toDate().toISOString(),
      fileName,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      storagePath: `submissions/${input.assignmentId}/${input.deliverableId}/v${versionNumber}-${fileName}`,
      versionNumber,
      isLate,
      status: 'uploaded' as const,
    };

    if (latest) {
      // The older version stays readable; it is simply no longer the one that
      // counts.
      tx.update(latest.ref, { status: 'superseded' });
    }
    tx.create(ref, { ...record, createdAt: FieldValue.serverTimestamp() });

    return record;
  });

  const bucket = getAdminStorage().bucket(getServerEnv().FIREBASE_STORAGE_BUCKET);
  await bucket.file(submission.storagePath).save(input.body, {
    contentType: input.contentType,
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });

  await db.collection(COLLECTIONS.submissions).doc(submission.id).update({ status: 'ready' });

  await writeAuditLog({
    action: 'submission.created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.submissions}/${submission.id}`,
    classId: assignment.classId,
    after: {
      deliverableId: input.deliverableId,
      versionNumber: submission.versionNumber,
      isLate: submission.isLate,
    },
  });

  return { ...submission, status: 'ready' };
}

export async function listSubmissions(assignmentId: string): Promise<Submission[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.submissions)
    .where('assignmentId', '==', assignmentId)
    .get();

  return snapshot.docs
    .map((doc) => submissionSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) =>
      a.deliverableId === b.deliverableId
        ? b.versionNumber - a.versionNumber
        : a.deliverableId.localeCompare(b.deliverableId),
    );
}

/** The version that counts for each deliverable: the most recent one. */
export function currentVersions(submissions: readonly Submission[]): Submission[] {
  return currentVersionsOf(submissions);
}

export async function readSubmissionFile(
  submissionId: string,
): Promise<{ submission: Submission; body: Buffer }> {
  const snapshot = await getDb().collection(COLLECTIONS.submissions).doc(submissionId).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.submissionNotFound');

  const parsed = submissionSchema.safeParse(snapshot.data());
  if (!parsed.success) throw new AppError('INTERNAL', 'errors.unexpected');

  // A link has no bytes of ours. Saying so is better than handing back an
  // empty buffer that a caller would treat as a readable file.
  if (!parsed.data.storagePath) {
    throw new AppError('POLICY_VIOLATION', 'errors.submissionIsALink');
  }

  const bucket = getAdminStorage().bucket(getServerEnv().FIREBASE_STORAGE_BUCKET);
  const [body] = await bucket.file(parsed.data.storagePath).download();

  return { submission: parsed.data, body };
}
