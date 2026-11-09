import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The Moodle connection (UniGame Hub, LTI 1.3), against the real Auth and
 * Firestore emulators.
 *
 * The ticket itself is the Hub's to sign and the SDK's to verify; these tests
 * start from a verified launch and check what this platform does with it:
 * who the person becomes here, that a Moodle role never mints a lecturer,
 * which class a course is, and which number reaches the gradebook.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';
process.env.LTI_ENABLED = 'true';
process.env.LTI_HUB_URL = 'https://hub.example.test';
process.env.LTI_TENANTS = 'aiedu2026';

const {
  getDb,
  getAdminAuth,
  handleLtiLaunch,
  getLtiPendingLink,
  linkLtiCourse,
  ltiContextKey,
  sendLtiGradesForAssignment,
  sendLtiClassGrades,
  ltiLinksOfClass,
} = await import('@casestudyhub/core');
const { COLLECTIONS } = await import('@casestudyhub/shared');

const CLASS_ID = 'LTI-CLASS-1';
const LECTURER_EMAIL = 'lti.lecturer@example.edu.vn';
const ISSUER = 'https://moodle.example.test';
const COURSE = { id: 'moodle-course-7', title: 'Thương mại điện tử', label: 'ECOM' };
const contextKey = ltiContextKey({ tenantId: 'aiedu2026', issuer: ISSUER, contextId: COURSE.id });

let lecturerUid = '';
const createdEmails = new Set<string>();

function launch(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: 't',
    hubUserId: 'hub-student-1',
    tenantId: 'aiedu2026',
    gameId: 'casestudyhub',
    platform: { issuer: ISSUER, deploymentId: 'd1' },
    ltiSub: 'sub-1',
    name: 'Nguyễn Văn An',
    email: 'an.nguyen@example.edu.vn',
    username: 'sv2026001',
    role: 'learner' as const,
    context: COURSE,
    resourceLink: { id: 'res-case', title: 'Điểm case study' },
    activity: 'case_study',
    gradeTarget: 'grade-target-an',
    linkTarget: 'link-target-case',
    launchId: 'l1',
    ...overrides,
  };
}

const lecturerLaunch = (overrides: Record<string, unknown> = {}) =>
  launch({
    hubUserId: 'hub-lecturer-1',
    ltiSub: 'sub-lec',
    name: 'TS. Trần Thị Bình',
    email: LECTURER_EMAIL,
    username: 'binh.tran',
    role: 'instructor',
    gradeTarget: undefined,
    ...overrides,
  });

function fakeHub() {
  const results: Record<string, unknown>[] = [];
  const batches: Record<string, unknown>[] = [];
  return {
    results,
    batches,
    client: {
      submitResult: async (result: Record<string, unknown>) => {
        results.push(result);
        return { status: 'accepted' as const, jobId: 'j', deduplicated: false };
      },
      submitBulkResult: async (batch: Record<string, unknown>) => {
        batches.push(batch);
        return { status: 'accepted' as const, matched: 1, unmatched: [], jobId: 'j' };
      },
    },
  };
}

async function deleteWhere(collection: string, field: string, value: string) {
  const snapshot = await getDb().collection(collection).where(field, '==', value).get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
}

async function wipe() {
  const db = getDb();
  for (const name of [
    COLLECTIONS.ltiUsers,
    COLLECTIONS.ltiContexts,
    COLLECTIONS.ltiPending,
    COLLECTIONS.ltiActivities,
    COLLECTIONS.ltiGradeTargets,
  ]) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await deleteWhere(COLLECTIONS.classEnrollments, 'classId', CLASS_ID);
  await deleteWhere(COLLECTIONS.lecturerAssessments, 'classId', CLASS_ID);
  for (const id of ['LTI-A1', 'LTI-A2']) await deleteWhere(COLLECTIONS.grades, 'assignmentId', id);

  const auth = getAdminAuth();
  for (const email of [...createdEmails, LECTURER_EMAIL]) {
    try {
      const user = await auth.getUserByEmail(email);
      await auth.deleteUser(user.uid);
      await db.collection(COLLECTIONS.users).doc(user.uid).delete();
    } catch {
      // not there
    }
  }
  const index = await db.collection(COLLECTIONS.studentIdIndex).get();
  await Promise.all(
    index.docs
      .filter((doc) => doc.id.startsWith('SV2026') || doc.id.startsWith('MOODLE'))
      .map((doc) => doc.ref.delete()),
  );
  createdEmails.clear();
}

