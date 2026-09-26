import { z } from 'zod';

/**
 * Platform settings (SRS Module 03).
 *
 * Only settings that something actually reads. A switch on an administration
 * page that changes nothing is worse than no switch at all: it tells whoever
 * flips it that they have done something.
 *
 * Academic rules are deliberately not here - how long a group speaks, what a
 * criterion is worth, when submission closes. Those belong to the assessment
 * framework, which is versioned and frozen per class, because changing one
 * must not reach work already marked. These are operational: they take effect
 * at once and apply to everybody.
 */

export const SYSTEM_SETTINGS_ID = 'platform';

/**
 * The vendors the platform can be pointed at. Adding a third is a file and an
 * entry here: everything else in the platform reaches a model through one
 * interface and never learns which vendor answered.
 */
export const AI_PROVIDERS = ['gemini', 'openai'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProviderName = z.infer<typeof aiProviderSchema>;

/** What each vendor is pointed at before an administrator changes it. */
export const DEFAULT_AI_MODELS: Record<AiProviderName, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
};

/**
 * Where an API key lives once an administrator types one in.
 *
 * A separate document from the settings, in a collection Security Rules close
 * to every client, so that the settings can be read by the code that needs
 * them without a credential travelling alongside. Nothing returns this
 * document over HTTP; the administration page is told only that a key exists
 * and its last four characters.
 */
export const AI_CREDENTIALS_ID = 'aiCredentials';

export const aiCredentialSchema = z.object({
  /** Kept only so the page can say *which* key is stored, never the key. */
  hint: z.string().max(8).default(''),
  updatedAt: z.string().optional(),
  updatedByUid: z.string().optional(),
});

/** What the administration page may know about a stored key. */
export interface AiCredentialState {
  set: boolean;
  /** The last four characters, which is what identifies a key to its owner. */
  hint: string;
  updatedAt: string | null;
}

export const systemSettingsSchema = z.object({
  /**
   * Whether a student may create their own account. A faculty closes this
   * once a term has started and adds late arrivals by hand, so a stray link
   * cannot fill the platform with accounts nobody expects.
   */
  registrationOpen: z.boolean().default(true),

  /** The largest class list a lecturer may upload, in kilobytes. */
  maxImportKb: z.number().int().min(16).max(8192).default(512),

  /**
   * How many model calls the platform will make in a calendar month. The
   * model is billed per call, so this is the one number that decides what the
   * faculty can be charged. Zero stops the AI features without unsetting the
   * credentials, which is what somebody reaches for when a bill surprises
   * them.
   */
  aiMonthlyCallBudget: z.number().int().min(0).max(100_000).default(500),

  /**
   * Whether the platform calls Gemini through Vertex AI, using the Cloud Run
   * service account.
   *
   * This lived in an environment variable until a deploy wiped it: the deploy
   * script replaced the whole variable set rather than merging into it, so the
   * next release silently turned the model off - and because "no model
   * configured" is a normal state here rather than an error, nobody would have
   * noticed until a lecturer asked where the buttons went.
   *
   * Turning Vertex on needs no secret at all, only a switch, a model name and
   * a region, which is exactly what this document is for. An API key is
   * different and stays in the environment, because it is a credential.
   */
  aiEnabled: z.boolean().default(false),

  /**
   * Which vendor the platform talks to. One per deployment, not one per class:
   * two classes marked by two different models would not be marked by the same
   * standard, and a mark has to mean the same thing across a cohort.
   */
  aiProvider: aiProviderSchema.default('gemini'),

  /**
   * How Gemini is reached. Vertex uses the Cloud Run service account and needs
   * no secret at all; the API key route needs one, and is the quickest way to
   * try the platform before the Vertex AI API is enabled on a project. OpenAI
   * has only the one route, so this says nothing about it.
   */
  aiGeminiTransport: z.enum(['vertex', 'apiKey']).default('vertex'),

  /**
   * The model name, per vendor. Kept apart rather than in one field because a
   * model name belongs to the vendor it was written for: switching vendor with
   * one shared field would send `gemini-2.5-flash` to OpenAI.
   */
  aiModels: z
    .object({
      gemini: z.string().trim().min(1).max(80).default(DEFAULT_AI_MODELS.gemini),
      openai: z.string().trim().min(1).max(80).default(DEFAULT_AI_MODELS.openai),
    })
    .default({ gemini: DEFAULT_AI_MODELS.gemini, openai: DEFAULT_AI_MODELS.openai }),

  /** `global` serves Gemini everywhere and is the least region-restricted. */
  aiLocation: z.string().trim().min(1).max(40).default('global'),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

/** What a deployment runs on before anybody has changed anything. */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = systemSettingsSchema.parse({});

export const saveSystemSettingsSchema = z.object({
  settings: systemSettingsSchema,
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});

/** The document one month's usage is counted into: `2026-03`. */
export function usagePeriodOf(nowMs: number): string {
  const date = new Date(nowMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const aiUsageSchema = z.object({
  period: z.string().min(1),
  calls: z.number().int().nonnegative().default(0),
  promptTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
