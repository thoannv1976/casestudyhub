import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Choosing a vendor and storing its key, against the real database.
 *
 * The pure precedence rules are covered by unit tests. What needs a database
 * is the credential itself: that it is stored where a client cannot reach it,
 * that the status the administration page gets carries no part of it, and that
 * the audit log records the change without recording the key.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  getSystemSettings,
  saveSystemSettings,
  saveAiCredential,
  getAiCredentials,
  aiCredentialStatus,
  currentAiConfig,
  aiStatus,
  setAiProvider,
  getAiProvider,
  probeAi,
} = await import('@casestudyhub/core');
const { AI_CREDENTIALS_ID, COLLECTIONS, DEFAULT_SYSTEM_SETTINGS, SYSTEM_SETTINGS_ID } =
  await import('@casestudyhub/shared');

const admin = { uid: 'aip_admin', email: 'admin@x.edu.vn', role: 'admin' as const };
const OPENAI_KEY = 'sk-proj-abcdefghijklmnop9876';
const REASON = 'Pointing the platform at OpenAI for this term.';

/** The environment decides some of this, so tests start from a clean one. */
const CLEARED_ENV = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'AI_MODEL'] as const;
const savedEnv: Record<string, string | undefined> = {};

async function wipe() {
  const db = getDb();
  await db.collection(COLLECTIONS.systemSettings).doc(SYSTEM_SETTINGS_ID).delete();
  await db.collection(COLLECTIONS.systemSettings).doc(AI_CREDENTIALS_ID).delete();
  const logs = await db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', admin.uid).get();
  await Promise.all(logs.docs.map((doc) => doc.ref.delete()));
  // Cleared between tests too: a month's call count that survives the previous
  // test is the previous test's answer.
  const usage = await db.collection(COLLECTIONS.aiUsage).get();
  await Promise.all(usage.docs.map((doc) => doc.ref.delete()));
  setAiProvider(null);
}

async function auditEntries(action: string) {
  const snapshot = await getDb()
    .collection(COLLECTIONS.auditLogs)
    .where('actorUid', '==', admin.uid)
    .get();
  return snapshot.docs.map((doc) => doc.data()).filter((entry) => entry.action === action);
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
  for (const name of CLEARED_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  for (const name of CLEARED_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe('storing an API key', () => {
  it('keeps it out of the settings document every feature reads', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);

    const settings = await getDb()
      .collection(COLLECTIONS.systemSettings)
      .doc(SYSTEM_SETTINGS_ID)
      .get();
    expect(JSON.stringify(settings.data() ?? {})).not.toContain('sk-proj');
    expect(JSON.stringify(await getSystemSettings())).not.toContain('sk-proj');
  });

  it('tells the page which key is stored without telling it the key', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);

    const status = await aiCredentialStatus();
    expect(status.openai.set).toBe(true);
    expect(status.openai.hint).toBe('9876');
    expect(JSON.stringify(status)).not.toContain('sk-proj');
    expect(status.gemini.set).toBe(false);
  });

  it('records that a key changed, never what it changed to', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);

    const entries = await auditEntries('ai.configuration_changed');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.after).toEqual({ provider: 'openai', key: 'set' });
    expect(JSON.stringify(entries[0])).not.toContain('sk-proj');
  });

  it('keeps each vendor its own key', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveAiCredential(admin, 'gemini', 'AIzaSy-gemini-key');

    expect(await getAiCredentials()).toEqual({
      openai: OPENAI_KEY,
      gemini: 'AIzaSy-gemini-key',
    });
  });

  it('clears one vendor without touching the other', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveAiCredential(admin, 'gemini', 'AIzaSy-gemini-key');
    await saveAiCredential(admin, 'openai', null);

    const credentials = await getAiCredentials();
    expect(credentials.openai).toBeUndefined();
    expect(credentials.gemini).toBe('AIzaSy-gemini-key');
    expect((await aiCredentialStatus()).openai.set).toBe(false);
  });
});

