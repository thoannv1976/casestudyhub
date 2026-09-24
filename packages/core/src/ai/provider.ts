import { z } from 'zod';

/**
 * The AI layer (SRS Module 12).
 *
 * One narrow interface, so the rest of the platform never talks to a model
 * vendor directly. Three things follow from that:
 *
 * - Every call asks for JSON against a Zod schema and is rejected if it does
 *   not fit. A model that answers with prose has not answered.
 * - The platform runs perfectly well with no model configured at all. AI is
 *   advisory everywhere (`aiScoreIsAdvisoryOnly` in the policy), so "not
 *   configured" is a state the interface reports, not an error it throws.
 * - Tests inject a provider and never reach the network.
 */

export interface AiFilePart {
  mimeType: string;
  /** Base64 file bytes, as the model APIs expect. */
  data: string;
}

export interface AiRequest<T> {
  /** What the model is, in one or two sentences. */
  system: string;
  prompt: string;
  files?: AiFilePart[];
  schema: z.ZodType<T>;
  /** JSON Schema describing the same shape, for the model's structured output. */
  responseSchema: Record<string, unknown>;
  /** Low for marking and answering; the task is reading, not invention. */
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiResult<T> {
  value: T;
  model: string;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generate<T>(request: AiRequest<T>): Promise<AiResult<T>>;
}

export class AiNotConfiguredError extends Error {
  readonly messageKey = 'errors.aiNotConfigured';
  constructor() {
    super('No AI model is configured for this deployment.');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiResponseError extends Error {
  readonly messageKey = 'errors.aiResponseUnusable';
  constructor(detail: string) {
    super(`The model returned something unusable: ${detail}`);
    this.name = 'AiResponseError';
  }
}
