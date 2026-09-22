import { cert, getApp, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Storage } from 'firebase-admin/storage';
import { getServerEnv } from '../env';

const APP_NAME = 'casestudyhub-admin';

/**
 * Firebase Admin is initialised once per process, lazily.
 *
 * On Cloud Run the runtime service account supplies credentials through ADC.
 * Against the Firebase Emulator Suite no credentials are needed at all - the
 * emulator host variables are enough.
 */
export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  const env = getServerEnv();
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  return initializeApp(
    {
      projectId: env.GOOGLE_CLOUD_PROJECT,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      credential: serviceAccountJson
        ? cert(JSON.parse(serviceAccountJson) as Record<string, string>)
        : applicationDefault(),
    },
    APP_NAME,
  );
}

let firestore: Firestore | null = null;

export function getDb(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getAdminApp());
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

/** Test helper: the emulator runs without credentials, so skip ADC entirely. */
export function isAdminInitialised(): boolean {
  try {
    return Boolean(getApp(APP_NAME));
  } catch {
    return false;
  }
}
