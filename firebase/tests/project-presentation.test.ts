import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Presenting the class group project, against the real database.
 *
 * Three rules here cannot be checked any other way. Two groups pressing
 * "volunteer" on the last place at the same instant must leave one presenting.
 * One student pressing send twice must leave one question. And a project's
 * questions must not leak into a case study's bank, which is the thing that
 * would quietly hand next year's cohort somebody else's project.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  setProjectDeadline,
  setProjectPresentationSlots,
  volunteerToPresent,
  withdrawVolunteer,
  listProjectVolunteers,
  volunteering,
  startSession,
  askQuestion,
  listSessionQuestions,
  listCaseQuestions,
  sessionAskers,
  clusterSessionQuestions,
  getQuestionClusters,
  answerSessionQuestions,
  submitDeliverable,
  setAiProvider,
  classMayViewSubmission,
  dashboardFor,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, projectTargetId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'PPR-A01';
const CASE_ID = 'PPR-CASE1';
const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'ppr_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const REASON = 'Final week of the course, as announced in week one.';

const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

/** Three groups of one student each: enough to fill two places and miss one. */
const GROUPS = [1, 2, 3].map((index) => ({
  id: `PPR-G${index}`,
  name: `Nhom ${index}`,
  student: { uid: `ppr_student_${index}`, email: `sv${index}@x.edu.vn`, role: 'student' as const },
  profile: { studentId: `SV00${index}`, fullName: `Sinh vien ${index}` },
}));

function targetOf(groupId: string): string {
  return projectTargetId(CLASS_ID, groupId);
}

