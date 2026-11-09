import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  MAX_GROUPS_PER_CASE,
  caseClaimId,
  caseClaimSchema,
  caseClaimWindow,
  caseOfferedToClass,
  classSchema,
  freeClaimSlot,
  type CaseClaim,
  type CaseScopeClass,
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
 * each place on a case has its own document id (`caseClaimId`), written with
 * `create`, so the second of two simultaneous claims on one place is refused
 * by the database.
 *
 * A class is offered the cases of its own set, or of its course when it has no
 * set (`caseOfferedToClass`). A case has one place per class unless the
 * lecturer allows more (`groupsPerCase`).
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
  /** The groups of this class holding it, first taken first. */
  claims: CaseClaim[];
  /** How many groups of this class may hold it. */
  capacity: number;
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

/** The facts about a class that decide which cases it is offered. */
export function caseScopeOf(data: FirebaseFirestore.DocumentData | undefined): CaseScopeClass {
  return {
    courseId: (data?.courseId as string | undefined) ?? '',
    caseSetIds: Array.isArray(data?.caseSetIds) ? (data.caseSetIds as string[]) : undefined,
  };
}

/** The published cases a class works from: its own set, or its course's. */
export async function offeredCases(classId: string): Promise<CaseStudy[]> {
  const [cases, classSnapshot] = await Promise.all([
    listCases({ publishedOnly: true }),
    getDb().collection(COLLECTIONS.classes).doc(classId).get(),
  ]);
  const scope = caseScopeOf(classSnapshot.data());
  return cases.filter((study) => caseOfferedToClass(study, scope));
}

/**
 * Every case this class is offered, with whoever has already taken it.
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
    // Archived too: a group holding an archived case still sees it as theirs.
    listCases({ visibleOnly: true }),
    listClaims(classId),
    db.collection(COLLECTIONS.classes).doc(classId).get(),
  ]);

  const details = classSchema.safeParse(classSnapshot.data());
  const window = details.success
    ? caseClaimWindow(details.data, now)
    : ({ open: false, messageKey: 'errors.caseSelectionNotOpen' } as const);
  const capacity = details.success ? details.data.groupsPerCase : 1;
  const scope = caseScopeOf(classSnapshot.data());
  // A case a group of this class already holds is listed even if it is no
  // longer offered, so the group still sees it as theirs.
  const held = new Set(claims.map((claim) => claim.caseStudyId));

  return {
    cases: cases
      .filter((study) => caseOfferedToClass(study, scope) || held.has(study.id))
      .map((study) => ({
        study,
        claims: claims.filter((claim) => claim.caseStudyId === study.id),
        capacity,
      })),
    open: window.open,
    closedBecause: window.open ? null : window.messageKey,
  };
}

/**
 * A group takes a case.
 *
 * Everything that could make this wrong is checked inside one transaction,
 * and the one that matters - two groups, one place, same instant - is not
 * checked at all. It is the document id.
 */
export async function claimCase(
  actor: SessionUser,
  classId: string,
  caseStudyId: string,
  now = Date.now(),
): Promise<CaseClaim> {
  // Two different refusals, and telling them apart matters: a student who has
  // joined the class but not yet a group is not an intruder, they are early.
  // `findMembership` reads group membership, so on its own it would call the
  // second case the first.
  await assertCanViewClass(actor, classId);

  const membership = await findMembership(classId, actor.uid);
  if (!membership?.groupId) throw new AppError('POLICY_VIOLATION', 'errors.noGroupYet');

  const claimant = { uid: actor.uid, groupId: membership.groupId, name: membership.fullName };

  // Two groups can read the same free place and both write it. The database
  // refuses the second; trying again reads that place as taken and moves on
  // to the next one, or finds the case full.
  let claim: CaseClaim | null = null;
  for (let attempt = 0; claim === null; attempt += 1) {
    try {
      claim = await claimFreePlace(classId, caseStudyId, claimant, now);
    } catch (error) {
      if (!placeAlreadyTaken(error) || attempt >= MAX_GROUPS_PER_CASE) throw error;
    }
  }

  await writeAuditLog({
    action: 'case.claimed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.caseClaims}/${claim.id}`,
    classId,
    after: { caseStudyId, groupId: membership.groupId, slot: claim.slot },
  });

  return claim;
}

/** The database's refusal of a second `create` on the same document. */
function placeAlreadyTaken(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || /ALREADY_EXISTS/.test(String(error));
}

