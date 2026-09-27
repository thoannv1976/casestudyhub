import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

/**
 * The model reading the class group project, against the real database.
 *
 * One pipeline marks both pieces of work, so what needs proving is that it
 * picks up the right instrument and the right documents: the project rubric
 * rather than the presentation one, the deck and the report rather than a case
 * that does not exist, and never the criterion a panel has to judge in person.
 *
 * The provider is injected, so nothing here reaches a network.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  setAiProvider,
  setProjectDeadline,
  gatherEvaluationSources,
  evaluateSubmission,
  getAiAssessment,
  submitDeliverable,
  submitLink,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, DEFAULT_PROJECT_RUBRIC, projectTargetId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'AIP-A01';
const GROUP_ID = 'AIP-G1';
const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'aip_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const student = { uid: 'aip_student', email: 'sv@x.edu.vn', role: 'student' as const };
const TARGET = projectTargetId(CLASS_ID, GROUP_ID);
const REASON = 'Final week of the course, as announced in week one.';

const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** A deck with words on two numbered slides, built the way PowerPoint writes one. */
function deck(): Buffer {
  const slide = (text: string) =>
    strToU8(
      `<p:sld xmlns:a="x"><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`,
    );
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide1.xml': slide('SkinSync pitch'),
      'ppt/slides/slide9.xml': slide('Revenue 20000 visits x 3% x 400000 VND'),
    }),
  );
}

interface Recorded {
  system: string;
  prompt: string;
  fileCount: number;
  texts: string[];
}

