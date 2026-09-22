import { z } from 'zod';

/**
 * Server-side environment. Validated lazily, never at module load, so a
 * container image can be built without production secrets present.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  FIREBASE_STORAGE_BUCKET: z.string().min(1),
  /** Set by the Firebase Emulator Suite during local development and CI. */
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),
  /**
   * Only for local development outside the emulator. On Cloud Run the runtime
   * service account supplies credentials and this stays unset.
   */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  /** Gemini key, injected from Secret Manager. Absent until Phase 3. */
  GEMINI_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetServerEnvCache(): void {
  cached = null;
}

export function isEmulated(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}
