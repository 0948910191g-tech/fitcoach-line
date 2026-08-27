import { describe, expect, it, vi } from 'vitest';
import { createLineExchangeHandler } from './route';

type TestClient = Awaited<
  ReturnType<Parameters<typeof createLineExchangeHandler>[0]['createClient']>
>;

describe('LINE OAuth exchange', () => {
  it('starts login with the LINE OAuth2 provider', async () => {
    const signInWithOAuth = vi.fn(async () => ({
      data: { url: 'https://example.com/line-login' },
      error: null,
    }));

    const handler = createLineExchangeHandler({
      callbackUrl: 'http://localhost:3000/api/auth/line/exchange',
      createClient: async () =>
        ({
          auth: {
            signInWithOAuth,
            exchangeCodeForSession: vi.fn(),
            getUser: vi.fn(),
          },
          rpc: vi.fn(),
      }) as unknown as TestClient,
    });

    const response = await handler(
      new Request('http://localhost:3000/api/auth/line/exchange'),
    );

    expect(response.status).toBe(302);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'custom:line-oauth',
      options: {
        redirectTo: 'http://localhost:3000/api/auth/line/exchange',
        scopes: 'openid profile',
      },
    });
  });
});

describe('LINE OAuth identity linking', () => {
  it('accepts a verified custom:line-oauth identity after callback', async () => {
    const handler = createLineExchangeHandler({
      callbackUrl: 'http://localhost:3000/api/auth/line/exchange',
      createClient: async () =>
        ({
          auth: {
            signInWithOAuth: vi.fn(),
            exchangeCodeForSession: vi.fn(async () => ({ error: null })),
            getUser: vi.fn(async () => ({
              data: { user: { id: 'auth-user-1' } },
              error: null,
            })),
          },
          rpc: vi.fn(async () => ({
            data: [
              {
                user_id: 'app-user-1',
                auth_user_id: 'auth-user-1',
                provider: 'custom:line-oauth',
                provider_id: 'U123456',
                line_user_id: 'U123456',
              },
            ],
            error: null,
          })),
        }) as unknown as TestClient,
    });

    const response = await handler(
      new Request(
        'http://localhost:3000/api/auth/line/exchange?code=verified-code',
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/onboarding',
    );
  });
});

describe('LINE OAuth callback errors', () => {
  it('does not restart login when the provider callback contains an error', async () => {
    const signInWithOAuth = vi.fn(async () => ({
      data: { url: 'https://example.com/line-login' },
      error: null,
    }));

    const handler = createLineExchangeHandler({
      callbackUrl: 'http://localhost:3000/api/auth/line/exchange',
      createClient: async () =>
        ({
          auth: {
            signInWithOAuth,
            exchangeCodeForSession: vi.fn(),
            getUser: vi.fn(),
          },
          rpc: vi.fn(),
      }) as unknown as TestClient,
    });

    const response = await handler(
      new Request(
        'http://localhost:3000/api/auth/line/exchange?error=server_error&error_code=unexpected_failure',
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'line_oauth_callback_error',
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});
