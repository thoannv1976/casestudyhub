import { AiBudgetSpentError, AiNotConfiguredError, type AiProvider } from './provider';
import { readAiConfig, type AiConfig } from './config';
import { createGeminiProvider } from './gemini';
import { createOpenAiProvider } from './openai';
import {
  currentAiUsage,
  getAiCredentials,
  getSystemSettings,
  recordAiCall,
} from '../settings/settings';

/**
 * The one door to a model.
 *
 * Every AI feature in the platform comes through here, which is what makes
 * three things true at once: the monthly budget is enforced in one place
 * rather than at each of the five call sites; the vendor is chosen in one
 * place, so no feature knows or cares which one answered; and a test injects a
 * provider here and never reaches a network.
 */

export async function currentAiConfig(): Promise<AiConfig | null> {
  const [settings, credentials] = await Promise.all([getSystemSettings(), getAiCredentials()]);
  return readAiConfig(settings, credentials);
}

export async function isAiConfigured(): Promise<boolean> {
  return (await currentAiConfig()) !== null;
}

function providerFor(config: AiConfig): AiProvider {
  return config.provider === 'openai' ? createOpenAiProvider(config) : createGeminiProvider(config);
}

/**
 * The month's budget, enforced around whichever provider was chosen.
 *
 * The count is written after the call returns: a call that failed cost
 * nothing. A burst of parallel calls can therefore cross the budget by however
 * many were already in flight, which is the right trade. A budget is there to
 * stop a runaway, not to be exact to the single call.
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
  const config = await currentAiConfig();
  if (!config) throw new AiNotConfiguredError();
  return metered(providerFor(config));
}

export async function aiIsAvailable(): Promise<boolean> {
  return override !== null || (await isAiConfigured());
}
