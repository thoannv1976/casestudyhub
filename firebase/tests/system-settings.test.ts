import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Platform settings, against the real database.
 *
 * The one with money behind it is the model budget: it is the number that
 * decides what the faculty is billed, so what is checked here is that it is
 * counted at all, counted once per call, and that it actually refuses.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  getSystemSettings,
  saveSystemSettings,
  clearSettingsCache,
  currentAiUsage,
  recordAiCall,
  platformMetrics,
  setAiProvider,
  getAiProvider,
  AiBudgetSpentError,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_SYSTEM_SETTINGS, SYSTEM_SETTINGS_ID, usagePeriodOf } =
  await import('@casestudyhub/shared');

const admin = { uid: 'sys_admin', email: 'admin@x.edu.vn', role: 'admin' as const };
const REASON = 'Closing registration now that the term has started.';

/** A provider that never reaches a network and always answers. */
function fakeProvider(calls: { count: number }) {
  return {
    name: 'fake',
    model: 'fake-1',
    async generate<T>(request: { schema: { parse: (value: unknown) => T } }): Promise<{
      value: T;
      model: string;
      promptTokens: number;
      outputTokens: number;
      latencyMs: number;
    }> {
      calls.count += 1;
      return {
        value: request.schema.parse({ ok: true }),
        model: 'fake-1',
        promptTokens: 100,
        outputTokens: 20,
        latencyMs: 1,
      };
    },
  };
}

async function wipe() {
  const db = getDb();
  await db.collection(COLLECTIONS.systemSettings).doc(SYSTEM_SETTINGS_ID).delete();
  const usage = await db.collection(COLLECTIONS.aiUsage).get();
  await Promise.all(usage.docs.map((doc) => doc.ref.delete()));
  const logs = await db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', admin.uid).get();
  await Promise.all(logs.docs.map((doc) => doc.ref.delete()));
  clearSettingsCache();
  setAiProvider(null);
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(wipe);
afterAll(wipe);

describe('settings a deployment has never touched', () => {
  it('runs on the defaults rather than failing', async () => {
    expect(await getSystemSettings()).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it('ignores a stored document that no longer satisfies its own schema', async () => {
    await getDb()
      .collection(COLLECTIONS.systemSettings)
      .doc(SYSTEM_SETTINGS_ID)
      .set({ maxImportKb: -5, aiMonthlyCallBudget: 'plenty' });
    clearSettingsCache();

    // Falling back is right here: a broken settings document must not stop
    // students signing in.
    expect(await getSystemSettings()).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });
});

describe('changing a setting', () => {
  it('takes effect at once, unlike the assessment framework', async () => {
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, registrationOpen: false },
      REASON,
    );
    expect((await getSystemSettings()).registrationOpen).toBe(false);
  });

  it('records what changed, from what to what, and why', async () => {
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiMonthlyCallBudget: 20 },
      REASON,
    );

    const logs = await getDb()
      .collection(COLLECTIONS.auditLogs)
      .where('actorUid', '==', admin.uid)
      .get();
    const entry = logs.docs
      .map((doc) => doc.data())
      .find((row) => row.action === 'system.setting_changed');

    expect(entry?.before).toMatchObject({ aiMonthlyCallBudget: 500 });
    expect(entry?.after).toMatchObject({ aiMonthlyCallBudget: 20 });
    expect(entry?.reason).toBe(REASON);
  });
});

describe('the model budget', () => {
  it('counts a call once, with the tokens it used', async () => {
    await recordAiCall({ promptTokens: 100, outputTokens: 20 });
    await recordAiCall({ promptTokens: 50, outputTokens: 10 });

    const usage = await currentAiUsage();
    expect(usage.calls).toBe(2);
    expect(usage.promptTokens).toBe(150);
    expect(usage.outputTokens).toBe(30);
    expect(usage.period).toBe(usagePeriodOf(Date.now()));
  });

  it('counts each month separately, so a budget resets rather than accumulating', async () => {
    const march = Date.parse('2026-03-15T00:00:00.000Z');
    const april = Date.parse('2026-04-01T00:00:00.000Z');

    await recordAiCall({ promptTokens: 10, outputTokens: 1 }, march);
    await recordAiCall({ promptTokens: 10, outputTokens: 1 }, april);

    expect((await currentAiUsage(march)).calls).toBe(1);
    expect((await currentAiUsage(april)).calls).toBe(1);
  });

  it('counts every call made through the gateway, whatever asked for it', async () => {
    const calls = { count: 0 };
    setAiProvider(fakeProvider(calls));

    const schema = { parse: (value: unknown) => value } as never;
    await getAiProvider().generate({ schema, system: '', prompt: '', responseSchema: {} });
    await getAiProvider().generate({ schema, system: '', prompt: '', responseSchema: {} });

    expect(calls.count).toBe(2);
    expect((await currentAiUsage()).calls).toBe(2);
    expect((await currentAiUsage()).promptTokens).toBe(200);
  });

  it('refuses once the month’s budget is spent, and says so specifically', async () => {
    await saveSystemSettings(admin, { ...DEFAULT_SYSTEM_SETTINGS, aiMonthlyCallBudget: 1 }, REASON);

    const calls = { count: 0 };
    setAiProvider(fakeProvider(calls));
    const schema = { parse: (value: unknown) => value } as never;

    await getAiProvider().generate({ schema, system: '', prompt: '', responseSchema: {} });
    await expect(
      getAiProvider().generate({ schema, system: '', prompt: '', responseSchema: {} }),
    ).rejects.toBeInstanceOf(AiBudgetSpentError);

    // The refused call never reached the model, so it cost nothing.
    expect(calls.count).toBe(1);
  });

  it('stops the AI features entirely at zero, without unsetting any credential', async () => {
    await saveSystemSettings(admin, { ...DEFAULT_SYSTEM_SETTINGS, aiMonthlyCallBudget: 0 }, REASON);

    const calls = { count: 0 };
    setAiProvider(fakeProvider(calls));
    const schema = { parse: (value: unknown) => value } as never;

    await expect(
      getAiProvider().generate({ schema, system: '', prompt: '', responseSchema: {} }),
    ).rejects.toBeInstanceOf(AiBudgetSpentError);
    expect(calls.count).toBe(0);
  });
});

describe('what the administrator is shown', () => {
  it('counts what the platform holds without reading every document', async () => {
    const metrics = await platformMetrics();

    expect(metrics.users.student).toBeGreaterThanOrEqual(0);
    expect(metrics.ai.budget).toBe(DEFAULT_SYSTEM_SETTINGS.aiMonthlyCallBudget);
    expect(metrics.ai.calls).toBe(0);
  });

  it('shows the budget the administrator set, not the shipped one', async () => {
    await saveSystemSettings(
      admin,
      { ...DEFAULT_SYSTEM_SETTINGS, aiMonthlyCallBudget: 42 },
      REASON,
    );
    expect((await platformMetrics()).ai.budget).toBe(42);
  });
});
