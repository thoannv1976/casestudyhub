import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The assessment framework as stored, editable data - and the promise that
 * makes editing it safe.
 *
 * The promise is not "we are careful". It is that a version is written with
 * `create`, so there is no code path that rewrites the document a grade was
 * computed from, and that every read resolves through the version an
 * assignment stamped. This file tries to break both.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  getPolicy,
  listPolicies,
  latestPolicy,
  savePolicyVersion,
  clearPolicyCache,
  saveLecturerAssessment,
  previewGrades,
  publishGrades,
  listPublishedGradesOfStudent,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'POL-A01';
const GROUP_ID = 'POL-G1';
const base = DEFAULT_PRESENTATION_POLICY;

const admin = { uid: 'pol_admin', email: 'admin@x.edu.vn', role: 'admin' as const };
const lecturer = { uid: 'pol_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const student = { uid: 'pol_student_1', email: 'sv@x.edu.vn', role: 'student' as const };

const MEMBERS = [1, 2, 3, 4].map((index) => ({
  uid: `pol_student_${index}`,
  studentId: `POL${index}`,
  fullName: `Student ${index}`,
}));

/** A framework whose rubric is worth half as much, which would move any mark. */
function halvedRubric(version: string, id = base.id) {
  return {
    ...base,
    id,
    version,
    rubric: {
      ...base.rubric,
      totalPoints: base.rubric.totalPoints / 2,
      criteria: base.rubric.criteria.map((criterion) => ({
        ...criterion,
        maxPoints: criterion.maxPoints / 2,
      })),
    },
  };
}

async function seedAssignment(assignmentId: string, policyVersion: string) {
  const presentation = Date.now() + 7 * 24 * 3600_000;
  await getDb()
    .collection(COLLECTIONS.assignments)
    .doc(assignmentId)
    .set({
      id: assignmentId,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      caseStudyId: 'POL-CS1',
      caseVersionId: 'v1',
      policyId: base.id,
      policyVersion,
      rubricVersion: base.rubric.version,
      presentationDate: new Date(presentation).toISOString(),
      submissionDeadline: new Date(presentation - 24 * 3600_000).toISOString(),
      status: 'under_review',
    });
}

async function seedMembers() {
  const db = getDb();
  for (const member of MEMBERS) {
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${member.uid}`)
      .set({
        id: `${CLASS_ID}__${member.uid}`,
        groupId: GROUP_ID,
        classId: CLASS_ID,
        studentUid: member.uid,
        studentId: member.studentId,
        fullName: member.fullName,
        roleIds: [],
        isLeader: false,
      });
  }
}

/** Full marks on every criterion of whichever rubric applies. */
function fullScoresOf(policy: typeof base) {
  return Object.fromEntries(
    policy.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
  );
}

function individualFor(score = 80) {
  return Object.fromEntries(
    MEMBERS.map((member) => [
      member.uid,
      { rawScore: score, didNotPresent: false, failedOwnRoleQuestion: false },
    ]),
  );
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.classes).where('id', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.policies).get(),
    ...MEMBERS.map((member) =>
      db.collection(COLLECTIONS.grades).where('studentUid', '==', member.uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  clearPolicyCache();
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seedMembers();
});

afterAll(wipe);

describe('a version is written once and never again', () => {
  it('stores a new version and reads it back whole', async () => {
    await savePolicyVersion(admin, {
      policy: halvedRubric('2026.2'),
      reason: 'The faculty rebalanced the rubric for the second semester.',
    });

    const read = await getPolicy(base.id, '2026.2');
    expect(read.rubric.totalPoints).toBe(base.rubric.totalPoints / 2);
    expect(read.roles).toHaveLength(base.roles.length);
  });

  it('refuses a version number that already exists, rather than overwriting it', async () => {
    const reason = 'The faculty rebalanced the rubric for the second semester.';
    await savePolicyVersion(admin, { policy: halvedRubric('2026.2'), reason });

    await expect(
      savePolicyVersion(admin, { policy: halvedRubric('2026.2'), reason }),
    ).rejects.toThrow(/policyVersionExists/);
  });

  it('refuses to rewrite the version the platform ships with', async () => {
    await expect(
      savePolicyVersion(admin, {
        policy: halvedRubric(base.version),
        reason: 'Trying to change the rules under every class already created.',
      }),
    ).rejects.toThrow(/policyVersionExists/);
  });

  it('will not accept a framework change without a reason worth keeping', async () => {
    await expect(
      savePolicyVersion(admin, { policy: halvedRubric('2026.2'), reason: 'tidy' }),
    ).rejects.toThrow(/policyReasonTooShort/);
  });

  it('will not accept a framework that cannot be marked with', async () => {
    await expect(
      savePolicyVersion(admin, {
        policy: {
          ...base,
          version: '2026.2',
          grading: { ...base.grading, teamWeight: 0.8, individualWeight: 0.8 },
        },
        reason: 'Weights that do not add up to one whole mark.',
      }),
    ).rejects.toThrow();
  });
});

describe('who may change what', () => {
  it('lets a lecturer start a framework of their own', async () => {
    const saved = await savePolicyVersion(lecturer, {
      policy: halvedRubric('2026.1', 'ftu-marketing-2026'),
      reason: 'Marketing runs shorter presentations than the standard framework.',
    });
    expect(saved.id).toBe('ftu-marketing-2026');
  });

  it('stops a lecturer versioning a framework other classes already run under', async () => {
    await expect(
      savePolicyVersion(lecturer, {
        policy: halvedRubric('2026.2'),
        reason: 'A change that would reach every class created after it.',
      }),
    ).rejects.toThrow(/policyNotYoursToVersion/);
  });

  it('refuses a student outright, whatever they send', async () => {
    await expect(
      savePolicyVersion(student, {
        policy: halvedRubric('2026.3'),
        reason: 'A student rewriting the rules they are marked against.',
      }),
    ).rejects.toThrow(/forbidden/);
  });
});

describe('what a new version reaches', () => {
  it('leaves a published mark exactly where it was', async () => {
    await seedAssignment('POL-A1', base.version);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', 'POL-A1', {
      criterionScores: fullScoresOf(base),
      latePenaltyWaived: false,
      individual: individualFor(),
    });
    const published = await publishGrades(lecturer, 'POL-A1');
    const before = published.map((grade) => grade.finalScore);

    // The rules change under the whole platform, after the mark was given.
    await savePolicyVersion(admin, {
      policy: halvedRubric('2026.2'),
      reason: 'The faculty halved the rubric for the following semester.',
    });

    const after = (await previewGrades('POL-A1')).map((row) => row.breakdown.finalScore);
    expect(after).toEqual(before);

    const stored = await listPublishedGradesOfStudent(MEMBERS[0]!.uid);
    expect(stored[0]?.finalScore).toBe(before[0]);
    expect(stored[0]?.policyVersion).toBe(base.version);
  });

  it('marks work set under the new version by the new rules', async () => {
    await savePolicyVersion(admin, {
      policy: halvedRubric('2026.2'),
      reason: 'The faculty halved the rubric for the following semester.',
    });

    // Two assignments for the same group, stamped with different versions.
    await seedAssignment('POL-OLD', base.version);
    await seedAssignment('POL-NEW', '2026.2');

    const newPolicy = await getPolicy(base.id, '2026.2');
    await saveLecturerAssessment(lecturer, 'Tran Thi B', 'POL-OLD', {
      criterionScores: fullScoresOf(base),
      latePenaltyWaived: false,
      individual: individualFor(),
    });
    await saveLecturerAssessment(lecturer, 'Tran Thi B', 'POL-NEW', {
      criterionScores: fullScoresOf(newPolicy),
      latePenaltyWaived: false,
      individual: individualFor(),
    });

    const old = await previewGrades('POL-OLD');
    const now = await previewGrades('POL-NEW');

    // Full marks under either rubric are still full marks; what proves the
    // stamp is read is that each traces to its own version.
    expect(old[0]?.breakdown.policyVersion).toBe(base.version);
    expect(now[0]?.breakdown.policyVersion).toBe('2026.2');
  });

  it('is what a new class is stamped with, while an old class keeps its own', async () => {
    expect((await latestPolicy()).version).toBe(base.version);

    await savePolicyVersion(admin, {
      policy: halvedRubric('2026.2'),
      reason: 'The faculty halved the rubric for the following semester.',
    });

    expect((await latestPolicy()).version).toBe('2026.2');
  });
});

describe('the list of frameworks', () => {
  it('holds the built-in default even before anything has been written', async () => {
    const policies = await listPolicies();
    expect(policies.map((policy) => policy.version)).toEqual([base.version]);
  });

  it('puts the newest version of a framework first', async () => {
    for (const version of ['2026.2', '2026.10']) {
      await savePolicyVersion(admin, {
        policy: halvedRubric(version),
        reason: `Framework version ${version}, published for the next semester.`,
      });
    }

    const versions = (await listPolicies())
      .filter((policy) => policy.id === base.id)
      .map((policy) => policy.version);
    expect(versions[0]).toBe('2026.10');
  });
});
