/**
 * Seeds the Firebase Emulator with the one account the smoke test cannot create
 * for itself: the first administrator. Everything else in the test is created
 * through the interface, the way a real user would.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-casestudyhub';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to seed: no emulator host set. This must never touch a real project.');
  process.exit(1);
}

const app = initializeApp({ projectId: PROJECT_ID }, 'e2e-seed');
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN = {
  email: 'admin@e2e.test',
  password: 'e2eAdmin2026',
  fullName: 'E2E Administrator',
};

const record = await auth.createUser({
  email: ADMIN.email,
  password: ADMIN.password,
  displayName: ADMIN.fullName,
});

await auth.setCustomUserClaims(record.uid, { role: 'admin', preferredLanguage: 'en' });

await db.collection('users').doc(record.uid).set({
  uid: record.uid,
  fullName: ADMIN.fullName,
  email: ADMIN.email,
  globalRole: 'admin',
  preferredLanguage: 'en',
  status: 'active',
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

console.log(`Seeded administrator ${ADMIN.email} (${record.uid})`);

/**
 * Three more students, so a group can reach the four members the course
 * framework requires before roles may be allocated. The first student still
 * registers through the interface - that path needs covering too.
 */
for (const index of [2, 3, 4]) {
  const student = {
    studentId: `SVSEED${index}`,
    email: `student${index}@e2e.test`,
    password: 'student2026',
    fullName: `Seeded Student ${index}`,
  };

  const created = await auth.createUser({
    email: student.email,
    password: student.password,
    displayName: student.fullName,
  });
  await auth.setCustomUserClaims(created.uid, { role: 'student', preferredLanguage: 'en' });

  await db.collection('users').doc(created.uid).set({
    uid: created.uid,
    studentId: student.studentId,
    fullName: student.fullName,
    email: student.email,
    globalRole: 'student',
    preferredLanguage: 'en',
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('studentIdIndex').doc(student.studentId).set({
    uid: created.uid,
    studentId: student.studentId,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`Seeded student ${student.email}`);
}
