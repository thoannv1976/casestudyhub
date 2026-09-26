import { AiResponseError, type AiProvider, type AiRequest, type AiResult } from './provider';
import { strictJsonSchema, withoutNulls } from './json-schema';
import type { AiConfig } from './config';

/**
 * OpenAI's chat completions, asked for JSON of a named shape.
 *
 * Two things differ from Gemini and both are handled here rather than at the
 * five call sites, which never learn which vendor answered:
 *
 * - The schema must be strict: every field required, no extra properties. The
 *   platform's schemas have optional fields, so they are translated on the way
 *   out and the nulls that translation needs are dropped on the way back.
 * - Files are not one uniform part. An image goes as a data URL, a PDF as a
 *   file part, and text is inlined as text - which is also the only thing that
 *   works for the Markdown a lecturer uploads.
 */

type OpenAiConfig = Extract<AiConfig, { provider: 'openai' }>;

const API_URL = 'https://api.openai.com/v1/chat/completions';

const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown']);

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function contentPartsFor(request: AiRequest<unknown>): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [{ type: 'text', text: request.prompt }];

  for (const [index, file] of (request.files ?? []).entries()) {
    if (TEXT_MIME_TYPES.has(file.mimeType)) {
      // Inlined as text: a text attachment has nothing a file upload would add,
      // and this works on every model rather than only the ones that read files.
      parts.push({
        type: 'text',
        text: Buffer.from(file.data, 'base64').toString('utf8'),
      });
      continue;
    }

    if (file.mimeType.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${file.mimeType};base64,${file.data}` },
      });
      continue;
    }

    parts.push({
      type: 'file',
      file: {
        filename: `attachment-${index + 1}.pdf`,
        file_data: `data:${file.mimeType};base64,${file.data}`,
      },
    });
  }

  return parts;
}

export function createOpenAiProvider(config: OpenAiConfig): AiProvider {
  return {
    name: 'openai',
    model: config.model,

    async generate<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      const startedAt = Date.now();

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: contentPartsFor(request) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'response',
              strict: true,
              schema: strictJsonSchema(request.responseSchema),
            },
          },
          temperature: request.temperature ?? 0.2,
          max_completion_tokens: request.maxOutputTokens ?? 8192,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new AiResponseError(`${response.status} ${detail.slice(0, 400)}`);
      }

      const body = (await response.json()) as ChatCompletionResponse;
      const choice = body.choices?.[0];
      const text = choice?.message?.content;

      if (!text) {
        // A refusal and a truncated answer both arrive as no content, and they
        // are different problems for whoever is reading the error.
        throw new AiResponseError(
          choice?.finish_reason ? `no content (${choice.finish_reason})` : 'empty response',
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw new AiResponseError('response was not JSON');
      }

      const parsed = request.schema.safeParse(withoutNulls(parsedJson));
      if (!parsed.success) {
        throw new AiResponseError(
          parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        );
      }

      return {
        value: parsed.data,
        model: config.model,
        promptTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