async function claimFreePlace(
  classId: string,
  caseStudyId: string,
  claimant: { uid: string; groupId: string; name: string },
  now: number,
): Promise<CaseClaim> {
  const db = getDb();
  const classRef = db.collection(COLLECTIONS.classes).doc(classId);
  const caseRef = db.collection(COLLECTIONS.caseStudies).doc(caseStudyId);

  // The class is read inside the transaction too, so a lecturer shrinking the
  // set or the places at the same moment is serialised against the claim
  // rather than slipped past.
  return db.runTransaction(async (tx) => {
    const [classSnapshot, study] = await Promise.all([tx.get(classRef), tx.get(caseRef)]);
    if (!classSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

    const details = classSchema.safeParse(classSnapshot.data());
    if (!details.success) throw new AppError('INTERNAL', 'errors.unexpected');

    const window = caseClaimWindow(details.data, now);
    if (!window.open) throw new AppError('POLICY_VIOLATION', window.messageKey);

    if (!study.exists) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    // A draft case is not offered to students anywhere else either.
    const status = study.get('status') as CaseStudy['status'];
    if (status !== 'published') {
      throw new AppError('POLICY_VIOLATION', 'errors.caseNotPublished');
    }
    const offered = caseOfferedToClass(
      { id: caseStudyId, courseId: study.get('courseId') as string, status },
      details.data,
    );
    if (!offered) throw new AppError('POLICY_VIOLATION', 'errors.caseNotOffered');

    // One case per group: a group that has already chosen is not choosing
    // again, it is changing its mind, and that is the lecturer's to allow.
    const mine = await tx.get(
      db
        .collection(COLLECTIONS.caseClaims)
        .where('classId', '==', classId)
        .where('groupId', '==', claimant.groupId)
        .limit(1),
    );
    if (!mine.empty) throw new AppError('CONFLICT', 'errors.groupAlreadyChose');

    const holders = await tx.get(
      db
        .collection(COLLECTIONS.caseClaims)
        .where('classId', '==', classId)
        .where('caseStudyId', '==', caseStudyId),
    );
    const places = details.data.groupsPerCase;
    const slot = freeClaimSlot(
      holders.docs.map((doc) => (doc.get('slot') as number | undefined) ?? 1),
      places,
    );
    if (slot === null) {
      throw new AppError('CONFLICT', places > 1 ? 'errors.caseFull' : 'errors.caseAlreadyTaken');
    }

    const claim: CaseClaim = {
      id: caseClaimId(classId, caseStudyId, slot),
      classId,
      caseStudyId,
      groupId: claimant.groupId,
      claimedByUid: claimant.uid,
      claimedByName: claimant.name,
      claimedAt: new Date(now).toISOString(),
      slot,
    };

    // `create`, not `set`. The reads above narrow the race; this closes it.
    tx.create(db.collection(COLLECTIONS.caseClaims).doc(claim.id), {
      ...claim,
      createdAt: FieldValue.serverTimestamp(),
    });
    return claim;
  });
}

/**
 * The claims of one class on one case, narrowed to one group when given.
 *
 * With several places on a case, the case alone no longer says whose claim is
 * meant; the group does.
 */
async function claimsOn(
  classId: string,
  caseStudyId: string,
  groupId?: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.caseClaims)
    .where('classId', '==', classId)
    .where('caseStudyId', '==', caseStudyId)
    .get();
  return groupId ? snapshot.docs.filter((doc) => doc.get('groupId') === groupId) : snapshot.docs;
}

/**
 * The lecturer releases a claim, so the place is free again.
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
  groupId?: string,
): Promise<void> {
  if (reason.trim().length < 3) {
    throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
  }

  const found = await claimsOn(classId, caseStudyId, groupId);
  if (found.length === 0) throw new AppError('NOT_FOUND', 'errors.claimNotFound');
  // Two groups share the case and nobody said which: releasing either would
  // be a guess about somebody's week of reading.
  if (found.length > 1) throw new AppError('VALIDATION_FAILED', 'errors.claimAmbiguous');

  const snapshot = found[0]!;
  if (snapshot.get('assignmentId')) {
    throw new AppError('POLICY_VIOLATION', 'errors.claimAlreadyScheduled');
  }

  await snapshot.ref.delete();

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

/** Records that a group's claim has become a scheduled assignment. */
export async function linkClaimToAssignment(
  classId: string,
  caseStudyId: string,
  assignmentId: string,
  groupId: string,
): Promise<void> {
  const [snapshot] = await claimsOn(classId, caseStudyId, groupId);
  if (!snapshot) return;
  await snapshot.ref.update({ assignmentId });
}
