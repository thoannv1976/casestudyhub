import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The class group project, against the real database.
 *
 * What needs a database here is the thing the design rests on: there is no
 * stored row per group, only an id that carries the class and the group. So
 * these tests prove that two groups hand work in without colliding, that a
 * forged id reaches nothing, and that the late flag comes from the project's
 * own deadline rather than from any case study.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  getClassProject,
  setProjectDeadline,
  projectTarget,
  projectTargetOf,
  submitLink,
  submitDeliverable,
  listSubmissions,
  currentVersions,
  createAssignment,
  listAssignmentsOfGroup,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, projectTargetId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'PROJ-A01';
const OTHER_CLASS_ID = 'PROJ-A02';
const GROUP_A = 'PROJ-G1';
const GROUP_B = 'PROJ-G2';
const OUTSIDE_GROUP = 'PROJ-G9';
const CASE_ID = 'PROJ-CASE1';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'proj_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const inA = { uid: 'proj_student_a', email: 'a@x.edu.vn', role: 'student' as const };
const inB = { uid: 'proj_student_b', email: 'b@x.edu.vn', role: 'student' as const };

const DAY = 24 * 60 * 60 * 1000;
const REASON = 'Final week of the course, as announced in week one.';

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

async function seedGroup(groupId: string, classId = CLASS_ID) {
  await getDb().collection(COLLECTIONS.groups).doc(groupId).set({
    id: groupId,
    groupCode: groupId,
    groupName: groupId,
    classId,
    maxMembers: 6,
    memberCount: 1,
    formationMode: 'lecturer_assignment',
    locked: false,
    status: 'forming',
  });
}