async function seed() {
  const auth = getAdminAuth();
  const lecturer = await auth.createUser({
    email: LECTURER_EMAIL,
    displayName: 'TS. Trần Thị Bình',
  });
  lecturerUid = lecturer.uid;
  await auth.setCustomUserClaims(lecturerUid, { role: 'lecturer' });
  await getDb().collection(COLLECTIONS.users).doc(lecturerUid).set({
    uid: lecturerUid,
    email: LECTURER_EMAIL,
    fullName: 'TS. Trần Thị Bình',
    globalRole: 'lecturer',
    preferredLanguage: 'vi',
    status: 'active',
  });
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'ECOM-LTI-01',
      className: 'Thương mại điện tử – Lớp LTI',
      courseId: 'C1',
      semesterId: 'S1',
      language: 'vi',
      joinMode: 'approval',
      caseSelection: 'lecturer_assigns',
      status: 'active',
      studentCount: 0,
      lecturerIds: [lecturerUid],
    });
}

async function linkCourse() {
  const first = await handleLtiLaunch(lecturerLaunch());
  expect(first.next).toBe(`/lti/link?key=${contextKey}`);
  await linkLtiCourse(
    { uid: lecturerUid, email: LECTURER_EMAIL, role: 'lecturer' },
    contextKey,
    CLASS_ID,
  );
}

async function seedPublished(assignmentId: string, uid: string, finalScore: number) {
  const db = getDb();
  await db.collection(COLLECTIONS.lecturerAssessments).doc(assignmentId).set({
    assignmentId,
    classId: CLASS_ID,
    kind: 'case_study',
    groupId: 'G1',
    status: 'published',
  });
  await db
    .collection(COLLECTIONS.grades)
    .doc(`${assignmentId}__${uid}`)
    .set({
      id: `${assignmentId}__${uid}`,
      assignmentId,
      kind: 'case_study',
      groupId: 'G1',
      studentUid: uid,
      groupScore: finalScore,
      individualScore: finalScore,
      finalScore,
      policyId: 'p',
      policyVersion: '1',
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulators, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seed();
  createdEmails.add('an.nguyen@example.edu.vn');
});
afterAll(wipe);

describe('a lecturer opening a course from Moodle', () => {
  it('is refused when no lecturer account exists here: Moodle cannot mint one', async () => {
    await expect(
      handleLtiLaunch(lecturerLaunch({ email: 'stranger@example.edu.vn', hubUserId: 'hub-x' })),
    ).rejects.toMatchObject({ messageKey: 'errors.ltiLecturerNotFound' });
  });

  it('is refused when the matching account is a student', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    await expect(
      handleLtiLaunch(lecturerLaunch({ email: 'an.nguyen@example.edu.vn', hubUserId: 'hub-y' })),
    ).rejects.toMatchObject({ messageKey: 'errors.ltiLecturerNotFound' });
  });

  it('links an unlinked course once, to a class they teach', async () => {
    const first = await handleLtiLaunch(lecturerLaunch());
    expect(first.customToken.length).toBeGreaterThan(20);
    expect(first.next).toBe(`/lti/link?key=${contextKey}`);

    const pending = await getLtiPendingLink(
      { uid: lecturerUid, email: LECTURER_EMAIL, role: 'lecturer' },
      contextKey,
    );
    expect(pending.courseTitle).toBe(COURSE.title);
    expect(pending.classes.map((item) => item.id)).toContain(CLASS_ID);

    await linkLtiCourse(
      { uid: lecturerUid, email: LECTURER_EMAIL, role: 'lecturer' },
      contextKey,
      CLASS_ID,
    );
    const again = await handleLtiLaunch(lecturerLaunch());
    expect(again.next).toBe(`/teaching/${CLASS_ID}`);
  });

  it('cannot link the course to a class someone else teaches', async () => {
    await handleLtiLaunch(lecturerLaunch());
    await getDb()
      .collection(COLLECTIONS.classes)
      .doc(CLASS_ID)
      .update({ lecturerIds: ['someone-else'] });
    await expect(
      linkLtiCourse(
        { uid: lecturerUid, email: LECTURER_EMAIL, role: 'lecturer' },
        contextKey,
        CLASS_ID,
      ),
    ).rejects.toMatchObject({ messageKey: 'errors.notYourClass' });
  });
});

