import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AI_EVALUATION_RESPONSE_JSON_SCHEMA,
  SUGGESTED_QUESTIONS_JSON_SCHEMA,
  TUTOR_RESPONSE_JSON_SCHEMA,
  tutorResponseSchema,
} from '@casestudyhub/shared';
import { strictJsonSchema, withoutNulls } from '../ai/json-schema';
import { createOpenAiProvider } from '../ai/openai';

/**
 * Talking to OpenAI without talking to OpenAI.
 *
 * `fetch` is replaced, so this covers the two things that are actually ours:
 * the schema we send and what we do with the answer. The network is not ours
 * and testing it here would only prove that the internet was up.
 */

const config = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  transport: 'apiKey',
  apiKey: 'sk-test',
  fromEnvironment: false,
} as const;

function respondWith(content: unknown, usage = { prompt_tokens: 11, completion_tokens: 7 }) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
          usage,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every object in a strict schema, however deep. */
function objectsIn(schema: Record<string, unknown>): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (record.type === 'object') found.push(record);
    Object.values(record).forEach(walk);
  };
  walk(schema);
  return found;
}

describe('the schema OpenAI insists on', () => {
  const schemas = {
    evaluation: AI_EVALUATION_RESPONSE_JSON_SCHEMA,
    tutor: TUTOR_RESPONSE_JSON_SCHEMA,
    questions: SUGGESTED_QUESTIONS_JSON_SCHEMA,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`closes every object in the ${name} schema and requires every field`, () => {
      // Strict mode rejects the whole request otherwise, so one object missed
      // anywhere in the tree means that feature never works on OpenAI.
      for (const node of objectsIn(strictJsonSchema(schema))) {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
    });
  }

  it('keeps an optional field optional by letting it be null', () => {
    const strict = strictJsonSchema(TUTOR_RESPONSE_JSON_SCHEMA);
    const properties = strict.properties as Record<string, { type: unknown }>;

    expect(properties.reply?.type).toBe('string');
    expect(properties.pointer?.type).toEqual(['string', 'null']);
    expect(strict.required).toEqual(['reply', 'pointer']);
  });

  it('leaves a required field alone', () => {
    const strict = strictJsonSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
    expect((strict.properties as Record<string, { type: unknown }>).a?.type).toBe('string');
  });

  it('drops the nulls that strictness made necessary', () => {
    expect(withoutNulls({ reply: 'hi', pointer: null })).toEqual({ reply: 'hi' });
    expect(withoutNulls({ items: [{ a: 1, b: null }] })).toEqual({ items: [{ a: 1 }] });
  });
});

describe('reading what OpenAI answered', () => {
  it('validates the answer and reports what the call cost', async () => {
    vi.stubGlobal('fetch', respondWith({ reply: 'Xem lai phan doanh thu.' }));

    const result = await createOpenAiProvider(config).generate({
      system: 'You are a tutor.',
      prompt: 'Help',
      schema: tutorResponseSchema,
      responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
    });

    expect(result.value.reply).toBe('Xem lai phan doanh thu.');
    expect(result.model).toBe('gpt-4.1-mini');
    expect(result.promptTokens).toBe(11);
    expect(result.outputTokens).toBe(7);
  });

  it('accepts a null where the platform expects an absent field', async () => {
    // The same model answer must not be accepted by one vendor and rejected by
    // the other: strict mode has no way to leave `pointer` out.
    vi.stubGlobal('fetch', respondWith({ reply: 'Da ro.', pointer: null }));

    const result = await createOpenAiProvider(config).generate({
      system: 'You are a tutor.',
      prompt: 'Help',
      schema: tutorResponseSchema,
      responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
    });

    expect(result.value.pointer).toBeUndefined();
  });

  it('sends a strict schema, the system message and the key', async () => {
    const fetchMock = respondWith({ reply: 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    await createOpenAiProvider(config).generate({
      system: 'You are a tutor.',
      prompt: 'Help',
      schema: tutorResponseSchema,
      responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: unknown }[];
      response_format: { json_schema: { strict: boolean; schema: Record<string, unknown> } };
    };

    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a tutor.' });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it('sends a text attachment as text and an image as a data URL', async () => {
    const fetchMock = respondWith({ reply: 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    await createOpenAiProvider(config).generate({
      system: 'x',
      prompt: 'Read these',
      files: [
        { mimeType: 'text/markdown', data: Buffer.from('# Tinh huong').toString('base64') },
        { mimeType: 'image/png', data: 'aW1hZ2U=' },
        { mimeType: 'application/pdf', data: 'cGRm' },
      ],
      schema: tutorResponseSchema,
      responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: { content: Record<string, unknown>[] }[];
    };
    const parts = body.messages[1]?.content ?? [];

    expect(parts[1]).toEqual({ type: 'text', text: '# Tinh huong' });
    expect(parts[2]).toMatchObject({ type: 'image_url' });
    expect(parts[3]).toMatchObject({ type: 'file' });
  });

  it('refuses an answer that does not fit the shape it was asked for', async () => {
    vi.stubGlobal('fetch', respondWith({ pointer: 'page 4' }));

    await expect(
      createOpenAiProvider(config).generate({
        system: 'x',
        prompt: 'y',
        schema: tutorResponseSchema,
        responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
      }),
    ).rejects.toThrow(/reply/);
  });

  it('says why there was no answer rather than that it was empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'length' }] }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      createOpenAiProvider(config).generate({
        system: 'x',
        prompt: 'y',
        schema: z.object({ a: z.string() }),
        responseSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      }),
    ).rejects.toThrow(/length/);
  });

  it('carries the API error through instead of hiding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"model_not_found"}}', { status: 404 })),
    );

    await expect(
      createOpenAiProvider(config).generate({
        system: 'x',
        prompt: 'y',
        schema: tutorResponseSchema,
        responseSchema: TUTOR_RESPONSE_JSON_SCHEMA,
      }),
    ).rejects.toThrow(/model_not_found/);
  });
});