/** Answers the clustering prompt with one theme per question it was given. */
function fakeProvider(recorded: { prompt: string }[] = []) {
  return {
    name: 'fake',
    model: 'fake-model-1',
    async generate<T>(request: {
      prompt: string;
      schema: { parse: (value: unknown) => T };
    }): Promise<{
      value: T;
      model: string;
      promptTokens: number;
      outputTokens: number;
      latencyMs: number;
    }> {
      recorded.push({ prompt: request.prompt });
      const ids = [...request.prompt.matchAll(/^(\S+__\S+) \[/gm)].map((match) => match[1]);

      const value = request.prompt.includes('Group these questions')
        ? { clusters: [{ title: 'Unit economics', questionIds: ids }] }
        : {
            answers: ids.map((questionId) => ({
              questionId,
              answer: 'The deck covers this on slide nine, with the revenue model.',
              groundedInCase: true,
            })),
          };

      return {
        value: request.schema.parse(value),
        model: 'fake-model-1',
        promptTokens: 50,
        outputTokens: 20,
        latencyMs: 1,
      };
    },
  };
}

async function seed() {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'PPR01',
      className: 'Thuong mai dien tu',
      courseId: 'PPR-C1',
      semesterId: 'PPR-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      caseSelection: 'lecturer_assigns',
      status: 'active',
    });

  for (const group of GROUPS) {
    await db.collection(COLLECTIONS.groups).doc(group.id).set({
      id: group.id,
      groupCode: group.id,
      groupName: group.name,
      classId: CLASS_ID,
      maxMembers: 6,
      memberCount: 1,
      formationMode: 'lecturer_assignment',
      locked: false,
      status: 'forming',
    });
    await db
      .collection(COLLECTIONS.classEnrollments)
      .doc(`${CLASS_ID}__${group.student.uid}`)
      .set({
        id: `${CLASS_ID}__${group.student.uid}`,
        classId: CLASS_ID,
        studentUid: group.student.uid,
        studentId: group.profile.studentId,
        fullName: group.profile.fullName,
        email: group.student.email,
        status: 'active',
        joinedVia: 'class_code',
      });
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${group.student.uid}`)
      .set({
        id: `${CLASS_ID}__${group.student.uid}`,
        classId: CLASS_ID,
        groupId: group.id,
        studentUid: group.student.uid,
        studentId: group.profile.studentId,
        fullName: group.profile.fullName,
        roleIds: [],
        isLeader: true,
      });
  }

  await setProjectDeadline(
    lecturer,
    CLASS_ID,
    new Date(Date.now() + 30 * 86400000).toISOString(),
    REASON,
  );
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.classEnrollments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.projectVolunteers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.presentationSessions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questionClusters).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'PPR-C1').get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
    db.collection(COLLECTIONS.aiUsage).get(),
    ...GROUPS.map((group) =>
      db.collection(COLLECTIONS.submissions).where('groupId', '==', group.id).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classProjects).doc(CLASS_ID).delete();
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
  setAiProvider(null);
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

describe('putting a hand up', () => {
  it('is refused until the lecturer opens the floor', async () => {
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');

    expect((await volunteering(CLASS_ID)).closedBecause).toBe('notOpened');
    await expect(volunteerToPresent(group.student, CLASS_ID, group.id)).rejects.toThrow(
      /volunteeringNotOpen/,
    );
  });

  it('gives the last place to exactly one of two groups pressing at once', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 1);
    const [first, second] = GROUPS;
    if (!first || !second) throw new Error('seed is wrong');

    const results = await Promise.allSettled([
      volunteerToPresent(first.student, CLASS_ID, first.id),
      volunteerToPresent(second.student, CLASS_ID, second.id),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await listProjectVolunteers(CLASS_ID)).toHaveLength(1);
  });

  it('numbers the volunteers in the order they arrived', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const [first, second] = GROUPS;
    if (!first || !second) throw new Error('seed is wrong');

    await volunteerToPresent(first.student, CLASS_ID, first.id);
    await volunteerToPresent(second.student, CLASS_ID, second.id);

    expect((await listProjectVolunteers(CLASS_ID)).map((row) => row.slot)).toEqual([1, 2]);
  });

  it('refuses the same group twice', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');

    await volunteerToPresent(group.student, CLASS_ID, group.id);
    await expect(volunteerToPresent(group.student, CLASS_ID, group.id)).rejects.toThrow(
      /alreadyVolunteered/,
    );
  });

  it('turns a third group away once the places are gone', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const [first, second, third] = GROUPS;
    if (!first || !second || !third) throw new Error('seed is wrong');

    await volunteerToPresent(first.student, CLASS_ID, first.id);
    await volunteerToPresent(second.student, CLASS_ID, second.id);

    await expect(volunteerToPresent(third.student, CLASS_ID, third.id)).rejects.toThrow(
      /presentationSlotsFull/,
    );
    expect((await volunteering(CLASS_ID)).closedBecause).toBe('full');
  });

  it('will not let the lecturer cut the places below the groups already in', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const [first, second] = GROUPS;
    if (!first || !second) throw new Error('seed is wrong');
    await volunteerToPresent(first.student, CLASS_ID, first.id);
    await volunteerToPresent(second.student, CLASS_ID, second.id);

    await expect(setProjectPresentationSlots(lecturer, CLASS_ID, 1)).rejects.toThrow(
      /slotsBelowVolunteers/,
    );
  });

  it('lets a group be withdrawn before the room opens, and not after', async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');
    await volunteerToPresent(group.student, CLASS_ID, group.id);

    await withdrawVolunteer(lecturer, CLASS_ID, group.id);
    expect(await listProjectVolunteers(CLASS_ID)).toHaveLength(0);

    await volunteerToPresent(group.student, CLASS_ID, group.id);
    await startSession(lecturer, targetOf(group.id));
    // By now the class has asked it questions; the volunteer row cannot vanish
    // from under them.
    await expect(withdrawVolunteer(lecturer, CLASS_ID, group.id)).rejects.toThrow(
      /presentationAlreadyRunning/,
    );
  });
});

describe('the room, opened for a project', () => {
  beforeEach(async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');
    await volunteerToPresent(group.student, CLASS_ID, group.id);
  });

  it('knows it is presenting a project and not a case', async () => {
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');

    const session = await startSession(lecturer, targetOf(group.id));
    expect(session.kind).toBe('group_project');
    expect(session.caseStudyId).toBeUndefined();
    expect(session.questionsOpen).toBe(true);
  });

  it('opens the pitch deck to the class, and nothing else', async () => {
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');
    const target = targetOf(group.id);

    await submitDeliverable(group.student, group.id, {
      assignmentId: target,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });
    await submitDeliverable(group.student, group.id, {
      assignmentId: target,
      deliverableId: 'project-report',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });
    await startSession(lecturer, target);

    expect(
      (await classMayViewSubmission({ assignmentId: target, deliverableId: 'project-pitch-deck' }))
        .allowed,
    ).toBe(true);
    // The report stays the group's own, as the analysis report does for a case.
    expect(
      (await classMayViewSubmission({ assignmentId: target, deliverableId: 'project-report' }))
        .allowed,
    ).toBe(false);
  });

  /**
   * The dashboard reads every live session in the class to say what is running
   * now. It took the case study id of each one and asked Firestore for that
   * document; a project session has no case, so it asked for a document called
   * `undefined` and threw - and the dashboard is the first page everybody in
   * the class opens.
   */
  it('leaves the dashboard readable while a project room is open', async () => {
    const group = GROUPS[0];
    const audience = GROUPS[1];
    if (!group || !audience) throw new Error('seed is wrong');

    const session = await startSession(lecturer, targetOf(group.id));

    for (const viewer of [lecturer, audience.student, group.student]) {
      const board = await dashboardFor(viewer);
      const live = board.live.find((row) => row.sessionId === session.id);
      expect(live).toBeDefined();
      // Named as what it is, rather than by a case title it does not have.
      expect(live?.kind).toBe('group_project');
      expect(live?.caseTitle).toBe('');
    }
  });
});

describe('one question each', () => {
  let sessionId = '';

  beforeEach(async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const presenting = GROUPS[0];
    if (!presenting) throw new Error('seed is wrong');
    await volunteerToPresent(presenting.student, CLASS_ID, presenting.id);
    sessionId = (await startSession(lecturer, targetOf(presenting.id))).id;
  });

  async function ask(index: number, text: string) {
    const group = GROUPS[index];
    if (!group) throw new Error('seed is wrong');
    return askQuestion(group.student, sessionId, group.profile, {
      category: 'clarification',
      text,
    });
  }

  it('keeps one question per student however many times they send', async () => {
    await ask(1, 'How did you arrive at the conversion rate of three percent?');
    const second = await ask(1, 'How did you arrive at the conversion rate, really?');

    const questions = await listSessionQuestions(sessionId);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe(second.text);
  });

  it('refuses the presenting group asking itself', async () => {
    await expect(ask(0, 'Is our own deck any good, do you think?')).rejects.toThrow(
      /cannotQuestionOwnGroup/,
    );
  });

  it('does not let a project question into a case study bank', async () => {
    // The bank is what a later cohort inherits. A project belongs to one group
    // in one class and has nothing to hand on.
    await getDb().collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
      id: CASE_ID,
      caseCode: 'PPR01',
      title: 'Amazon',
      courseId: 'PPR-C1',
      language: 'vi',
      status: 'published',
      currentVersionId: 'v1',
    });

    await ask(1, 'What happens to margin if the supplier raises prices?');

    const questions = await listSessionQuestions(sessionId);
    expect(questions[0]?.kind).toBe('group_project');
    expect(questions[0]?.caseStudyId).toBeUndefined();
    expect(await listCaseQuestions(CASE_ID)).toEqual([]);
  });

  it('names who still owes a question, leaving the presenters out', async () => {
    const before = await sessionAskers(sessionId);
    // Three students, one of them presenting: two are expected to ask.
    expect(before).toMatchObject({ expected: 2, asked: 0, missing: 2 });

    await ask(1, 'How did you size the market you are serving?');

    const after = await sessionAskers(sessionId);
    expect(after).toMatchObject({ expected: 2, asked: 1, missing: 1 });
    expect(after.rows.filter((row) => !row.asked).map((row) => row.studentId)).toEqual(['SV003']);
  });
});

describe('what the model does with a wall of questions', () => {
  let sessionId = '';
  let target = '';

  beforeEach(async () => {
    await setProjectPresentationSlots(lecturer, CLASS_ID, 2);
    const presenting = GROUPS[0];
    if (!presenting) throw new Error('seed is wrong');
    await volunteerToPresent(presenting.student, CLASS_ID, presenting.id);
    target = targetOf(presenting.id);
    sessionId = (await startSession(lecturer, target)).id;

    for (const index of [1, 2]) {
      const group = GROUPS[index];
      if (!group) throw new Error('seed is wrong');
      await askQuestion(group.student, sessionId, group.profile, {
        category: 'evidence',
        text: `Question number ${index} about the unit economics of this venture.`,
      });
    }
  });

  it('refuses to group a wall too small to have themes', async () => {
    setAiProvider(fakeProvider());
    await expect(clusterSessionQuestions(lecturer, sessionId)).rejects.toThrow(
      /tooFewQuestionsToCluster/,
    );
  });

  it('groups the questions and keeps the grouping beside them', async () => {
    const group = GROUPS[1];
    if (!group) throw new Error('seed is wrong');
    // A third question, so there is something worth grouping.
    await getDb()
      .collection(COLLECTIONS.questions)
      .doc(`${sessionId}__extra`)
      .set({
        id: `${sessionId}__extra`,
        kind: 'group_project',
        sessionId,
        classId: CLASS_ID,
        groupId: GROUPS[0]?.id,
        askedByUid: 'ppr_extra',
        askedByName: 'Sinh vien 4',
        askedByStudentId: 'SV004',
        anonymousToClass: true,
        roleId: null,
        category: 'critical',
        text: 'What is the weakest assumption in the financial model?',
        upvotes: 0,
        status: 'submitted',
        answeredByAi: false,
      });

    setAiProvider(fakeProvider());
    const set = await clusterSessionQuestions(lecturer, sessionId);

    expect(set.clusters).toHaveLength(1);
    expect(set.clusters[0]?.questionIds).toHaveLength(3);
    expect(set.unclustered).toEqual([]);

    // Stored beside the questions, never inside them: no status changed.
    expect((await getQuestionClusters(sessionId))?.model).toBe('fake-model-1');
    const questions = await listSessionQuestions(sessionId);
    expect(questions.every((question) => question.status === 'submitted')).toBe(true);
  });

  it('answers the questions from the group’s own documents', async () => {
    const presenting = GROUPS[0];
    if (!presenting) throw new Error('seed is wrong');
    await submitDeliverable(presenting.student, presenting.id, {
      assignmentId: target,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });

    setAiProvider(fakeProvider());
    const result = await answerSessionQuestions(lecturer, sessionId);

    expect(result.answered).toBe(2);
    const questions = await listSessionQuestions(sessionId);
    for (const question of questions) {
      expect(question.answeredByAi).toBe(true);
      // Not 'answered': that status means a student answered it in the room.
      expect(question.status).toBe('closed');
    }
  });

  it('refuses to answer when the group handed nothing in to answer from', async () => {
    setAiProvider(fakeProvider());
    await expect(answerSessionQuestions(lecturer, sessionId)).rejects.toThrow(/nothingToEvaluate/);
  });
});
