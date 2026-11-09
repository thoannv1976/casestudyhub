import {
  submitBulkResult,
  submitResult,
  type BulkInput,
  type BulkResponse,
  type ResultInput,
  type SubmitResponse,
} from './hub-sdk';

/**
 * Runtime switches for the Moodle connection. Off unless LTI_ENABLED=true, so
 * a deploy without the settings behaves exactly as before.
 *
 *   LTI_ENABLED      `true` to turn it on
 *   LTI_HUB_URL      UniGame Hub base URL (the issuer of launch tickets)
 *   LTI_GAME_ID      this app's id in the Hub catalogue (default `casestudyhub`)
 *   LTI_GAME_SECRET  shared secret for signing results (Secret Manager)
 *   LTI_TENANTS      optional comma list of Hub tenants allowed in, e.g. `aiedu2026`
 *
 * Read from the environment on each call rather than through the validated
 * server env: none of them is required, and a missing one must switch the
 * feature off, not stop the server.
 */
export interface LtiConfig {
  enabled: boolean;
  hubUrl: string;
  gameId: string;
  secret: string;
  tenants: string[];
}

export function ltiConfig(): LtiConfig {
  return {
    enabled: process.env.LTI_ENABLED === 'true',
    hubUrl: (process.env.LTI_HUB_URL ?? '').replace(/\/+$/, ''),
    gameId: process.env.LTI_GAME_ID || 'casestudyhub',
    secret: process.env.LTI_GAME_SECRET ?? '',
    tenants: (process.env.LTI_TENANTS ?? '')
      .split(',')
      .map((tenant) => tenant.trim())
      .filter(Boolean),
  };
}

export function isLtiEnabled(): boolean {
  const config = ltiConfig();
  return config.enabled && Boolean(config.hubUrl);
}

/** The two calls that leave this app for the Hub. Tests pass a fake. */
export interface LtiHubClient {
  submitResult(result: ResultInput): Promise<SubmitResponse>;
  submitBulkResult(batch: BulkInput): Promise<BulkResponse>;
}

/** The real Hub, or null when results cannot be signed (no secret). */
export function defaultHubClient(): LtiHubClient | null {
  const config = ltiConfig();
  if (!config.secret || !config.hubUrl) return null;
  const options = { hubUrl: config.hubUrl, gameId: config.gameId, secret: config.secret };
  return {
    submitResult: (result) => submitResult(options, result),
    submitBulkResult: (batch) => submitBulkResult(options, batch),
  };
}