async function seed() {
  const db = getDb();
  for (const classId of [CLASS_ID, OTHER_CLASS_ID]) {
    await db
      .collection(COLLECTIONS.classes)
      .doc(classId)
      .set({
        id: classId,
        classCode: classId,
        className: 'Thuong mai dien tu',
        courseId: 'PROJ-C1',
        semesterId: 'PROJ-S1',
        lecturerIds: [lecturer.uid],
        language: 'vi',
        presentationPolicyId: policy.id,
        presentationPolicyVersion: policy.version,
        joinMode: 'code',
        caseSelection: 'lecturer_assigns',
        status: 'active',
      });
  }

  await seedGroup(GROUP_A);
  await seedGroup(GROUP_B);
  await seedGroup(OUTSIDE_GROUP, OTHER_CLASS_ID);

  await db.collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'PROJ01',
    title: 'Amazon',
    courseId: 'PROJ-C1',
    language: 'vi',
    status: 'published',
    currentVersionId: 'v1',
  });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groups).where('classId', '==', OTHER_CLASS_ID).get(),
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'PROJ-C1').get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
    ...[inA.uid, inB.uid].map((uid) =>
      db.collection(COLLECTIONS.submissions).where('submittedByUid', '==', uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  for (const classId of [CLASS_ID, OTHER_CLASS_ID]) {
    await db.collection(COLLECTIONS.classProjects).doc(classId).delete();
    await db.collection(COLLECTIONS.classes).doc(classId).delete();
  }
}

async function auditEntries(action: string) {
  const snapshot = await getDb()
    .collection(COLLECTIONS.auditLogs)
    .where('actorUid', '==', lecturer.uid)
    .get();
  return snapshot.docs.map((doc) => doc.data()).filter((entry) => entry.action === action);
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(wipe);

describe('setting the project', () => {
  it('does not exist until a lecturer sets a deadline', async () => {
    expect(await getClassProject(CLASS_ID)).toBeNull();
    // Nothing for a group to hand in against, and saying so beats a target
    // that silently accepts files nobody asked for.
    expect(await projectTarget(CLASS_ID, GROUP_A)).toBeNull();
    await expect(projectTargetOf(projectTargetId(CLASS_ID, GROUP_A))).rejects.toThrow(
      /projectNotSet/,
    );
  });

  it('freezes the framework version the class was running', async () => {
    const project = await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    expect(project).toMatchObject({ policyId: policy.id, policyVersion: policy.version });
  });

  it('asks every group for the deck, the report and the video', async () => {
    await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    const target = await projectTarget(CLASS_ID, GROUP_A);

    expect(target?.deliverables.map((item) => item.id)).toEqual([
      'project-pitch-deck',
      'project-report',
      'project-video',
    ]);
  });

  it('records who set it and why', async () => {
    await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    const entries = await auditEntries('project.scheduled');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.reason).toBe(REASON);
  });

  it('moves the deadline without restamping the framework', async () => {
    // The deadline is a scheduling decision. What a group must hand in was
    // fixed when the project was set, exactly as an assignment freezes its own.
    const first = await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    const moved = await setProjectDeadline(
      lecturer,
      CLASS_ID,
      inDays(35),
      'Moved a week to avoid the exam timetable.',
    );

    expect(moved.deadline).not.toBe(first.deadline);
    expect(moved.policyVersion).toBe(first.policyVersion);
    expect(await auditEntries('project.deadline_changed')).toHaveLength(1);
  });

  it('refuses a reason too short to mean anything later', async () => {
    await expect(setProjectDeadline(lecturer, CLASS_ID, inDays(30), 'x')).rejects.toThrow(
      /reasonTooShort/,
    );
  });

  it('refuses a date it cannot read', async () => {
    await expect(setProjectDeadline(lecturer, CLASS_ID, 'next Friday', REASON)).rejects.toThrow(
      /dateInvalid/,
    );
  });

  it('refuses the deadline it already has', async () => {
    const deadline = inDays(30);
    await setProjectDeadline(lecturer, CLASS_ID, deadline, REASON);
    await expect(setProjectDeadline(lecturer, CLASS_ID, deadline, REASON)).rejects.toThrow(
      /nothingToUpdate/,
    );
  });

  it('accepts a deadline already past, which is how late work gets marked late', async () => {
    const project = await setProjectDeadline(lecturer, CLASS_ID, inDays(-2), REASON);
    expect(Date.parse(project.deadline)).toBeLessThan(Date.now());
  });
});

describe('handing the project in', () => {
  beforeEach(async () => {
    await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
  });

  it('takes the video as a link, versioned like anything else', async () => {
    const target = projectTargetId(CLASS_ID, GROUP_A);
    await submitLink(inA, GROUP_A, {
      assignmentId: target,
      deliverableId: 'project-video',
      url: 'https://youtu.be/abc123',
    });
    const again = await submitLink(inA, GROUP_A, {
      assignmentId: target,
      deliverableId: 'project-video',
      url: 'https://youtu.be/def456',
    });

    expect(again.versionNumber).toBe(2);
    expect(again.isLate).toBe(false);
    // The host, because that is what a lecturer sees before following a link.
    expect(again.fileName).toBe('youtu.be');
    expect(await listSubmissions(target)).toHaveLength(2);
  });

  it('takes the deck as a file', async () => {
    const target = projectTargetId(CLASS_ID, GROUP_A);
    const submission = await submitDeliverable(inA, GROUP_A, {
      assignmentId: target,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4 pitch'),
    });

    expect(submission.versionNumber).toBe(1);
    expect(submission.storagePath).toContain(target);
  });

  it('keeps two groups of the same class apart', async () => {
    // The point of putting the group in the id: without it both groups would
    // be writing version numbers into the same sequence.
    await submitLink(inA, GROUP_A, {
      assignmentId: projectTargetId(CLASS_ID, GROUP_A),
      deliverableId: 'project-video',
      url: 'https://youtu.be/group-a',
    });
    const fromB = await submitLink(inB, GROUP_B, {
      assignmentId: projectTargetId(CLASS_ID, GROUP_B),
      deliverableId: 'project-video',
      url: 'https://youtu.be/group-b',
    });

    expect(fromB.versionNumber).toBe(1);
    expect(await listSubmissions(projectTargetId(CLASS_ID, GROUP_A))).toHaveLength(1);
    expect(currentVersions(await listSubmissions(projectTargetId(CLASS_ID, GROUP_B)))).toHaveLength(
      1,
    );
  });

  it('refuses a file in a format the deliverable does not take', async () => {
    await expect(
      submitDeliverable(inA, GROUP_A, {
        assignmentId: projectTargetId(CLASS_ID, GROUP_A),
        deliverableId: 'project-video',
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        body: Buffer.from('not a link'),
      }),
    ).rejects.toThrow();
  });

  it('refuses a group handing work in against another group', async () => {
    await expect(
      submitLink(inA, GROUP_A, {
        assignmentId: projectTargetId(CLASS_ID, GROUP_B),
        deliverableId: 'project-video',
        url: 'https://youtu.be/abc123',
      }),
    ).rejects.toThrow(/notYourAssignment/);
  });

  it('refuses an id that names a group from another class', async () => {
    // The id is not trusted on its own: the group has to exist and has to
    // belong to the class the id claims.
    await expect(projectTargetOf(projectTargetId(CLASS_ID, OUTSIDE_GROUP))).rejects.toThrow(
      /groupNotFound/,
    );
  });

  it('refuses an id for a group that does not exist', async () => {
    await expect(projectTargetOf(projectTargetId(CLASS_ID, 'PROJ-GHOST'))).rejects.toThrow(
      /groupNotFound/,
    );
  });
});

describe('a group given more than one case', () => {
  it('can hand work in against each of them, kept apart', async () => {
    // The student page used to show the first assignment of an unordered
    // list, so the second case had nowhere to be handed in at all.
    const db = getDb();
    await db.collection(COLLECTIONS.caseStudies).doc('PROJ-CASE2').set({
      id: 'PROJ-CASE2',
      caseCode: 'PROJ02',
      title: 'Walmart',
      courseId: 'PROJ-C1',
      language: 'vi',
      status: 'published',
      currentVersionId: 'v1',
    });

    const second = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: 'PROJ-CASE2',
      presentationDate: inDays(20),
    });
    const first = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: CASE_ID,
      presentationDate: inDays(10),
    });

    // Soonest presentation first, whatever order the documents were written
    // in - which is what the page shows them in.
    const ofGroup = await listAssignmentsOfGroup(GROUP_A);
    expect(ofGroup.map((row) => row.id)).toEqual([first, second]);

    for (const assignmentId of [first, second]) {
      await submitDeliverable(inA, GROUP_A, {
        assignmentId,
        deliverableId: 'slides-pdf',
        fileName: 'slides.pdf',
        contentType: 'application/pdf',
        body: Buffer.from('%PDF-1.4 slides'),
      });
    }

    // Two piles of work, not one: each case keeps its own version counter.
    expect(await listSubmissions(first)).toHaveLength(1);
    expect(await listSubmissions(second)).toHaveLength(1);

    await db.collection(COLLECTIONS.caseStudies).doc('PROJ-CASE2').delete();
  });
});