describe('a student opening the class from Moodle', () => {
  it('waits until the lecturer has linked the course', async () => {
    await expect(handleLtiLaunch(launch())).rejects.toMatchObject({
      messageKey: 'errors.ltiClassNotLinked',
    });
  });

  it('gets an account with the Moodle username as student code, and joins the class', async () => {
    await linkCourse();
    const result = await handleLtiLaunch(launch());
    expect(result.next).toBe(`/classes/${CLASS_ID}`);

    const user = await getAdminAuth().getUserByEmail('an.nguyen@example.edu.vn');
    expect(user.customClaims?.role).toBe('student');
    expect(user.passwordHash).toBeUndefined();
    const profile = await getDb().collection(COLLECTIONS.users).doc(user.uid).get();
    expect(profile.get('studentId')).toBe('sv2026001');
    expect(profile.get('mustChangePassword')).toBeUndefined();

    const enrollment = await getDb()
      .collection(COLLECTIONS.classEnrollments)
      .doc(`${CLASS_ID}__SV2026001`)
      .get();
    expect(enrollment.get('status')).toBe('active');
    expect(enrollment.get('joinedVia')).toBe('lti');
    const target = await getDb()
      .collection(COLLECTIONS.ltiGradeTargets)
      .where('uid', '==', user.uid)
      .get();
    expect(target.docs.map((doc) => doc.get('gradeTarget'))).toEqual(['grade-target-an']);
  });

  it('is the same person the second time, counted once in the class', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    await handleLtiLaunch(launch());
    const klass = await getDb().collection(COLLECTIONS.classes).doc(CLASS_ID).get();
    expect(klass.get('studentCount')).toBe(1);
  });

  it('takes a suffixed student code when the username already belongs to someone else', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    createdEmails.add('khac@example.edu.vn');
    await handleLtiLaunch(
      launch({ hubUserId: 'hub-student-2', email: 'khac@example.edu.vn', name: 'Người khác' }),
    );
    const other = await getAdminAuth().getUserByEmail('khac@example.edu.vn');
    const profile = await getDb().collection(COLLECTIONS.users).doc(other.uid).get();
    expect(profile.get('studentId')).toMatch(/^sv2026001-[a-f0-9]{4}$/);
  });

  it('stays out of a class the lecturer removed them from', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    await getDb()
      .collection(COLLECTIONS.classEnrollments)
      .doc(`${CLASS_ID}__SV2026001`)
      .update({ status: 'removed' });
    await expect(handleLtiLaunch(launch())).rejects.toMatchObject({
      messageKey: 'errors.removedFromClass',
    });
  });

  it('is refused for a tenant that was not let in', async () => {
    await expect(handleLtiLaunch(launch({ tenantId: 'other-school' }))).rejects.toMatchObject({
      messageKey: 'errors.ltiTenantNotAllowed',
    });
  });
});

describe('marks going to the Moodle gradebook', () => {
  it('sends the average of the published case studies, on the 0-100 scale', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    const uid = (await getAdminAuth().getUserByEmail('an.nguyen@example.edu.vn')).uid;
    await seedPublished('LTI-A1', uid, 80);
    await seedPublished('LTI-A2', uid, 60);

    const hub = fakeHub();
    const outcome = await sendLtiGradesForAssignment('LTI-A2', hub.client);
    expect(outcome).toEqual({ sent: 1, failed: 0 });
    expect(hub.results[0]).toMatchObject({
      gradeTarget: 'grade-target-an',
      attemptId: `case_study:${CLASS_ID}:${uid}`,
      score: 70,
      maxScore: 100,
    });
  });

  it('sends nothing for a draft: only published marks leave the platform', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    const uid = (await getAdminAuth().getUserByEmail('an.nguyen@example.edu.vn')).uid;
    await seedPublished('LTI-A1', uid, 80);
    await getDb().collection(COLLECTIONS.grades).doc(`LTI-A1__${uid}`).update({ status: 'draft' });

    const hub = fakeHub();
    expect(await sendLtiGradesForAssignment('LTI-A1', hub.client)).toEqual({ sent: 0, failed: 0 });
  });

  it('sends the whole class to every graded column, matched by Hub id and student code', async () => {
    await linkCourse();
    await handleLtiLaunch(launch());
    // The "opens the class" activity has no column to fill.
    await handleLtiLaunch(
      launch({
        resourceLink: { id: 'res-class', title: 'Vào lớp' },
        activity: 'class',
        linkTarget: 'lt-class',
      }),
    );
    const uid = (await getAdminAuth().getUserByEmail('an.nguyen@example.edu.vn')).uid;
    await seedPublished('LTI-A1', uid, 90);

    const links = await ltiLinksOfClass(CLASS_ID);
    expect(links.courses.map((course) => course.title)).toEqual([COURSE.title]);
    expect(links.activities.map((activity) => activity.kind).sort()).toEqual([
      'case_study',
      'class',
    ]);

    const hub = fakeHub();
    const outcome = await sendLtiClassGrades(
      { uid: lecturerUid, email: LECTURER_EMAIL, role: 'lecturer' },
      CLASS_ID,
      hub.client,
    );
    expect(outcome).toEqual({ activities: 1, rows: 1, failed: 0 });
    expect(hub.batches[0]).toMatchObject({
      linkTarget: 'link-target-case',
      maxScore: 100,
      rows: [{ hubUserId: 'hub-student-1', username: 'sv2026001', score: 90 }],
    });
  });

  it('lets only a lecturer of the class send it', async () => {
    await linkCourse();
    await expect(
      sendLtiClassGrades(
        { uid: 'someone', email: 'x@y.z', role: 'lecturer' },
        CLASS_ID,
        fakeHub().client,
      ),
    ).rejects.toMatchObject({ messageKey: 'errors.notYourClass' });
  });
});
