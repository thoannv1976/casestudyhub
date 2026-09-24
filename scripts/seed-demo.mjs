/**
 * Creates a demonstration course from the documents in docs/source.
 *
 *   node scripts/seed-demo.mjs <email-of-the-lecturer>
 *
 * Idempotent: everything is keyed by its code, so running it twice reuses what
 * is already there rather than creating a second copy. Safe to run against the
 * real project - it only adds, never deletes.
 */
import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// firebase-tools sets GCLOUD_PROJECT rather than GOOGLE_CLOUD_PROJECT, so a
// run against the emulator has to read both or it silently addresses the wrong
// project and reports that no account exists.
const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'casestudy1-509414';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}-files`;
const lecturerEmail = process.argv[2];

if (!lecturerEmail) {
  console.error('Usage: node scripts/seed-demo.mjs <email-of-the-lecturer>');
  process.exit(1);
}

const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const app = initializeApp(
  {
    projectId: PROJECT_ID,
    storageBucket: BUCKET,
    ...(emulated ? {} : { credential: applicationDefault() }),
  },
  'seed-demo',
);

const auth = getAuth(app);
const db = getFirestore(app);
const bucket = getStorage(app).bucket(BUCKET);

// Two different failures used to print the same message here, which sent the
// reader looking for a missing account when the real problem was credentials.
const lecturer = await auth.getUserByEmail(lecturerEmail).catch((error) => {
  if (error?.code === 'auth/user-not-found') return null;
  console.error('Could not reach Firebase Authentication:');
  console.error(error);
  process.exit(1);
});

if (!lecturer) {
  console.error(`No account uses ${lecturerEmail}. Register it in the app first.`);
  process.exit(1);
}
console.log(`Seeding as ${lecturerEmail} (${lecturer.uid})`);

/** Finds a document by a unique field, or creates it. */
async function ensure(collection, field, value, data) {
  const existing = await db.collection(collection).where(field, '==', value).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    console.log(`  = ${collection}/${value} (already there)`);
    return doc.id;
  }

  const ref = db.collection(collection).doc();
  await ref.set({
    id: ref.id,
    ...data,
    [field]: value,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: lecturer.uid,
  });
  console.log(`  + ${collection}/${value}`);
  return ref.id;
}

const yearId = await ensure('academicYears', 'name', '2026–2027', {
  startDate: '2026-09-01',
  endDate: '2027-06-30',
  status: 'active',
});

const semesterId = await ensure('semesters', 'name', 'Fall 2026', {
  academicYearId: yearId,
  status: 'active',
});

const courseId = await ensure('courses', 'code', 'ECOM2026', {
  name: 'E-Commerce 2026',
  description: 'Digital commerce, platform business models and AI commerce.',
  cloIds: ['CLO1', 'CLO2', 'CLO4', 'CLO6'],
  defaultLanguage: 'en',
  status: 'active',
});

const classId = await ensure('classes', 'classCode', 'ECOM-2026-A01', {
  className: 'E-Commerce 2026 – A01',
  courseId,
  semesterId,
  lecturerIds: [lecturer.uid],
  language: 'en',
  expectedStudents: 60,
  joinMode: 'code',
  presentationPolicyId: 'ecom-2026-standard',
  presentationPolicyVersion: '2026.1',
  studentCount: 0,
  status: 'active',
});

/**
 * The Amazon case, with the metadata the SRS lists and the real document from
 * docs/source attached. Uploading the genuine file is the point: it is what
 * later milestones extract text from.
 */
const caseId = await ensure('caseStudies', 'caseCode', 'CASE01', {
  title: 'Amazon',
  subtitle: 'From an online bookstore to the infrastructure of global commerce',
  company: 'Amazon.com, Inc.',
  industry: 'Marketplace, logistics, advertising, cloud computing',
  courseId,
  chapter: 'Session 1 — from online selling to Digital Commerce and AI Commerce',
  description:
    'The right question is not what Amazon sells, but which parts of the customer journey it controls.',
  language: 'en',
  learningObjectives: [
    'Read a business through the six levels of digital maturity.',
    'Separate GMV, revenue and profit, and explain why they differ.',
    'Judge what a Vietnamese firm could realistically copy.',
  ],
  cloIds: ['CLO1', 'CLO2', 'CLO4', 'CLO6'],
  mainQuestions: [
    'Why did opening the platform to third-party sellers raise the value of the whole system, and under what conditions would that decision backfire?',
    'If AWS were separated, could retail and marketplace still sustain low prices and long-term investment?',
    'If most transactions are carried out by AI agents, how much of a platform advantage built on interface and habit survives?',
  ],
  supportingQuestions: [],
  references: [
    'Amazon.com, Inc. (2026). Q4 and Full Year 2025 Results, Form 8-K Exhibit 99.1.',
    'Parker, G., Van Alstyne, M. & Choudary, S. P. (2016). Platform Revolution.',
    'Laudon, K. C. & Traver, C. G. (2023). E-commerce (17th ed.).',
  ],
  attachments: [],
  status: 'draft',
});

const documents = [
  {
    path: 'docs/source/G1_Case_01_Amazon_EN.docx',
    kind: 'case',
    fileName: 'G1-Case-01-Amazon-EN.docx',
  },
  {
    path: 'docs/source/Case_Study_Presentation_Guide_EN.docx',
    kind: 'guide',
    fileName: 'Case-Study-Presentation-Guide-EN.docx',
  },
];

const caseSnapshot = await db.collection('caseStudies').doc(caseId).get();
const attached = new Set(
  (caseSnapshot.get('attachments') ?? []).map((attachment) => attachment.fileName),
);

for (const document of documents) {
  if (attached.has(document.fileName)) {
    console.log(`  = attachment ${document.fileName} (already there)`);
    continue;
  }

  const body = await readFile(document.path).catch(() => null);
  if (!body) {
    console.log(`  ! ${document.path} not found, skipping`);
    continue;
  }

  const attachmentId = db.collection('caseStudies').doc().id;
  const storagePath = `cases/${caseId}/${attachmentId}-${document.fileName}`;
  const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  await bucket.file(storagePath).save(body, {
    contentType,
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });

  await db
    .collection('caseStudies')
    .doc(caseId)
    .update({
      attachments: FieldValue.arrayUnion({
        id: attachmentId,
        kind: document.kind,
        fileName: document.fileName,
        contentType,
        sizeBytes: body.byteLength,
        storagePath,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

  console.log(`  + attachment ${document.fileName} (${Math.round(body.byteLength / 1024)} KB)`);
}

await db.collection('caseStudies').doc(caseId).update({ status: 'published' });
console.log('  = case published');

// Ten groups of six: the class of sixty the SRS describes.
const existingGroups = await db.collection('groups').where('classId', '==', classId).get();
if (existingGroups.empty) {
  const batch = db.batch();
  for (let index = 1; index <= 10; index += 1) {
    const ref = db.collection('groups').doc();
    batch.set(ref, {
      id: ref.id,
      groupCode: `G${String(index).padStart(2, '0')}`,
      groupName: `Group ${index}`,
      classId,
      maxMembers: 6,
      memberCount: 0,
      formationMode: 'student_self_join',
      locked: false,
      status: 'forming',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: lecturer.uid,
    });
  }
  await batch.commit();
  console.log('  + 10 groups');
} else {
  console.log(`  = ${existingGroups.size} groups (already there)`);
}

console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  Lớp demo đã sẵn sàng.');
console.log('');
console.log('    Mã lớp cho sinh viên:  ECOM-2026-A01');
console.log('    Case study:            CASE01 — Amazon (đã công bố)');
console.log('    Nhóm:                  10 nhóm, tối đa 6 sinh viên');
console.log('════════════════════════════════════════════════════════');
