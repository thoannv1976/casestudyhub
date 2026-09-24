import { GoogleAuth } from 'google-auth-library';
import {
  AiBudgetSpentError,
  AiNotConfiguredError,
  AiResponseError,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './provider';
import { currentAiUsage, getSystemSettings, recordAiCall } from '../settings/settings';
import type { SystemSettings } from '@casestudyhub/shared';

/**
 * Google's Gemini models, reached two ways.
 *
 * On Cloud Run the service account is already there, so Vertex AI needs no
 * secret at all - which is one fewer thing to leak, rotate or forget. A plain
 * `GEMINI_API_KEY` is honoured as well, because it is the quickest way to try
 * the platform before the Vertex AI API has been enabled on a project.
 *
 * Both endpoints speak the same `generateContent` shape, so the difference is
 * the URL and how the request is signed.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_LOCATION = 'global';

export interface GeminiConfig {
  model: string;
  /** `vertex` uses the runtime service account; `apiKey` uses a secret. */
  transport: 'vertex' | 'apiKey';
  projectId?: string;
  location?: string;
  apiKey?: string;
}

/**
 * What this deployment is configured to use, if anything.
 *
 * Two routes, and they are not the same kind of thing. An API key is a
 * credential, so it comes from the environment and takes precedence. Vertex
 * needs no secret - a switch, a model name and a region - so it comes from the
 * platform settings, where an administrator can turn it off without a deploy
 * and no deploy can turn it off without an administrator.
 */
export function readGeminiConfig(
  settings: Pick<SystemSettings, 'aiEnabled' | 'aiModel' | 'aiLocation'>,
  env: NodeJS.ProcessEnv = process.env,
): GeminiConfig | null {
  if (env.GEMINI_API_KEY?.trim()) {
    return {
      model: env.AI_MODEL?.trim() || settings.aiModel || DEFAULT_MODEL,
      transport: 'apiKey',
      apiKey: env.GEMINI_API_KEY.trim(),
    };
  }

  if (!settings.aiEnabled) return null;

  // The project id is always present on Cloud Run, so it can never be the
  // signal on its own - the switch above is.
  const projectId = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) return null;

  return {
    model: settings.aiModel || DEFAULT_MODEL,
    transport: 'vertex',
    projectId,
    location: settings.aiLocation || DEFAULT_LOCATION,
  };
}

export async function isAiConfigured(): Promise<boolean> {
  return readGeminiConfig(await getSystemSettings()) !== null;
}

function endpointFor(config: GeminiConfig): string {
  if (config.transport === 'apiKey') {
    return `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;
  }
  const host =
    config.location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${config.location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;
}

let cachedAuth: GoogleAuth | null = null;

async function authHeaders(config: GeminiConfig): Promise<Record<string, string>> {
  if (config.transport === 'apiKey') {
    return { 'x-goog-api-key': config.apiKey ?? '' };
  }
  cachedAuth ??= new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const token = await cachedAuth.getAccessToken();
  if (!token) throw new AiNotConfiguredError();
  return { Authorization: `Bearer ${token}` };
}

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function createGeminiProvider(config: GeminiConfig): AiProvider {
  return {
    name: config.transport === 'vertex' ? 'vertex-ai' : 'generative-language',
    model: config.model,

    async generate<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      const startedAt = Date.now();

      const parts: Record<string, unknown>[] = [{ text: request.prompt }];
      for (const file of request.files ?? []) {
        parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
      }

      const response = await fetch(endpointFor(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(config)) },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            // Structured output: the model is asked for JSON of a named shape,
            // and the answer is still validated against the Zod schema below.
            responseMimeType: 'application/json',
            responseSchema: request.responseSchema,
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxOutputTokens ?? 8192,
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new AiResponseError(`${response.status} ${detail.slice(0, 400)}`);
      }

      const body = (await response.json()) as GenerateContentResponse;
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
      if (!text) throw new AiResponseError('empty response');

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw new AiResponseError('response was not JSON');
      }

      const parsed = request.schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new AiResponseError(
          parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        );
      }

      return {
        value: parsed.data,
        model: config.model,
        promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}

/**
 * Every model call in the platform goes through `getAiProvider`, so the
 * monthly budget is enforced here rather than at each of the five call sites -
 * one of which would eventually be added without it.
 *
 * The count is written after the call returns: a call that failed cost
 * nothing. A burst of parallel calls can therefore cross the budget by
 * however many were already in flight, which is the right trade. A budget is
 * there to stop a runaway, not to be exact to the single call.
 */
function metered(provider: AiProvider): AiProvider {
  return {
    name: provider.name,
    model: provider.model,
    async generate(request) {
      const [settings, usage] = await Promise.all([getSystemSettings(), currentAiUsage()]);
      if (usage.calls >= settings.aiMonthlyCallBudget) {
        throw new AiBudgetSpentError(settings.aiMonthlyCallBudget);
      }

      const result = await provider.generate(request);
      await recordAiCall(result).catch((error: unknown) => {
        // A call that happened and was not counted is better than a call that
        // worked and is reported as failed, so this never throws.
        console.error('Failed to record AI usage', error);
      });
      return result;
    },
  };
}

let override: AiProvider | null = null;

/** Tests and the emulator inject a provider here and never reach a network. */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}

export async function getAiProvider(): Promise<AiProvider> {
  if (override) return metered(override);
  const config = readGeminiConfig(await getSystemSettings());
  if (!config) throw new AiNotConfiguredError();
  return metered(createGeminiProvider(config));
}

export async function aiIsAvailable(): Promise<boolean> {
  return override !== null || (await isAiConfigured());
}
