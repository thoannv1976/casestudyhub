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
