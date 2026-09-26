import { DEFAULT_AI_MODELS, type AiProviderName, type SystemSettings } from '@casestudyhub/shared';

/**
 * What this deployment is configured to call, if anything.
 *
 * The rules are worth stating in one place, because they decide whether the
 * model answers at all:
 *
 * - An API key in the environment wins over everything and turns the model on
 *   by itself. It is how somebody tries the platform in ten minutes, and it is
 *   set by whoever deploys, who is already trusted with more than this.
 * - Otherwise `aiEnabled` is the switch. It lives in the settings document
 *   rather than the environment because a deploy once replaced the whole
 *   variable set and turned the model off with nobody noticing.
 * - A key an administrator typed in is used only while that switch is on. It
 *   is a stored credential, not a deployment decision.
 *
 * Nothing here reads the database; it is a pure function of the settings, the
 * stored credentials and the environment, so the precedence above is covered
 * by unit tests rather than by an emulator.
 */

export interface AiCredentials {
  gemini?: string;
  openai?: string;
}

export type AiConfig =
  | {
      provider: 'gemini';
      model: string;
      transport: 'vertex';
      projectId: string;
      location: string;
      /** Vertex uses the service account, so no credential was read anywhere. */
      fromEnvironment: false;
    }
  | {
      provider: 'gemini';
      model: string;
      transport: 'apiKey';
      apiKey: string;
      /**
       * Whether the key came from the environment rather than from the
       * administration page. It decides whether the on/off switch means
       * anything: an environment key turns the model on by itself, so a switch
       * beside it would be a switch that does nothing.
       */
      fromEnvironment: boolean;
    }
  | {
      provider: 'openai';
      model: string;
      transport: 'apiKey';
      apiKey: string;
      fromEnvironment: boolean;
    };

type AiSettings = Pick<
  SystemSettings,
  'aiEnabled' | 'aiProvider' | 'aiGeminiTransport' | 'aiModels' | 'aiLocation'
>;

function modelFor(settings: AiSettings, provider: AiProviderName): string {
  return settings.aiModels?.[provider] || DEFAULT_AI_MODELS[provider];
}

export function readAiConfig(
  settings: AiSettings,
  credentials: AiCredentials = {},
  env: NodeJS.ProcessEnv = process.env,
): AiConfig | null {
  const provider = settings.aiProvider ?? 'gemini';

  if (provider === 'openai') {
    const model = env.AI_MODEL?.trim() || modelFor(settings, 'openai');
    const fromEnv = env.OPENAI_API_KEY?.trim();
    if (fromEnv) {
      return { provider, model, transport: 'apiKey', apiKey: fromEnv, fromEnvironment: true };
    }

    if (!settings.aiEnabled) return null;
    const stored = credentials.openai?.trim();
    return stored
      ? { provider, model, transport: 'apiKey', apiKey: stored, fromEnvironment: false }
      : null;
  }

  const model = env.AI_MODEL?.trim() || modelFor(settings, 'gemini');
  const fromEnv = env.GEMINI_API_KEY?.trim();
  if (fromEnv) {
    return {
      provider: 'gemini',
      model,
      transport: 'apiKey',
      apiKey: fromEnv,
      fromEnvironment: true,
    };
  }

  if (!settings.aiEnabled) return null;

  if (settings.aiGeminiTransport === 'apiKey') {
    const stored = credentials.gemini?.trim();
    return stored
      ? { provider: 'gemini', model, transport: 'apiKey', apiKey: stored, fromEnvironment: false }
      : null;
  }

  // The project id is always present on Cloud Run, so it can never be the
  // signal on its own - the switch above is.
  const projectId = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) return null;

  return {
    provider: 'gemini',
    model,
    transport: 'vertex',
    projectId,
    location: settings.aiLocation || 'global',
    fromEnvironment: false,
  };
}
