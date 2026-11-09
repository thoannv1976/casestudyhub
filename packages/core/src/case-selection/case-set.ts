import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, MAX_CASE_SET, MAX_GROUPS_PER_CASE } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { assertCanManageClass } from '../academic/structure';
import type { SessionUser } from '../auth/types';
import { offeredCases } from './case-selection';

/**
 * A class's own set of cases, picked from the shared library.
 *
 * The library is shared on purpose: a case is uploaded once and serves every
 * cohort after. Which of its cases a given class works from used to be decided
 * by the course the case was filed under, so a new course for a new intake
 * started with an empty list and the lecturer uploaded the same files again.
 * A set belongs to the class instead, and the next class copies it.
 */

export interface CaseSetView {
  /** False while the class still works from its course's published cases. */
  explicit: boolean;
  /** The class's set, or what it is offered from its course when it has none. */
  caseIds: string[];
  groupsPerCase: number;
  /** Cases some group in the class has claimed: these cannot leave the set. */
  claimedCaseIds: string[];
}

export async function caseSetOfClass(classId: string): Promise<CaseSetView> {
  const db = getDb();
  const [classSnapshot, claims] = await Promise.all([
    db.collection(COLLECTIONS.classes).doc(classId).get(),
    db.collection(COLLECTIONS.caseClaims).where('classId', '==', classId).get(),
  ]);
  if (!classSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  const set = classSnapshot.get('caseSetIds') as string[] | undefined;
  const explicit = Array.isArray(set);
  return {
    explicit,
    caseIds: explicit ? [...set] : (await offeredCases(classId)).map((study) => study.id),
    groupsPerCase: (classSnapshot.get('groupsPerCase') as number | undefined) ?? 1,
    claimedCaseIds: [...new Set(claims.docs.map((doc) => doc.get('caseStudyId') as string))],
  };
}

export interface CaseSetInput {
  caseSetIds: readonly string[];
  groupsPerCase: number;
}

/**
 * Saves the cases a class works from and how many groups may share one.
 *
 * Two things a save may not do, both because groups have already acted on
 * what they were offered: drop a case a group has claimed, and allow fewer
 * places on a case than groups already hold it. Releasing the claim first is
 * the lecturer's deliberate, recorded step - not a side effect of a checkbox.
 */
export async function setClassCaseSet(
  actor: SessionUser,
  classId: string,
  input: CaseSetInput,
  copiedFrom?: string,
): Promise<void> {
  const ids = [...new Set(input.caseSetIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length > MAX_CASE_SET) {
    throw new AppError('VALIDATION_FAILED', 'errors.caseSetTooLarge');
  }
  const places = input.groupsPerCase;
  if (!Number.isInteger(places) || places < 1 || places > MAX_GROUPS_PER_CASE) {
    throw new AppError('VALIDATION_FAILED', 'errors.groupsPerCaseInvalid');
  }

  const db = getDb();
  if (ids.length > 0) {
    const studies = await db.getAll(
      ...ids.map((id) => db.collection(COLLECTIONS.caseStudies).doc(id)),
    );
    if (studies.some((snapshot) => !snapshot.exists)) {
      throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    }
  }

  const classRef = db.collection(COLLECTIONS.classes).doc(classId);
  const before = await db.runTransaction(async (tx) => {
    const classSnapshot = await tx.get(classRef);
    if (!classSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

    // Read in the same transaction a claim writes in, so a group taking a case
    // while the lecturer removes it cannot slip between the two.
    const claims = await tx.get(
      db.collection(COLLECTIONS.caseClaims).where('classId', '==', classId),
    );

    const held = new Map<string, number>();
    for (const doc of claims.docs) {
      const caseId = doc.get('caseStudyId') as string;
      held.set(caseId, (held.get(caseId) ?? 0) + 1);
    }

    const dropped = [...held.keys()].filter((caseId) => !ids.includes(caseId));
    if (dropped.length > 0) {
      const codes = await caseCodes(dropped);
      throw new AppError('POLICY_VIOLATION', 'errors.caseInUse', {
        details: { cases: codes.join(', ') },
      });
    }
    if ([...held.values()].some((count) => count > places)) {
      throw new AppError('POLICY_VIOLATION', 'errors.groupsPerCaseBelowClaims');
    }

    tx.update(classRef, {
      caseSetIds: ids,
      groupsPerCase: places,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      caseSetIds: (classSnapshot.get('caseSetIds') as string[] | undefined) ?? null,
      groupsPerCase: (classSnapshot.get('groupsPerCase') as number | undefined) ?? 1,
    };
  });

  await writeAuditLog({
    action: 'class.case_set_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    before,
    after: { caseSetIds: ids, groupsPerCase: places, ...(copiedFrom ? { copiedFrom } : {}) },
  });
}

/**
 * Gives this class the cases another class worked from, and its places.
 *
 * Only from a class the lecturer may manage: which cases a colleague's class
 * used is theirs to share, and copying is reading it.
 */
export async function copyCaseSet(
  actor: SessionUser,
  classId: string,
  sourceClassId: string,
): Promise<void> {
  await assertCanManageClass(actor, sourceClassId);
  const source = await caseSetOfClass(sourceClassId);
  await setClassCaseSet(
    actor,
    classId,
    { caseSetIds: source.caseIds, groupsPerCase: source.groupsPerCase },
    sourceClassId,
  );
}

async function caseCodes(caseIds: string[]): Promise<string[]> {
  const db = getDb();
  const snapshots = await db.getAll(
    ...caseIds.map((id) => db.collection(COLLECTIONS.caseStudies).doc(id)),
  );
  return snapshots.map(
    (snapshot) => (snapshot.get('caseCode') as string | undefined) ?? snapshot.id,
  );
}
