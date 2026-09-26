import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_SETTINGS, type SystemSettings } from '@casestudyhub/shared';
import { readAiConfig, type AiCredentials } from '../ai/config';

/**
 * Which vendor answers, over which route, and with which credential.
 *
 * This is pure: the settings, the stored keys and the environment go in, a
 * configuration comes out. That is what makes the precedence between them
 * testable at all, and the precedence is what decides whether the model
 * answers.
 *
 * The rule with teeth is that no part of a credential reaches the page, so the
 * status this file derives is checked for leakage as well.
 */

function configOf(
  env: NodeJS.ProcessEnv,
  settings: Partial<SystemSettings> = {},
  credentials: AiCredentials = {},
) {
  return readAiConfig({ ...DEFAULT_SYSTEM_SETTINGS, ...settings }, credentials, env);
}

/** The same fields `aiStatus` publishes, derived the same way. */
function statusOf(
  env: NodeJS.ProcessEnv,
  settings: Partial<SystemSettings> = {},
  credentials: AiCredentials = {},
) {
  const config = configOf(env, settings, credentials);
  if (!config) {
    return {
      configured: false,
      provider: null,
      transport: null,
      model: null,
      location: null,
      environmentKey: false,
    };
  }
  return {
    configured: true,
    provider: config.provider,
    transport: config.transport,
    model: config.model,
    location: config.transport === 'vertex' ? config.location : null,
    environmentKey: config.fromEnvironment,
  };
}

