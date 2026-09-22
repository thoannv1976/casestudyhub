import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv, isEmulated, resetServerEnvCache } from '../env';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetServerEnvCache();
});

describe('getServerEnv', () => {
  it('accepts a valid environment', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'casestudy1-509414';
    process.env.FIREBASE_STORAGE_BUCKET = 'casestudy1-509414.firebasestorage.app';
    expect(getServerEnv().GOOGLE_CLOUD_PROJECT).toBe('casestudy1-509414');
  });

  it('names the missing variables instead of failing silently', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    resetServerEnvCache();
    expect(() => getServerEnv()).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it('detects the emulator', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    expect(isEmulated()).toBe(false);
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    expect(isEmulated()).toBe(true);
  });
});
