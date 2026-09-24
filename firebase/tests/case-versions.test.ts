import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Revising a case, against the real database.
 *
 * The promise is the same one the assessment framework makes: a version a
 * group was given is never rewritten. So what is checked is not that editing
 * works but that editing cannot reach backwards.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, createCase, updateCase, getCase, getCaseVersion, listCaseVersions } =
  await import('@casestudyhub/core');
const { COLLECTIONS, nextCaseVersionId } = await import('@casestudyhub/shared');

const lecturer = { uid: 'cv_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const CODE = `CV${Date.now().toString().slice(-7)}`;
const REASON = 'The 2025 figures replaced the 2024 ones after the annual report.';

let caseId = '';

async function wipe() {
  const db = getDb();
  const cases = await db.collection(COLLECTIONS.caseStudies).where('caseCode', '==', CODE).get();
  for (const doc of cases.docs) {
    const versions = await db
      .collection(COLLECTIONS.caseVersions)
      .where('caseId', '==', doc.id)
      .get();
    await Promise.all(versions.docs.map((version) => version.ref.delete()));
    await doc.ref.delete();
  }
  const logs = await db
    .collection(COLLECTIONS.auditLogs)
    .where('actorUid', '==', lecturer.uid)
    .get();
  await Promise.all(logs.docs.map((doc) => doc.ref.delete()));
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  caseId = await createCase(lecturer, {
    caseCode: CODE,
    title: 'Amazon',
    courseId: 'CV-C1',
    language: 'en',
    learningObjectives: ['Read a marketplace P&L'],
    cloIds: ['CLO1'],
    mainQuestions: ['Which parts of the journey does Amazon control?'],
    references: [],
  });
});

afterAll(wipe);

describe('a case as created', () => {
  it('already has a version, so the pointer it carries means something', async () => {
    const study = await getCase(caseId);
    expect(study?.currentVersionId).toBe('v1');

    // `currentVersionId` has been written since the schema was drawn and never
    // pointed at a document. An assignment set before any edit froze an id
    // that could not be read back.
    const version = await getCaseVersion(caseId, 'v1');
    expect(version?.title).toBe('Amazon');
    expect(version?.reason).toBe('');
  });
});

describe('revising it', () => {
  it('writes a new version and moves the pointer', async () => {
    const versionId = await updateCase(lecturer, caseId, {
      title: 'Amazon (2025 figures)',
      learningObjectives: ['Read a marketplace P&L'],
      cloIds: ['CLO1', 'CLO2'],
      mainQuestions: ['Which parts of the journey does Amazon control?'],
      supportingQuestions: [],
      references: [],
      reason: REASON,
    });

    expect(versionId).toBe('v2');
    expect((await getCase(caseId))?.title).toBe('Amazon (2025 figures)');
    expect((await getCase(caseId))?.currentVersionId).toBe('v2');
  });

  it('leaves the earlier version exactly as it was', async () => {
    await updateCase(lecturer, caseId, {
      title: 'Amazon (2025 figures)',
      learningObjectives: [],
      cloIds: [],
      mainQuestions: [],
      supportingQuestions: [],
      references: [],
      reason: REASON,
    });

    // This is the whole point: a group set the case in March reads what they
    // were given, not what it became.
    const first = await getCaseVersion(caseId, 'v1');
    expect(first?.title).toBe('Amazon');
    expect(first?.cloIds).toEqual(['CLO1']);
  });

  it('keeps why each revision happened, with the revision', async () => {
    await updateCase(lecturer, caseId, {
      title: 'Amazon (2025 figures)',
      learningObjectives: [],
      cloIds: [],
      mainQuestions: [],
      supportingQuestions: [],
      references: [],
      reason: REASON,
    });

    const versions = await listCaseVersions(caseId);
    expect(versions.map((version) => version.versionId)).toEqual(['v2', 'v1']);
    expect(versions[0]?.reason).toBe(REASON);
  });

  it('refuses a revision with no explanation worth keeping', async () => {
    await expect(
      updateCase(lecturer, caseId, {
        title: 'Amazon',
        learningObjectives: [],
        cloIds: [],
        mainQuestions: [],
        supportingQuestions: [],
        references: [],
        reason: 'typo',
      }),
    ).rejects.toThrow();
  });

  it('refuses a case that does not exist rather than creating one', async () => {
    await expect(
      updateCase(lecturer, 'no_such_case', {
        title: 'Nothing',
        learningObjectives: [],
        cloIds: [],
        mainQuestions: [],
        supportingQuestions: [],
        references: [],
        reason: 'Revising something that was never there.',
      }),
    ).rejects.toThrow(/caseNotFound/);
  });

  it('counts on from whatever version the case is at', async () => {
    for (const title of ['Amazon v2', 'Amazon v3']) {
      await updateCase(lecturer, caseId, {
        title,
        learningObjectives: [],
        cloIds: [],
        mainQuestions: [],
        supportingQuestions: [],
        references: [],
        reason: `Revised to ${title} after the review.`,
      });
    }

    expect((await getCase(caseId))?.currentVersionId).toBe('v3');
    expect(await listCaseVersions(caseId)).toHaveLength(3);
  });
});

describe('reading a version that is not there', () => {
  it('says so rather than quietly handing back the current text', async () => {
    // A group told they are reading version 2 must not be shown version 5.
    expect(await getCaseVersion(caseId, 'v9')).toBeNull();
  });
});

describe('numbering', () => {
  it('counts on from a version id it recognises', () => {
    expect(nextCaseVersionId('v1')).toBe('v2');
    expect(nextCaseVersionId('v9')).toBe('v10');
  });

  it('starts at v2 for anything it does not, rather than guessing', () => {
    expect(nextCaseVersionId(undefined)).toBe('v2');
    expect(nextCaseVersionId('draft')).toBe('v2');
  });
});
