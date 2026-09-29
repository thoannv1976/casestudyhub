import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Changing who is in which group, against the real database.
 *
 * Three rules here cannot be checked any other way. A move must never leave a
 * student in no group at all, even when the destination fills up in the same
 * instant. A group must never end up holding more members than its own limit.
 * And a group whose leader walks out must still have a leader.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  createGroups,
  listGroups,
  listMembers,
  joinGroup,
  assignMember,
  leaveGroup,
  moveMember,
  setGroupMaxMembers,
  autoAssignGroupRoles,
} = await import('@casestudyhub/core');
const { COLLECTIONS } = await import('@casestudyhub/shared');

const CLASS_ID = 'GRP-A01';
const lecturer = { uid: 'grp_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };

/** Nine students, which is exactly the largest group the allocation can seat. */
const STUDENTS = Array.from({ length: 9 }, (_, index) => ({
  user: { uid: `grp_s${index + 1}`, email: `sv${index + 1}@x.edu.vn`, role: 'student' as const },
  profile: { studentId: `SV00${index + 1}`, fullName: `Sinh vien ${index + 1}` },
}));

async function wipe() {
  const db = getDb();
  for (const collection of [
    COLLECTIONS.groups,
    COLLECTIONS.groupMembers,
    COLLECTIONS.assignments,
    COLLECTIONS.classes,
    COLLECTIONS.caseStudies,
    COLLECTIONS.auditLogs,
  ]) {
    const snapshot = await db.collection(collection).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
}

/** Two groups of four, students self-joining, which is the common setup. */
async function twoGroups(maxMembers = 4) {
  await createGroups(lecturer, CLASS_ID, {
    count: 2,
    maxMembers,
    formationMode: 'student_self_join',
  });
  const groups = (await listGroups(CLASS_ID)).sort((a, b) =>
    a.groupCode.localeCompare(b.groupCode),
  );
  return { first: groups[0]!, second: groups[1]! };
}

async function membersOf(groupId: string) {
  return (await listMembers(CLASS_ID)).filter((member) => member.groupId === groupId);
}

/** The class itself is put back after every wipe: role assignment reads it. */
async function seedClass() {
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({ id: CLASS_ID, classId: CLASS_ID, lecturerIds: [lecturer.uid], status: 'active' });
}

beforeAll(seedClass);

beforeEach(async () => {
  await wipe();
  await seedClass();
});
afterAll(wipe);

describe('how many a group holds', () => {
  it('lets the lecturer raise the limit and seat more people', async () => {
    const { first } = await twoGroups(4);
    for (const student of STUDENTS.slice(0, 4)) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }

    // Full at four.
    const fifth = STUDENTS[4]!;
    await expect(joinGroup(fifth.user, CLASS_ID, first.id, fifth.profile)).rejects.toThrow(
      /groupFull/,
    );

    await setGroupMaxMembers(lecturer, CLASS_ID, first.id, 8);
    await joinGroup(fifth.user, CLASS_ID, first.id, fifth.profile);

    expect(await membersOf(first.id)).toHaveLength(5);
  });

  it('refuses a limit below the people already in the group', async () => {
    const { first } = await twoGroups(6);
    for (const student of STUDENTS.slice(0, 4)) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }

    await expect(setGroupMaxMembers(lecturer, CLASS_ID, first.id, 3)).rejects.toThrow(
      /maxMembersBelowMembers/,
    );
    // Exactly the current size is allowed: it closes the group without a lie.
    await expect(setGroupMaxMembers(lecturer, CLASS_ID, first.id, 4)).resolves.toBe(4);
  });

  it('stays inside the range the create form offers', async () => {
    const { first } = await twoGroups();
    await expect(setGroupMaxMembers(lecturer, CLASS_ID, first.id, 1)).rejects.toThrow(
      /maxMembersInvalid/,
    );
    await expect(setGroupMaxMembers(lecturer, CLASS_ID, first.id, 13)).rejects.toThrow(
      /maxMembersInvalid/,
    );
  });

  it('never seats more than the limit, however many press join at once', async () => {
    const { first } = await twoGroups(2);
    const racers = STUDENTS.slice(0, 5);

    const results = await Promise.allSettled(
      racers.map((student) => joinGroup(student.user, CLASS_ID, first.id, student.profile)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(await membersOf(first.id)).toHaveLength(2);
  });

  it('does not let a group belonging to another class be resized', async () => {
    const { first } = await twoGroups();
    await expect(setGroupMaxMembers(lecturer, 'GRP-OTHER', first.id, 8)).rejects.toThrow(
      /groupNotFound/,
    );
  });
});

describe('a student leaving a group', () => {
  it('frees the seat, and they can join another group', async () => {
    const { first, second } = await twoGroups(2);
    const student = STUDENTS[0]!;

    await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    await leaveGroup(student.user, CLASS_ID);

    expect(await membersOf(first.id)).toHaveLength(0);

    await joinGroup(student.user, CLASS_ID, second.id, student.profile);
    expect(await membersOf(second.id)).toHaveLength(1);
  });

  it('hands leadership to whoever joined earliest', async () => {
    const { first } = await twoGroups(4);
    const [leader, second, third] = [STUDENTS[0]!, STUDENTS[1]!, STUDENTS[2]!];

    // Joined in order, so the first one is the leader.
    await joinGroup(leader.user, CLASS_ID, first.id, leader.profile);
    await joinGroup(second.user, CLASS_ID, first.id, second.profile);
    await joinGroup(third.user, CLASS_ID, first.id, third.profile);
    expect((await membersOf(first.id)).find((m) => m.isLeader)?.studentUid).toBe(leader.user.uid);

    await leaveGroup(leader.user, CLASS_ID);

    const leaders = (await membersOf(first.id)).filter((member) => member.isLeader);
    expect(leaders).toHaveLength(1);
    expect(leaders[0]?.studentUid).toBe(second.user.uid);
  });

  it('is refused once the group has work set', async () => {
    const { first } = await twoGroups(4);
    const student = STUDENTS[0]!;
    await joinGroup(student.user, CLASS_ID, first.id, student.profile);

    // Written straight in: what `leaveGroup` looks for is an assignment for
    // this group, and building a publishable case to get one would test the
    // case library rather than this rule.
    await getDb().collection(COLLECTIONS.assignments).doc('GRP-ASSIGN-1').set({
      id: 'GRP-ASSIGN-1',
      classId: CLASS_ID,
      groupId: first.id,
      caseStudyId: 'GRP-CASE-1',
      status: 'submission_open',
    });

    await expect(leaveGroup(student.user, CLASS_ID)).rejects.toThrow(/leaveAfterAssignment/);
    expect(await membersOf(first.id)).toHaveLength(1);
  });

  it('is refused while the group is locked', async () => {
    const { first } = await twoGroups(4);
    const student = STUDENTS[0]!;
    await joinGroup(student.user, CLASS_ID, first.id, student.profile);

    await getDb().collection(COLLECTIONS.groups).doc(first.id).update({ locked: true });
    await expect(leaveGroup(student.user, CLASS_ID)).rejects.toThrow(/groupLocked/);
  });

  it('says so plainly when there was no group to leave', async () => {
    await twoGroups();
    await expect(leaveGroup(STUDENTS[0]!.user, CLASS_ID)).rejects.toThrow(/notInGroup/);
  });
});

describe('a lecturer moving somebody', () => {
  it('moves them in one step, and the counts on both sides follow', async () => {
    const { first, second } = await twoGroups(4);
    const student = STUDENTS[0]!;
    await joinGroup(student.user, CLASS_ID, first.id, student.profile);

    await moveMember(lecturer, CLASS_ID, student.user.uid, second.id);

    expect(await membersOf(first.id)).toHaveLength(0);
    expect(await membersOf(second.id)).toHaveLength(1);

    const groups = await listGroups(CLASS_ID);
    expect(groups.find((group) => group.id === first.id)?.memberCount).toBe(0);
    expect(groups.find((group) => group.id === second.id)?.memberCount).toBe(1);
  });

  it('leaves them where they were when the destination is full', async () => {
    const { first, second } = await twoGroups(2);
    await joinGroup(STUDENTS[0]!.user, CLASS_ID, first.id, STUDENTS[0]!.profile);
    for (const student of [STUDENTS[1]!, STUDENTS[2]!]) {
      await joinGroup(student.user, CLASS_ID, second.id, student.profile);
    }

    await expect(moveMember(lecturer, CLASS_ID, STUDENTS[0]!.user.uid, second.id)).rejects.toThrow(
      /groupFull/,
    );

    // The point of doing it in one transaction: a refused move is not a
    // student left in no group at all.
    expect(await membersOf(first.id)).toHaveLength(1);
    expect(await membersOf(second.id)).toHaveLength(2);
  });

  it('drops the roles, which belonged to a presentation they left', async () => {
    const { first, second } = await twoGroups(6);
    for (const student of STUDENTS.slice(0, 4)) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }
    await autoAssignGroupRoles(lecturer, CLASS_ID, first.id);

    const moved = STUDENTS[0]!;
    expect(
      (await membersOf(first.id)).find((m) => m.studentUid === moved.user.uid)?.roleIds.length,
    ).toBeGreaterThan(0);

    await moveMember(lecturer, CLASS_ID, moved.user.uid, second.id);

    expect(
      (await membersOf(second.id)).find((m) => m.studentUid === moved.user.uid)?.roleIds,
    ).toEqual([]);
  });

  it('hands leadership over in the group they left', async () => {
    const { first, second } = await twoGroups(4);
    for (const student of [STUDENTS[0]!, STUDENTS[1]!]) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }

    await moveMember(lecturer, CLASS_ID, STUDENTS[0]!.user.uid, second.id);

    expect((await membersOf(first.id)).filter((member) => member.isLeader)).toHaveLength(1);
    // And they lead the group they arrived in, because it was empty.
    expect((await membersOf(second.id))[0]?.isLeader).toBe(true);
  });

  it('gives exactly one of two racing moves the last free seat', async () => {
    const { first, second } = await twoGroups(4);
    // Two students in the first group, one free seat in the second.
    for (const student of [STUDENTS[0]!, STUDENTS[1]!]) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }
    for (const student of [STUDENTS[2]!, STUDENTS[3]!, STUDENTS[4]!]) {
      await assignMember(lecturer, CLASS_ID, second.id, student.user.uid, student.profile);
    }

    const results = await Promise.allSettled([
      moveMember(lecturer, CLASS_ID, STUDENTS[0]!.user.uid, second.id),
      moveMember(lecturer, CLASS_ID, STUDENTS[1]!.user.uid, second.id),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await membersOf(second.id)).toHaveLength(4);
    expect(await membersOf(first.id)).toHaveLength(1);
  });
});

describe('roles for a group larger than six', () => {
  it('seats nine, which used to be refused outright', async () => {
    const { first } = await twoGroups(9);
    for (const student of STUDENTS) {
      await joinGroup(student.user, CLASS_ID, first.id, student.profile);
    }

    const { assigned } = await autoAssignGroupRoles(lecturer, CLASS_ID, first.id);
    expect(assigned).toBe(9);

    const members = await membersOf(first.id);
    expect(members.every((member) => member.roleIds.length > 0)).toBe(true);

    // The six roles are all covered, and only the sharable ones doubled up.
    const owners = new Map<string, number>();
    for (const member of members) {
      for (const roleId of member.roleIds) owners.set(roleId, (owners.get(roleId) ?? 0) + 1);
    }
    expect([...owners.keys()].sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
    expect(owners.get('R3')).toBe(1);
    expect(owners.get('R4')).toBe(1);
  });
});
