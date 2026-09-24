import { z } from 'zod';
import { AiBudgetSpentError, AiNotConfiguredError } from './provider';
import { getAiProvider, readGeminiConfig } from './vertex';

/**
 * Is the model reachable, and if not, why (SRS Module 03).
 *
 * Every AI feature in this platform is advisory, so "not configured" is a
 * state the interface reports rather than an error. The cost of that design is
 * that a genuine failure - a wrong model name, a service account without the
 * role, a region that does not serve this model - looks exactly the same to
 * whoever is standing in front of the screen.
 *
 * This is the one place that tells them apart, and it is reachable only by
 * somebody who may already read the deployment's settings.
 */

export interface AiStatus {
  configured: boolean;
  /** `vertex` uses the runtime service account; `apiKey` uses a secret. */
  transport: 'vertex' | 'apiKey' | null;
  model: string | null;
  location: string | null;
}

export function aiStatus(): AiStatus {
  const config = readGeminiConfig();
  if (!config) {
    return { configured: false, transport: null, model: null, location: null };
  }

  // The key itself never leaves this function, in any form. Which transport is
  // in use is enough to tell somebody what to check.
  return {
    configured: true,
    transport: config.transport,
    model: config.model,
    location: config.location ?? null,
  };
}

export type AiProbe =
  | {
      ok: true;
      model: string;
      promptTokens: number;
      outputTokens: number;
      latencyMs: number;
      answer: string;
    }
  | { ok: false; reason: 'notConfigured' | 'budgetSpent' | 'failed'; detail: string };

/** The smallest question worth asking a model, with a shape it must answer in. */
const probeSchema = z.object({ answer: z.string().min(1).max(200) });

/**
 * Asks the model one trivial question and reports exactly what came back.
 *
 * It goes through the ordinary gateway rather than around it, so the monthly
 * budget applies and the call is counted. A diagnostic that did not behave
 * like a real call would prove nothing about real calls.
 */
export async function probeAi(): Promise<AiProbe> {
  try {
    const result = await getAiProvider().generate({
      system: 'You are a connectivity check. Answer in at most five words.',
      prompt: 'Reply with the single word: ready.',
      schema: probeSchema,
      responseSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
      temperature: 0,
      maxOutputTokens: 64,
    });

    return {
      ok: true,
      model: result.model,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      answer: result.value.answer,
    };
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return { ok: false, reason: 'notConfigured', detail: '' };
    }
    if (error instanceof AiBudgetSpentError) {
      return { ok: false, reason: 'budgetSpent', detail: String(error.budget) };
    }

    // The real message, verbatim and untranslated. Whoever sees this is
    // diagnosing a deployment, and "something went wrong" would waste their
    // afternoon. It is capped because a model API can return a great deal.
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'failed', detail: detail.slice(0, 1000) };
  }
}
