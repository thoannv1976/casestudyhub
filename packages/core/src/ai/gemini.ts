import { GoogleAuth } from 'google-auth-library';
import {
  AiNotConfiguredError,
  AiResponseError,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './provider';
import type { AiConfig } from './config';

/**
 * Google's Gemini models, reached two ways.
 *
 * On Cloud Run the service account is already there, so Vertex AI needs no
 * secret at all - which is one fewer thing to leak, rotate or forget. A plain
 * API key is honoured as well, because it is the quickest way to try the
 * platform before the Vertex AI API has been enabled on a project.
 *
 * Both endpoints speak the same `generateContent` shape, so the difference is
 * the URL and how the request is signed.
 */

type GeminiConfig = Extract<AiConfig, { provider: 'gemini' }>;

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
    return { 'x-goog-api-key': config.apiKey };
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
