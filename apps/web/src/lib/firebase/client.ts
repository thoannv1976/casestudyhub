'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';

/**
 * Firebase client SDK, initialised on first use.
 *
 * The config is public by design (it identifies the project, it does not grant
 * access); what protects data is Firebase Authentication plus the Firestore and
 * Storage security rules. NEXT_PUBLIC_* values are baked in at build time, so
 * the deployment workflow passes them as build arguments.
 */
const CLIENT_APP_NAME = 'casestudyhub-web';

function readConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Firebase client config is incomplete (${missing.join(', ')}). See .env.example.`,
    );
  }

  return config as Required<{ [K in keyof typeof config]: string }>;
}

export function getFirebaseApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === CLIENT_APP_NAME);
  if (existing) return getApp(CLIENT_APP_NAME);
  return initializeApp(readConfig(), CLIENT_APP_NAME);
}

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());

  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
  }
  return auth;
}
