import { describe, expect, it } from 'vitest';
import { readGeminiConfig } from '../ai/vertex';

/**
 * What the administration page is allowed to say about the model.
 *
 * The rule with teeth here is that no part of a credential reaches the page.
 * `aiStatus` reads the same configuration the provider does, so the one thing
 * worth proving is that it drops the secret on the way out.
 */

function statusOf(env: NodeJS.ProcessEnv) {
  const config = readGeminiConfig(env);
  if (!config) return { configured: false, transport: null, model: null, location: null };
  return {
    configured: true,
    transport: config.transport,
    model: config.model,
    location: config.location ?? null,
  };
}

describe('how the model is configured', () => {
  it('reports nothing configured when nothing is', () => {
    expect(statusOf({})).toEqual({
      configured: false,
      transport: null,
      model: null,
      location: null,
    });
  });

  it('reports the Vertex route, with the region that decides the endpoint', () => {
    const status = statusOf({
      VERTEX_AI_ENABLED: 'true',
      GOOGLE_CLOUD_PROJECT: 'casestudy1-509414',
      VERTEX_AI_LOCATION: 'asia-southeast1',
      AI_MODEL: 'gemini-2.5-flash',
    });

    expect(status).toMatchObject({
      configured: true,
      transport: 'vertex',
      model: 'gemini-2.5-flash',
      location: 'asia-southeast1',
    });
  });

  it('needs the project id as well as the switch, or Vertex has no endpoint', () => {
    expect(statusOf({ VERTEX_AI_ENABLED: 'true' }).configured).toBe(false);
  });

  it('does not turn itself on just because a project id exists', () => {
    // Every Cloud Run deployment has one, so using it as the signal would
    // enable the model everywhere.
    expect(statusOf({ GOOGLE_CLOUD_PROJECT: 'casestudy1-509414' }).configured).toBe(false);
  });

  it('never carries any part of an API key out with it', () => {
    const status = statusOf({ GEMINI_API_KEY: 'AIzaSy-super-secret-value' });

    expect(status.transport).toBe('apiKey');
    expect(JSON.stringify(status)).not.toContain('AIzaSy');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('prefers the API key when both are set, as the provider does', () => {
    const status = statusOf({
      GEMINI_API_KEY: 'AIzaSy-key',
      VERTEX_AI_ENABLED: 'true',
      GOOGLE_CLOUD_PROJECT: 'p',
    });
    // Status that disagreed with the provider would send somebody looking in
    // the wrong place.
    expect(status.transport).toBe('apiKey');
  });
});