describe('how the model is configured', () => {
  it('reports nothing configured when nothing is', () => {
    expect(statusOf({})).toEqual({
      configured: false,
      provider: null,
      transport: null,
      model: null,
      location: null,
      environmentKey: false,
    });
  });

  it('reports the Vertex route, with the region that decides the endpoint', () => {
    const status = statusOf(
      { GOOGLE_CLOUD_PROJECT: 'casestudy1-509414' },
      {
        aiEnabled: true,
        aiModels: { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini' },
        aiLocation: 'asia-southeast1',
      },
    );

    expect(status).toMatchObject({
      configured: true,
      provider: 'gemini',
      transport: 'vertex',
      model: 'gemini-2.5-flash',
      location: 'asia-southeast1',
    });
  });

  it('needs the project id as well as the switch, or Vertex has no endpoint', () => {
    expect(statusOf({}, { aiEnabled: true }).configured).toBe(false);
  });

  it('does not turn itself on just because a project id exists', () => {
    // Every Cloud Run deployment has one, so using it as the signal would
    // enable the model everywhere.
    expect(statusOf({ GOOGLE_CLOUD_PROJECT: 'casestudy1-509414' }).configured).toBe(false);
  });

  it('ignores the environment variable that a deploy used to wipe', () => {
    // VERTEX_AI_ENABLED was the switch until a deploy replaced the whole
    // variable set and turned the model off with nobody noticing. It is not
    // read any more; the setting is the only switch.
    expect(statusOf({ VERTEX_AI_ENABLED: 'true', GOOGLE_CLOUD_PROJECT: 'p' }).configured).toBe(
      false,
    );
  });

  it('is turned off by the setting alone, with no deploy involved', () => {
    const on = statusOf({ GOOGLE_CLOUD_PROJECT: 'p' }, { aiEnabled: true });
    const off = statusOf({ GOOGLE_CLOUD_PROJECT: 'p' }, { aiEnabled: false });
    expect(on.configured).toBe(true);
    expect(off.configured).toBe(false);
  });

  it('never carries any part of an API key out with it', () => {
    const status = statusOf({ GEMINI_API_KEY: 'AIzaSy-super-secret-value' });

    expect(status.transport).toBe('apiKey');
    expect(JSON.stringify(status)).not.toContain('AIzaSy');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('prefers the API key when both are set, as the provider does', () => {
    const status = statusOf(
      { GEMINI_API_KEY: 'AIzaSy-key', GOOGLE_CLOUD_PROJECT: 'p' },
      { aiEnabled: true },
    );
    // Status that disagreed with the provider would send somebody looking in
    // the wrong place.
    expect(status.transport).toBe('apiKey');
  });
});

describe('choosing a vendor', () => {
  it('calls OpenAI with the key an administrator stored', () => {
    const config = configOf(
      {},
      { aiEnabled: true, aiProvider: 'openai' },
      { openai: 'sk-stored-key' },
    );

    expect(config).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      transport: 'apiKey',
      apiKey: 'sk-stored-key',
      fromEnvironment: false,
    });
  });

  it('uses each vendor its own model name', () => {
    const settings = {
      aiEnabled: true,
      aiModels: { gemini: 'gemini-2.5-pro', openai: 'gpt-4.1' },
    } as const;

    expect(configOf({ GOOGLE_CLOUD_PROJECT: 'p' }, { ...settings })?.model).toBe('gemini-2.5-pro');
    expect(configOf({}, { ...settings, aiProvider: 'openai' }, { openai: 'sk-x' })?.model).toBe(
      'gpt-4.1',
    );
  });

  it('does not reach for the other vendor when the chosen one has no key', () => {
    // Falling back would mean a class was marked by a model nobody chose.
    const config = configOf(
      { GOOGLE_CLOUD_PROJECT: 'p' },
      { aiEnabled: true, aiProvider: 'openai' },
      { gemini: 'AIzaSy-key' },
    );
    expect(config).toBeNull();
  });

  it('leaves a stored key unused while the switch is off', () => {
    expect(
      configOf({}, { aiEnabled: false, aiProvider: 'openai' }, { openai: 'sk-stored' }),
    ).toBeNull();
  });

  it('knows a key it was handed by a deploy from one typed into the page', () => {
    // The on/off switch is shown or hidden by this, so getting it wrong means
    // a switch that does nothing or a model nobody can turn off.
    expect(configOf({ OPENAI_API_KEY: 'sk-env' }, { aiProvider: 'openai' })?.fromEnvironment).toBe(
      true,
    );
    expect(
      configOf({}, { aiEnabled: true, aiProvider: 'openai' }, { openai: 'sk-stored' })
        ?.fromEnvironment,
    ).toBe(false);
  });

  it('does not let a model name left on the service reach the wrong vendor', () => {
    // A deploy set AI_MODEL=gemini-2.5-flash back when there was one vendor,
    // and --update-env-vars keeps it there for ever. Honouring it would send a
    // Gemini name to OpenAI, which fails as `model_not_found` and reads like a
    // broken key. The model belongs to the vendor it was written for.
    const env = { AI_MODEL: 'gemini-2.5-flash' };

    expect(
      configOf(env, { aiEnabled: true, aiProvider: 'openai' }, { openai: 'sk-stored' })?.model,
    ).toBe('gpt-4.1-mini');
    expect(configOf({ ...env, GOOGLE_CLOUD_PROJECT: 'p' }, { aiEnabled: true })?.model).toBe(
      'gemini-2.5-flash',
    );
  });

  it('takes the model an administrator typed, not one a deploy left behind', () => {
    const config = configOf(
      { AI_MODEL: 'gemini-2.5-flash' },
      {
        aiEnabled: true,
        aiProvider: 'openai',
        aiModels: { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1' },
      },
      { openai: 'sk-stored' },
    );
    expect(config?.model).toBe('gpt-4.1');
  });

  it('still lets the environment key turn OpenAI on by itself', () => {
    // Set by whoever deploys, who is already trusted with more than this, and
    // it is how the platform gets tried in ten minutes.
    const config = configOf({ OPENAI_API_KEY: 'sk-env' }, { aiProvider: 'openai' });
    expect(config).toMatchObject({ provider: 'openai', apiKey: 'sk-env' });
  });

  it('prefers the environment key over the stored one', () => {
    const config = configOf(
      { OPENAI_API_KEY: 'sk-env' },
      { aiEnabled: true, aiProvider: 'openai' },
      { openai: 'sk-stored' },
    );
    expect(config).toMatchObject({ apiKey: 'sk-env' });
  });

  it('lets Gemini be reached by a stored key instead of Vertex', () => {
    const config = configOf(
      { GOOGLE_CLOUD_PROJECT: 'p' },
      { aiEnabled: true, aiGeminiTransport: 'apiKey' },
      { gemini: 'AIzaSy-stored' },
    );
    expect(config).toMatchObject({ provider: 'gemini', transport: 'apiKey' });
  });

  it('does not silently use Vertex when the key route was chosen and no key is there', () => {
    const config = configOf(
      { GOOGLE_CLOUD_PROJECT: 'p' },
      { aiEnabled: true, aiGeminiTransport: 'apiKey' },
    );
    expect(config).toBeNull();
  });
});
