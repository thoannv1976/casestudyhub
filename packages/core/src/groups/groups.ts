import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  autoAssignRoles,
  groupMemberSchema,
  groupSchema,
  type CreateGroupsRequest,
  type Group,
  type GroupMember,
  type PresentationRoleId,
  type SetRolesRequest,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { policyOfClass } from '../policy/policy-store';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * Group formation and role allocation (SRS Module 07).
 *
 * The membership document id is `classId__studentUid`. That is not a detail:
 * it is what makes "one group per class" impossible to violate, including when
 * a student presses Join on two groups at the same moment.
 */

export function membershipId(classId: string, studentUid: string): string {
  return `${classId}__${studentUid}`;
}

function groupCodeFor(index: number): string {
  return `G${String(index).padStart(2, '0')}`;
}

export async function createGroups(
  actor: SessionUser,
  classId: string,
  input: CreateGroupsRequest,
): Promise<{ created: number }> {
  const db = getDb();

  const existing = await db.collection(COLLECTIONS.groups).where('classId', '==', classId).get();

  const startIndex = existing.size + 1;
  const batch = db.batch();

  for (let offset = 0; offset < input.count; offset += 1) {
    const index = startIndex + offset;
    const ref = db.collection(COLLECTIONS.groups).doc();
    batch.create(ref, {
      id: ref.id,
      groupCode: groupCodeFor(index),
      groupName: `Group ${index}`,
      classId,
      maxMembers: input.maxMembers,
      memberCount: 0,
      formationMode: input.formationMode,
      locked: false,
      status: 'forming',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    });
  }

  await batch.commit();

  await writeAuditLog({
    action: 'group.created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: { count: input.count, maxMembers: input.maxMembers, mode: input.formationMode },
  });

  return { created: input.count };
}

export async function listGroups(classId: string): Promise<Group[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.groups)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => groupSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.groupCode.localeCompare(b.groupCode));
}

export async function listMembers(classId: string): Promise<GroupMember[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.groupMembers)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => groupMemberSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

export async function findMembership(
  classId: string,
  studentUid: string,
): Promise<GroupMember | null> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.groupMembers)
    .doc(membershipId(classId, studentUid))
    .get();
  if (!snapshot.exists) return null;

  const parsed = groupMemberSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

export interface JoinerProfile {
  studentId: string;
  fullName: string;
}

/**
 * A student joins a group.
 *
 * Everything that could be violated by two people acting at once is read and
 * written inside one transaction: the last free seat, and the rule that a
 * student holds at most one group per class (acceptance tests 2 and 11).
 */
