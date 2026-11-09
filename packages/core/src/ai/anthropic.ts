import Anthropic from '@anthropic-ai/sdk';
import { AiResponseError, type AiProvider, type AiRequest, type AiResult } from './provider';
import { strictJsonSchema, withoutNulls } from './json-schema';
import type { AiConfig } from './config';

/**
 * Anthropic's Claude, asked for JSON of a named shape.
 *
 * Through the official SDK, like the other vendors' own clients would be. What
 * differs from the other two, handled here so the call sites never learn which
 * vendor answered:
 *
 * - JSON comes from structured outputs (`output_config.format`), which takes
 *   the same strict schema OpenAI does - every field required, optional ones
 *   nullable - so the same translation serves both.
 * - Current Claude models take no `temperature`: sending one is refused. Depth
 *   is set with `effort` instead, and reading a case to answer questions about
 *   it is not a task that needs the top of the range.
 * - A PDF goes as a `document` block, an image as an `image` block, and text
 *   is inlined as text.
 * - A request a safety classifier declines can be re-run on another Claude
 *   model inside the same call (`fallbacks: "default"`), so a false positive on
 *   one case paper does not fail a whole batch of answers.
 */

type AnthropicConfig = Extract<AiConfig, { provider: 'anthropic' }>;

const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown']);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

function contentFor(request: AiRequest<unknown>): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const file of request.files ?? []) {
    if (TEXT_MIME_TYPES.has(file.mimeType)) {
      blocks.push({ type: 'text', text: Buffer.from(file.data, 'base64').toString('utf8') });
      continue;
    }
    if (IMAGE_MIME_TYPES.has(file.mimeType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data: file.data,
        },
      });
      continue;
    }
    if (file.mimeType === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      });
    }
    // Anything else (a Word file) has no block Claude reads; the callers that
    // matter extract its text first, as they do for every vendor.
  }

  // Documents first, then the question about them.
  blocks.push({ type: 'text', text: request.prompt });
  return blocks;
}

export function createAnthropicProvider(config: AnthropicConfig): AiProvider {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    model: config.model,

    async generate<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      const startedAt = Date.now();

      let response: Anthropic.Beta.Messages.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: config.model,
          max_tokens: request.maxOutputTokens ?? 16000,
          system: request.system,
          messages: [{ role: 'user', content: contentFor(request) }],
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: strictJsonSchema(request.responseSchema) },
          },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new AiResponseError(`${error.status ?? ''} ${error.message}`.trim().slice(0, 400));
        }
        throw error;
      }

      if (response.stop_reason === 'refusal') {
        throw new AiResponseError('the model declined this request');
      }

      const text = response.content
        .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (!text) {
        throw new AiResponseError(
          response.stop_reason ? `no content (${response.stop_reason})` : 'empty response',
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw new AiResponseError(
          response.stop_reason === 'max_tokens' ? 'answer was cut off' : 'response was not JSON',
        );
      }

      const parsed = request.schema.safeParse(withoutNulls(parsedJson));
      if (!parsed.success) {
        throw new AiResponseError(
          parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        );
      }

      return {
        value: parsed.data,
        // The model that actually answered: a fallback may have served it.
        model: response.model,
        promptTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