/** Answers with full marks on every criterion it is asked about. */
function fakeProvider(recorded: Recorded[]) {
  return {
    name: 'fake',
    model: 'fake-model-1',
    async generate<T>(request: {
      system: string;
      prompt: string;
      files?: { mimeType: string; data: string }[];
      schema: { parse: (value: unknown) => T };
    }) {
      recorded.push({
        system: request.system,
        prompt: request.prompt,
        fileCount: request.files?.length ?? 0,
        texts: (request.files ?? [])
          .filter((file) => file.mimeType === 'text/plain')
          .map((file) => Buffer.from(file.data, 'base64').toString('utf8')),
      });

      const asked = [...request.prompt.matchAll(/^- ([a-z-]+) \(out of (\d+)\)/gm)];
      return {
        value: request.schema.parse({
          criteria: asked.map(([, criterionId, maxPoints]) => ({
            criterionId,
            suggestedPoints: Number(maxPoints),
            reasoning: 'Everything asked for was there.',
            citations: [{ source: 'slides', locator: 'slide 9', quote: 'Revenue 20000 visits' }],
            confidence: 'high',
          })),
          gaps: [],
        }),
        model: 'fake-model-1',
        promptTokens: 100,
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
      classCode: 'AIP01',
      className: 'Thuong mai dien tu',
      courseId: 'AIP-C1',
      semesterId: 'AIP-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      caseSelection: 'lecturer_assigns',
      status: 'active',
    });

  await db.collection(COLLECTIONS.groups).doc(GROUP_ID).set({
    id: GROUP_ID,
    groupCode: GROUP_ID,
    groupName: 'Nhom 1',
    classId: CLASS_ID,
    maxMembers: 6,
    memberCount: 1,
    formationMode: 'lecturer_assignment',
    locked: false,
    status: 'forming',
  });

  await db
    .collection(COLLECTIONS.groupMembers)
    .doc(`${CLASS_ID}__${student.uid}`)
    .set({
      id: `${CLASS_ID}__${student.uid}`,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      studentUid: student.uid,
      studentId: 'SV001',
      fullName: 'Sinh vien A',
      roleIds: [],
      isLeader: true,
    });

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
    db.collection(COLLECTIONS.submissions).where('groupId', '==', GROUP_ID).get(),
    db.collection(COLLECTIONS.aiAssessments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
    db.collection(COLLECTIONS.aiUsage).get(),
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

describe('what the model is given for the project', () => {
  it('reads the deck and the report, and nothing about a case', async () => {
    await submitDeliverable(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-report',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });
    await submitDeliverable(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });

    const sources = await gatherEvaluationSources(TARGET);
    expect(sources.files).toHaveLength(2);
    expect(sources.described.some((name) => name.startsWith('report:'))).toBe(true);
    expect(sources.described.some((name) => name.startsWith('deck:'))).toBe(true);
    // A project has no case study, so nothing may claim to be one.
    expect(sources.described.some((name) => name.startsWith('case:'))).toBe(false);
  });

  it('reads a PowerPoint deck as the words of each numbered slide', async () => {
    await submitDeliverable(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pptx',
      contentType: PPTX_MIME,
      body: deck(),
    });

    const sources = await gatherEvaluationSources(TARGET);
    expect(sources.files).toHaveLength(1);
    expect(sources.files[0]?.mimeType).toBe('text/plain');
    expect(sources.skipped).toEqual([]);
    // Said plainly, because the reading is partial.
    expect(sources.described[0]).toContain('text of each slide only');

    const text = Buffer.from(sources.files[0]?.data ?? '', 'base64').toString('utf8');
    expect(text).toContain('--- slide 9 ---');
    expect(text).toContain('Revenue 20000 visits');
  });

  it('calls a link a gap rather than pretending to have read it', async () => {
    await submitLink(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-video',
      url: 'https://youtu.be/story',
    });
    await submitDeliverable(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-report',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });

    const sources = await gatherEvaluationSources(TARGET);
    // The video is not among the documents the model reads at all, so it is not
    // even a skipped one: it is a link, and links are not read.
    expect(sources.files).toHaveLength(1);
    expect(sources.skipped).toEqual([]);
  });

  it('refuses when there is nothing to read', async () => {
    await expect(evaluateSubmission(lecturer, TARGET)).rejects.toThrow(/nothingToEvaluate/);
  });
});

describe('the reading itself', () => {
  beforeEach(async () => {
    await submitDeliverable(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-pitch-deck',
      fileName: 'deck.pdf',
      contentType: 'application/pdf',
      body: TINY_PDF,
    });
  });

  it('uses the project rubric, not the presentation one', async () => {
    const recorded: Recorded[] = [];
    setAiProvider(fakeProvider(recorded));

    const assessment = await evaluateSubmission(lecturer, TARGET);

    expect(assessment.kind).toBe('group_project');
    expect(assessment.rubricId).toBe(DEFAULT_PROJECT_RUBRIC.id);
    expect(assessment.caseStudyId).toBeUndefined();
    // Asked about the project's components, by their own ids.
    expect(recorded[0]?.prompt).toContain('data-kpi');
    expect(recorded[0]?.prompt).not.toContain('understanding');
  });

  it('never asks about the part a panel has to judge in person', async () => {
    const recorded: Recorded[] = [];
    setAiProvider(fakeProvider(recorded));

    await evaluateSubmission(lecturer, TARGET);

    expect(recorded[0]?.prompt).not.toContain('pitch-teamwork');
    // And the points it could propose stop short of the full hundred.
    const assessment = await getAiAssessment(TARGET);
    expect(assessment?.assessableMaxPoints).toBe(95);
    expect(assessment?.criteria.some((row) => row.criterionId === 'pitch-teamwork')).toBe(false);
  });

  it('is stored against the project, and never touches a grade', async () => {
    setAiProvider(fakeProvider([]));
    await evaluateSubmission(lecturer, TARGET);

    expect((await getAiAssessment(TARGET))?.assignmentId).toBe(TARGET);
    // The one line that matters: no grade exists because a model read a deck.
    const grades = await getDb()
      .collection(COLLECTIONS.grades)
      .where('groupId', '==', GROUP_ID)
      .get();
    expect(grades.empty).toBe(true);
  });
});