export async function joinGroup(
  student: SessionUser,
  classId: string,
  groupId: string,
  profile: JoinerProfile,
): Promise<void> {
  const db = getDb();
  const groupRef = db.collection(COLLECTIONS.groups).doc(groupId);
  const memberRef = db.collection(COLLECTIONS.groupMembers).doc(membershipId(classId, student.uid));

  await db.runTransaction(async (tx) => {
    const [groupSnapshot, memberSnapshot] = await Promise.all([
      tx.get(groupRef),
      tx.get(memberRef),
    ]);

    if (!groupSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.groupNotFound');
    if (groupSnapshot.get('classId') !== classId) {
      throw new AppError('FORBIDDEN', 'errors.forbidden');
    }
    if (memberSnapshot.exists) {
      throw new AppError('CONFLICT', 'errors.alreadyInGroup');
    }
    if (groupSnapshot.get('locked') === true) {
      throw new AppError('POLICY_VIOLATION', 'errors.groupLocked');
    }
    if (groupSnapshot.get('formationMode') !== 'student_self_join') {
      throw new AppError('POLICY_VIOLATION', 'errors.groupNotSelfJoin');
    }

    const memberCount = (groupSnapshot.get('memberCount') as number | undefined) ?? 0;
    const maxMembers = (groupSnapshot.get('maxMembers') as number | undefined) ?? 0;
    if (memberCount >= maxMembers) {
      throw new AppError('CONFLICT', 'errors.groupFull');
    }

    tx.create(memberRef, {
      id: memberRef.id,
      groupId,
      classId,
      studentUid: student.uid,
      studentId: profile.studentId,
      fullName: profile.fullName,
      roleIds: [],
      isLeader: memberCount === 0,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(groupRef, {
      memberCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** A lecturer places a student into a group, whatever the formation mode. */
export async function assignMember(
  actor: SessionUser,
  classId: string,
  groupId: string,
  studentUid: string,
  profile: JoinerProfile,
): Promise<void> {
  const db = getDb();
  const groupRef = db.collection(COLLECTIONS.groups).doc(groupId);
  const memberRef = db.collection(COLLECTIONS.groupMembers).doc(membershipId(classId, studentUid));

  await db.runTransaction(async (tx) => {
    const [groupSnapshot, memberSnapshot] = await Promise.all([
      tx.get(groupRef),
      tx.get(memberRef),
    ]);

    if (!groupSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.groupNotFound');
    if (memberSnapshot.exists) throw new AppError('CONFLICT', 'errors.studentAlreadyGrouped');

    const memberCount = (groupSnapshot.get('memberCount') as number | undefined) ?? 0;
    const maxMembers = (groupSnapshot.get('maxMembers') as number | undefined) ?? 0;
    if (memberCount >= maxMembers) throw new AppError('CONFLICT', 'errors.groupFull');

    tx.create(memberRef, {
      id: memberRef.id,
      groupId,
      classId,
      studentUid,
      studentId: profile.studentId,
      fullName: profile.fullName,
      roleIds: [],
      isLeader: memberCount === 0,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      addedByUid: actor.uid,
    });
    tx.update(groupRef, {
      memberCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function removeMember(
  actor: SessionUser,
  classId: string,
  studentUid: string,
): Promise<void> {
  const db = getDb();
  const memberRef = db.collection(COLLECTIONS.groupMembers).doc(membershipId(classId, studentUid));

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(memberRef);
    if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.notInGroup');

    const groupId = snapshot.get('groupId') as string;
    tx.delete(memberRef);
    tx.update(db.collection(COLLECTIONS.groups).doc(groupId), {
      memberCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog({
    action: 'group.member_moved',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.groupMembers}/${membershipId(classId, studentUid)}`,
    classId,
  });
}

/**
 * Random grouping (SRS 7.1). Every ungrouped student is placed and no group
 * goes over its limit - the two ways this goes wrong in practice.
 */
export async function distributeRandomly(
  actor: SessionUser,
  classId: string,
  candidates: readonly { studentUid: string; studentId: string; fullName: string }[],
): Promise<{ placed: number; unplaced: number }> {
  const db = getDb();
  const groups = (await listGroups(classId)).filter((group) => !group.locked);
  if (groups.length === 0) throw new AppError('POLICY_VIOLATION', 'errors.noGroupsYet');

  const existing = await listMembers(classId);
  const alreadyGrouped = new Set(existing.map((member) => member.studentUid));
  const pool = candidates.filter((candidate) => !alreadyGrouped.has(candidate.studentUid));

  // Fisher-Yates: a sort with a random comparator is not a uniform shuffle.
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const a = shuffled[index];
    const b = shuffled[swap];
    if (a && b) {
      shuffled[index] = b;
      shuffled[swap] = a;
    }
  }

  const seats = groups.map((group) => ({
    group,
    free: group.maxMembers - group.memberCount,
    added: 0,
  }));

  let placed = 0;
  const batch = db.batch();

  for (const candidate of shuffled) {
    // Always fill the emptiest group first, so sizes stay even.
    seats.sort((a, b) => b.free - a.free);
    const target = seats[0];
    if (!target || target.free <= 0) break;

    const memberRef = db
      .collection(COLLECTIONS.groupMembers)
      .doc(membershipId(classId, candidate.studentUid));
    batch.create(memberRef, {
      id: memberRef.id,
      groupId: target.group.id,
      classId,
      studentUid: candidate.studentUid,
      studentId: candidate.studentId,
      fullName: candidate.fullName,
      roleIds: [],
      isLeader: target.group.memberCount + target.added === 0,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      addedByUid: actor.uid,
    });

    target.free -= 1;
    target.added += 1;
    placed += 1;
  }

  for (const seat of seats) {
    if (seat.added > 0) {
      batch.update(db.collection(COLLECTIONS.groups).doc(seat.group.id), {
        memberCount: FieldValue.increment(seat.added),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await batch.commit();

  await writeAuditLog({
    action: 'group.random_distribution',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: { placed, unplaced: pool.length - placed },
  });

  return { placed, unplaced: pool.length - placed };
}

/**
 * Renames a group (SRS 7.2). Lecturers name groups after the case, the topic
 * or the team, and "Group 3" stops being useful the moment there are twenty.
 *
 * `groupCode` is left alone: that is what the group is, and what every
 * assignment, claim and mark was recorded against. The name is what people
 * read.
 *
 * The clash check is a courtesy, not a structural constraint - two lecturers
 * renaming two groups to the same thing in the same instant would both pass.
 * Unlike a membership or a claim, two groups sharing a display name breaks
 * nothing, it only reads badly, so it is not worth a transaction.
 */
export async function renameGroup(
  actor: SessionUser,
  classId: string,
  groupId: string,
  newName: string,
): Promise<string> {
  const groupName = newName.trim();
  if (groupName.length === 0 || groupName.length > 120) {
    throw new AppError('VALIDATION_FAILED', 'errors.groupNameInvalid');
  }

  const db = getDb();
  const ref = db.collection(COLLECTIONS.groups).doc(groupId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.get('classId') !== classId) {
    throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  }

  const before = (snapshot.get('groupName') as string | undefined) ?? '';
  if (before === groupName) throw new AppError('VALIDATION_FAILED', 'errors.nothingToUpdate');

  const siblings = await db.collection(COLLECTIONS.groups).where('classId', '==', classId).get();
  const taken = siblings.docs.some(
    (doc) =>
      doc.id !== groupId &&
      ((doc.get('groupName') as string | undefined) ?? '').trim().toLowerCase() ===
        groupName.toLowerCase(),
  );
  if (taken) throw new AppError('CONFLICT', 'errors.groupNameTaken');

  await ref.update({ groupName, updatedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'group.renamed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.groups}/${groupId}`,
    classId,
    before: { groupName: before },
    after: { groupName },
  });

  return groupName;
}

export async function setGroupLocked(
  actor: SessionUser,
  classId: string,
  groupId: string,
  locked: boolean,
): Promise<void> {
  const ref = getDb().collection(COLLECTIONS.groups).doc(groupId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.get('classId') !== classId) {
    throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  }

  await ref.update({
    locked,
    status: locked ? 'active' : 'forming',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'group.locked',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.groups}/${groupId}`,
    classId,
    after: { locked },
  });
}

/**
 * Auto Assign Roles (SRS 6.3). The allocation itself comes from the policy
 * engine, so the rule that R3 and R4 are never dropped lives in one place and
 * is covered by its own tests.
 */
export async function autoAssignGroupRoles(
  actor: SessionUser,
  classId: string,
  groupId: string,
): Promise<{ assigned: number }> {
  const db = getDb();
  const members = (await listMembers(classId)).filter((member) => member.groupId === groupId);
  if (members.length === 0) throw new AppError('POLICY_VIOLATION', 'errors.groupEmpty');

  const assignments = autoAssignRoles(
    members.map((member) => member.studentUid),
    await policyOfClass(classId),
  );

  const rolesByStudent = new Map<string, PresentationRoleId[]>();
  for (const assignment of assignments) {
    const current = rolesByStudent.get(assignment.memberId) ?? [];
    current.push(assignment.roleId);
    rolesByStudent.set(assignment.memberId, current);
  }

  const batch = db.batch();
  for (const member of members) {
    batch.update(db.collection(COLLECTIONS.groupMembers).doc(member.id), {
      roleIds: rolesByStudent.get(member.studentUid) ?? [],
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  await writeAuditLog({
    action: 'group.roles_assigned',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.groups}/${groupId}`,
    classId,
    after: { members: members.length },
  });

  return { assigned: members.length };
}

/** A manual override of the automatic allocation. */
export async function setGroupRoles(
  actor: SessionUser,
  classId: string,
  groupId: string,
  input: SetRolesRequest,
): Promise<void> {
  const db = getDb();
  const members = (await listMembers(classId)).filter((member) => member.groupId === groupId);
  const byUid = new Map(members.map((member) => [member.studentUid, member]));

  const batch = db.batch();
  for (const assignment of input.assignments) {
    const member = byUid.get(assignment.studentUid);
    if (!member) throw new AppError('NOT_FOUND', 'errors.notInGroup');
    batch.update(db.collection(COLLECTIONS.groupMembers).doc(member.id), {
      roleIds: assignment.roleIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  await writeAuditLog({
    action: 'group.roles_assigned',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.groups}/${groupId}`,
    classId,
    after: { manual: true, changed: input.assignments.length },
  });
}
