import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  caseClaimId,
  caseClaimSchema,
  caseClaimWindow,
  classSchema,
  type CaseClaim,
  type CaseStudy,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { listCases } from '../cases/cases';
import { findMembership } from '../groups/groups';
import { assertCanViewClass } from '../academic/access';
import type { SessionUser } from '../auth/types';

/**
 * Groups choosing their own case study (SRS Module 07).
 *
 * A lecturer running six groups through a case library spends the first week
 * of term collecting choices by email and keeping a spreadsheet so that two
 * groups do not take the same case. This does that, and the "two groups"
 * problem is solved by the shape of the data rather than by being careful:
 * the claim's document id is `${classId}__${caseStudyId}`, written with
 * `create`, so the second of two simultaneous claims is refused by the
 * database.
 *
 * A claim is not an assignment. It records which case a group is working on;
 * the lecturer still schedules the presentation, because they own the
 * timetable and a date nobody chose would be a date nobody can keep.
 */

export async function setCaseSelection(
  actor: SessionUser,
  classId: string,
  mode: 'lecturer_assigns' | 'groups_choose',
  deadline: string | null,
): Promise<void> {
  const ref = getDb().collection(COLLECTIONS.classes).doc(classId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  if (deadline && Number.isNaN(Date.parse(deadline))) {
    throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');
  }

  const before = {
    caseSelection: (snapshot.get('caseSelection') as string | undefined) ?? 'lecturer_assigns',
    caseSelectionDeadline: snapshot.get('caseSelectionDeadline') as string | undefined,
  };

  await ref.update({
    caseSelection: mode,
    caseSelectionDeadline: deadline ?? FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'class.case_selection_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    before,
    after: { caseSelection: mode, caseSelectionDeadline: deadline ?? null },
  });
}

export async function listClaims(classId: string): Promise<CaseClaim[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.caseClaims)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => caseClaimSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
}

export interface ChoosableCase {
  study: CaseStudy;
  /** The claim on it, if some group in this class has taken it. */
  claim: CaseClaim | null;
}

export interface CaseSelectionState {
  cases: ChoosableCase[];
  /**
   * Whether choosing is still allowed, decided by the server's clock.
   *
   * The page must not work this out for itself. A student whose laptop clock
   * is an hour fast would be told the window had closed while their classmate
   * was still choosing - and the deadline is the same deadline for everybody.
   */
  open: boolean;
  closedBecause: string | null;
}

/**
 * Every published case, with whoever has already taken it.
 *
 * Taken cases are listed rather than hidden: a group deciding what to work on
 * should see that Amazon has gone to group 2, not wonder where it went.
 */
export async function choosableCases(
  classId: string,
  now = Date.now(),
): Promise<CaseSelectionState> {
  const db = getDb();
  const [cases, claims, classSnapshot] = await Promise.all([
    listCases({ publishedOnly: true }),
    listClaims(classId),
    db.collection(COLLECTIONS.classes).doc(classId).get(),
  ]);

  const details = classSchema.safeParse(classSnapshot.data());
  const window = details.success
    ? caseClaimWindow(details.data, now)
    : ({ open: false, messageKey: 'errors.caseSelectionNotOpen' } as const);

  const byCase = new Map(claims.map((claim) => [claim.caseStudyId, claim]));
  return {
    cases: cases.map((study) => ({ study, claim: byCase.get(study.id) ?? null })),
    open: window.open,
    closedBecause: window.open ? null : window.messageKey,
  };
}

/**
 * A group takes a case.
 *
 * Everything that could make this wrong is checked inside one transaction,
 * and the one that matters - two groups, one case, same instant - is not
 * checked at all. It is the document id.
 */
export async function claimCase(
  actor: SessionUser,
  classId: string,
  caseStudyId: string,
  now = Date.now(),
): Promise<CaseClaim> {
  const db = getDb();

  // Two different refusals, and telling them apart matters: a student who has
  // joined the class but not yet a group is not an intruder, they are early.
  // `findMembership` reads group membership, so on its own it would call the
  // second case the first.
  await assertCanViewClass(actor, classId);

  const membership = await findMembership(classId, actor.uid);
  if (!membership?.groupId) throw new AppError('POLICY_VIOLATION', 'errors.noGroupYet');

  const classSnapshot = await db.collection(COLLECTIONS.classes).doc(classId).get();
  if (!classSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  const details = classSchema.safeParse(classSnapshot.data());
  if (!details.success) throw new AppError('INTERNAL', 'errors.unexpected');

  const window = caseClaimWindow(details.data, now);
  if (!window.open) throw new AppError('POLICY_VIOLATION', window.messageKey);

  const study = await db.collection(COLLECTIONS.caseStudies).doc(caseStudyId).get();
  if (!study.exists) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
  // A draft case is not offered to students anywhere else either.
  if (study.get('status') !== 'published') {
    throw new AppError('POLICY_VIOLATION', 'errors.caseNotPublished');
  }

  const claim: CaseClaim = {
    id: caseClaimId(classId, caseStudyId),
    classId,
    caseStudyId,
    groupId: membership.groupId,
    claimedByUid: actor.uid,
    claimedByName: membership.fullName,
    claimedAt: new Date(now).toISOString(),
  };

  await db.runTransaction(async (tx) => {
    // One case per group: a group that has already chosen is not choosing
    // again, it is changing its mind, and that is the lecturer's to allow.
    const mine = await tx.get(
      db
        .collection(COLLECTIONS.caseClaims)
        .where('classId', '==', classId)
        .where('groupId', '==', membership.groupId)
        .limit(1),
    );
    if (!mine.empty) throw new AppError('CONFLICT', 'errors.groupAlreadyChose');

    const ref = db.collection(COLLECTIONS.caseClaims).doc(claim.id);
    const existing = await tx.get(ref);
    if (existing.exists) throw new AppError('CONFLICT', 'errors.caseAlreadyTaken');

    // `create`, not `set`. The read above narrows the race; this closes it.
    tx.create(ref, { ...claim, createdAt: FieldValue.serverTimestamp() });
  });

  await writeAuditLog({
    action: 'case.claimed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseClaims}/${claim.id}`,
    classId,
    after: { caseStudyId, groupId: membership.groupId },
  });

  return claim;
}

/**
 * The lecturer releases a claim, so the case is free again.
 *
 * Refused once the claim has become a scheduled assignment: releasing then
 * would leave an assignment for a case the group no longer holds, and the
 * work already handed in under it. The assignment is the lecturer's to
 * withdraw first, deliberately and with its own trail.
 */
export async function releaseClaim(
  actor: SessionUser,
  classId: string,
  caseStudyId: string,
  reason: string,
): Promise<void> {
  if (reason.trim().length < 3) {
    throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
  }

  const ref = getDb().collection(COLLECTIONS.caseClaims).doc(caseClaimId(classId, caseStudyId));
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.claimNotFound');

  if (snapshot.get('assignmentId')) {
    throw new AppError('POLICY_VIOLATION', 'errors.claimAlreadyScheduled');
  }

  await ref.delete();

  await writeAuditLog({
    action: 'case.claim_released',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseClaims}/${snapshot.id}`,
    classId,
    before: { caseStudyId, groupId: snapshot.get('groupId') as string },
    reason,
  });
}

/** Records that a claim has become a scheduled assignment. */
export async function linkClaimToAssignment(
  classId: string,
  caseStudyId: string,
  assignmentId: string,
): Promise<void> {
  const ref = getDb().collection(COLLECTIONS.caseClaims).doc(caseClaimId(classId, caseStudyId));
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  await ref.update({ assignmentId });
}
