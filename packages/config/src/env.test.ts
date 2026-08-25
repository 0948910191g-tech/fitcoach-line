import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('getServerEnv', () => {
  it('rejects a missing SUPABASE_URL without exposing secret values', async () => {
    process.env = {
      ...originalEnv,
      APP_URL: 'https://app.example.test',
      LIFF_URL: 'https://liff.example.test',
      LINE_CHANNEL_SECRET: 'line-secret-value',
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token-value',
      OWNER_LINE_USER_IDS: 'U-owner',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: 'anon-key-value',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
      CODEX_PROVIDER_ENABLED: 'true',
      CODEX_LUNA_MODEL: 'luna-model',
      CODEX_TERRA_MODEL: 'terra-model',
      SENTRY_DSN: 'https://public@example.test/1'
    };

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { getServerEnv } = await import('./env');

    let thrown: unknown;
    try {
      getServerEnv(process.env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain('SUPABASE_URL');

    const observableOutput = [
      String(thrown),
      ...consoleError.mock.calls.flat().map(String),
      ...consoleWarn.mock.calls.flat().map(String),
      ...consoleLog.mock.calls.flat().map(String)
    ].join('\n');

    expect(observableOutput).not.toContain('line-secret-value');
    expect(observableOutput).not.toContain('line-token-value');
    expect(observableOutput).not.toContain('service-role-secret-value');
  });
});