describe('the project deadline, and nothing else, decides late', () => {
  it('marks work handed in after the project deadline late', async () => {
    await setProjectDeadline(lecturer, CLASS_ID, inDays(-1), REASON);

    const submission = await submitLink(inA, GROUP_A, {
      assignmentId: projectTargetId(CLASS_ID, GROUP_A),
      deliverableId: 'project-video',
      url: 'https://youtu.be/late',
    });
    expect(submission.isLate).toBe(true);
  });

  it('does not borrow a case study deadline, nor lend it one', async () => {
    // The two pieces of work run to different clocks, which is the whole
    // reason the project is not modelled as another assignment.
    await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    const assignmentId = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: CASE_ID,
      presentationDate: inDays(0.5),
    });

    // The case study's window closed 24 hours before a session twelve hours
    // from now - so it shut half a day ago.
    const forCase = await submitDeliverable(inA, GROUP_A, {
      assignmentId,
      deliverableId: 'slides-pdf',
      fileName: 'slides.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4 slides'),
    });
    const forProject = await submitLink(inA, GROUP_A, {
      assignmentId: projectTargetId(CLASS_ID, GROUP_A),
      deliverableId: 'project-video',
      url: 'https://youtu.be/on-time',
    });

    expect(forCase.isLate).toBe(true);
    expect(forProject.isLate).toBe(false);
    // And they are separate piles of work, not one.
    expect(await listSubmissions(assignmentId)).toHaveLength(1);
    expect(await listSubmissions(projectTargetId(CLASS_ID, GROUP_A))).toHaveLength(1);
  });
});
