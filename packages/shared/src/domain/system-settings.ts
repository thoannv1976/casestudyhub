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
  aiModel: z.string().trim().min(1).max(80).default('gemini-2.5-flash'),
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
