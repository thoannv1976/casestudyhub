import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_MODELS, systemSettingsSchema } from '@casestudyhub/shared';
import { readAiConfig } from '../ai/config';

/** Claude (Anthropic) as the third vendor, under the same rules as the other two. */
describe('choosing Claude', () => {
  const settings = (patch: Record<string, unknown>) => systemSettingsSchema.parse(patch);

  it('uses a key typed into the administration page while the switch is on', () => {
    const config = readAiConfig(
      settings({ aiEnabled: true, aiProvider: 'anthropic' }),
      { anthropic: 'sk-ant-stored' },
      {},
    );
    expect(config).toMatchObject({
      provider: 'anthropic',
      model: DEFAULT_AI_MODELS.anthropic,
      apiKey: 'sk-ant-stored',
      fromEnvironment: false,
    });
  });

  it('leaves the stored key unused while the switch is off', () => {
    expect(
      readAiConfig(
        settings({ aiEnabled: false, aiProvider: 'anthropic' }),
        { anthropic: 'sk-ant-stored' },
        {},
      ),
    ).toBeNull();
  });

  it('lets a key set by the deploy turn it on by itself', () => {
    const config = readAiConfig(
      settings({ aiProvider: 'anthropic' }),
      {},
      {
        ANTHROPIC_API_KEY: 'sk-ant-env',
      },
    );
    expect(config).toMatchObject({ provider: 'anthropic', fromEnvironment: true });
  });

  it('does not borrow another vendor’s key', () => {
    expect(
      readAiConfig(settings({ aiEnabled: true, aiProvider: 'anthropic' }), { openai: 'sk-x' }, {}),
    ).toBeNull();
  });

  it('keeps its own model name', () => {
    const config = readAiConfig(
      settings({
        aiEnabled: true,
        aiProvider: 'anthropic',
        aiModels: { gemini: 'g', openai: 'o', anthropic: 'claude-sonnet-5-5' },
      }),
      { anthropic: 'sk-ant' },
      {},
    );
    expect(config?.model).toBe('claude-sonnet-5-5');
  });
});