describe('the vendor the platform ends up calling', () => {
  it('is OpenAI once it is chosen, turned on and given a key', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: true, aiProvider: 'openai' },
      REASON,
    );

    expect(await currentAiConfig()).toMatchObject({
      provider: 'openai',
      transport: 'apiKey',
      apiKey: OPENAI_KEY,
    });
  });

  it('is nobody when the vendor is chosen but no key was stored', async () => {
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: true, aiProvider: 'openai' },
      REASON,
    );
    expect(await currentAiConfig()).toBeNull();
  });

  it('reports the vendor on the page without any part of the key', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      {
        ...DEFAULT_SYSTEM_SETTINGS,
        aiEnabled: true,
        aiProvider: 'openai',
        aiModels: { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini' },
      },
      REASON,
    );

    const status = await aiStatus();
    expect(status).toEqual({
      configured: true,
      provider: 'openai',
      transport: 'apiKey',
      model: 'gpt-4.1-mini',
      location: null,
      environmentKey: false,
    });
    expect(JSON.stringify(status)).not.toContain('sk-proj');
  });

  it('goes back to Gemini over Vertex when that is chosen again', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: true, aiProvider: 'gemini' },
      REASON,
    );

    // The OpenAI key is still stored and still unused: switching vendor is the
    // only thing that decides who answers.
    expect(await currentAiConfig()).toMatchObject({ provider: 'gemini', transport: 'vertex' });
  });

  it('survives a settings document written before the vendor setting existed', async () => {
    // The deployment in production has one of these. It must keep working, on
    // Gemini, rather than reading as "no model configured".
    await getDb().collection(COLLECTIONS.systemSettings).doc(SYSTEM_SETTINGS_ID).set({
      registrationOpen: true,
      maxImportKb: 512,
      aiMonthlyCallBudget: 500,
      aiEnabled: true,
      aiModel: 'gemini-2.5-flash',
      aiLocation: 'global',
    });

    expect(await currentAiConfig()).toMatchObject({
      provider: 'gemini',
      transport: 'vertex',
      model: 'gemini-2.5-flash',
    });
  });
});

describe('the whole way from the administration page to the vendor', () => {
  /**
   * The link nothing else covers: a key an administrator typed in reaching the
   * HTTP request, with the model they chose, over the vendor's own endpoint.
   *
   * `fetch` is replaced, so nothing here leaves the machine. Everything before
   * it is real - the key is read out of Firestore, the settings decide the
   * vendor, and the call goes through the gateway that counts the month's
   * budget, exactly as a lecturer pressing the button would.
   */
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function captureFetch(calls: { url: string; init: RequestInit }[], body: unknown) {
    return vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  }

  const OPENAI_ANSWER = {
    choices: [{ message: { content: JSON.stringify({ answer: 'ready' }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 2 },
  };

  it('sends the stored OpenAI key, and the model the administrator chose', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      {
        ...DEFAULT_SYSTEM_SETTINGS,
        aiEnabled: true,
        aiProvider: 'openai',
        aiModels: { gemini: 'gemini-2.5-flash', openai: 'gpt-4.1' },
      },
      REASON,
    );

    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', captureFetch(calls, OPENAI_ANSWER));

    const probe = await probeAi();
    expect(probe.ok).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${OPENAI_KEY}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe('gpt-4.1');
  });

  it('counts the call against the month, as any other call would', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: true, aiProvider: 'openai' },
      REASON,
    );

    vi.stubGlobal('fetch', captureFetch([], OPENAI_ANSWER));
    await probeAi();

    const usage = await getDb()
      .collection(COLLECTIONS.aiUsage)
      .doc(new Date().toISOString().slice(0, 7))
      .get();
    expect(usage.get('calls')).toBe(1);
  });

  it('sends a stored Gemini key to Google, in Google’s own header', async () => {
    await saveAiCredential(admin, 'gemini', 'AIzaSy-stored-key');
    await saveSystemSettings(
      admin,
      {
        ...DEFAULT_SYSTEM_SETTINGS,
        aiEnabled: true,
        aiProvider: 'gemini',
        aiGeminiTransport: 'apiKey',
      },
      REASON,
    );

    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      captureFetch(calls, {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'ready' }) }] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 },
      }),
    );

    const probe = await probeAi();
    expect(probe.ok).toBe(true);
    expect(calls[0]?.url).toContain('generativelanguage.googleapis.com');
    expect(calls[0]?.url).toContain('gemini-2.5-flash');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'AIzaSy-stored-key',
    );
  });

  it('refuses to call anything when the key was cleared', async () => {
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: true, aiProvider: 'openai' },
      REASON,
    );
    await saveAiCredential(admin, 'openai', null);

    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', captureFetch(calls, OPENAI_ANSWER));

    await expect(getAiProvider()).rejects.toThrow(/No AI model is configured/);
    // And nothing was attempted: a missing key is not a failed call.
    expect(calls).toEqual([]);
  });

  it('reports the vendor as not configured while the switch is off', async () => {
    // The key is stored and still unused: the switch is what turns it on.
    await saveAiCredential(admin, 'openai', OPENAI_KEY);
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiEnabled: false, aiProvider: 'openai' },
      REASON,
    );

    const probe = await probeAi();
    expect(probe).toMatchObject({ ok: false, reason: 'notConfigured' });
  });
});
