import { describe, expect, it } from 'vitest';

type ThreadOptions = {
  model?: string;
  sandboxMode?: string;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  approvalPolicy?: string;
};

type Input = string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>;

type TurnOptions = { outputSchema?: unknown; signal?: AbortSignal };

type FakeThread = {
  run(input: Input, options?: TurnOptions): Promise<{ finalResponse: string }>;
};

type FakeClient = {
  startThread(options?: ThreadOptions): FakeThread;
};

type RuntimeRequest = {
  prompt: string;
  model: string;
  workingDirectory: string;
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
  images?: readonly string[];
  sandboxMode: 'read-only';
  networkAccessEnabled: false;
  webSearchMode: 'disabled';
  approvalPolicy: 'never';
};

type Subject = {
  createOfficialCodexRuntime?: (options?: {
    env?: Readonly<Record<string, string | undefined>>;
    createClient?: (options: { env: Record<string, string> }) => FakeClient;
  }) => { run(request: RuntimeRequest): Promise<{ finalResponse: string }> };
};

async function loadSubject(): Promise<Subject> {
  const modulePath: string = './official-codex-runtime.js';
  return import(modulePath).catch(() => ({}));
}

function validRequest(overrides: Partial<RuntimeRequest> = {}): RuntimeRequest {
  return {
    prompt: 'ตอบ JSON เท่านั้น',
    model: 'model-from-config',
    workingDirectory: '/tmp/fitcoach-codex-job-test',
    outputSchema: { type: 'object', required: ['confidence'] },
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    approvalPolicy: 'never',
    ...overrides,
  };
}

describe('official Codex SDK runtime adapter contract', () => {
  it('maps runtime security/model/workspace options to startThread and structured turn options to run', async () => {
    const subject = await loadSubject();
    expect(subject.createOfficialCodexRuntime).toBeTypeOf('function');
    if (!subject.createOfficialCodexRuntime) return;

    let threadOptions: ThreadOptions | undefined;
    let runInput: Input | undefined;
    let runOptions: TurnOptions | undefined;
    const controller = new AbortController();
    const runtime = subject.createOfficialCodexRuntime({
      createClient: () => ({
        startThread(options) {
          threadOptions = options;
          return {
            async run(input, options) {
              runInput = input;
              runOptions = options;
              return { finalResponse: '{"confidence":0.9}' };
            },
          };
        },
      }),
    });

    await runtime.run(validRequest({ signal: controller.signal }));

    expect(threadOptions).toEqual({
      model: 'model-from-config',
      workingDirectory: '/tmp/fitcoach-codex-job-test',
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      approvalPolicy: 'never',
    });
    expect(runInput).toBe('ตอบ JSON เท่านั้น');
    expect(runOptions).toEqual({
      outputSchema: { type: 'object', required: ['confidence'] },
      signal: controller.signal,
    });
  });

  it('uses the official local_image input shape and never turns image paths into network URLs', async () => {
    const subject = await loadSubject();
    expect(subject.createOfficialCodexRuntime).toBeTypeOf('function');
    if (!subject.createOfficialCodexRuntime) return;

    let runInput: Input | undefined;
    const runtime = subject.createOfficialCodexRuntime({
      createClient: () => ({
        startThread() {
          return {
            async run(input) {
              runInput = input;
              return { finalResponse: '{}' };
            },
          };
        },
      }),
    });

    await runtime.run(
      validRequest({
        images: ['/tmp/fitcoach-codex-job-test/input.png'],
      }),
    );

    expect(runInput).toEqual([
      { type: 'text', text: 'ตอบ JSON เท่านั้น' },
      { type: 'local_image', path: '/tmp/fitcoach-codex-job-test/input.png' },
    ]);
    expect(JSON.stringify(runInput)).not.toContain('http://');
    expect(JSON.stringify(runInput)).not.toContain('https://');
  });

  it('constructs Codex with an allow-listed environment and strips API keys, tokens, cookies, and unrelated secrets', async () => {
    const subject = await loadSubject();
    expect(subject.createOfficialCodexRuntime).toBeTypeOf('function');
    if (!subject.createOfficialCodexRuntime) return;

    let clientOptions: { env: Record<string, string> } | undefined;
    const runtime = subject.createOfficialCodexRuntime({
      env: {
        PATH: '/usr/bin',
        HOME: '/home/owner',
        CODEX_HOME: '/home/owner/.codex',
        LANG: 'th_TH.UTF-8',
        OPENAI_API_KEY: 'paid-api-key-must-not-pass',
        CODEX_API_KEY: 'paid-codex-key-must-not-pass',
        SESSION_TOKEN: 'session-must-not-pass',
        COOKIE: 'cookie-must-not-pass',
        DATABASE_URL: 'unrelated-secret-must-not-pass',
      },
      createClient: (options) => {
        clientOptions = options;
        return {
          startThread() {
            return { async run() { return { finalResponse: '{}' }; } };
          },
        };
      },
    });

    await runtime.run(validRequest());

    expect(clientOptions?.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/owner',
      CODEX_HOME: '/home/owner/.codex',
      LANG: 'th_TH.UTF-8',
    });
    const serialized = JSON.stringify(clientOptions);
    expect(serialized).not.toContain('paid-api-key-must-not-pass');
    expect(serialized).not.toContain('paid-codex-key-must-not-pass');
    expect(serialized).not.toContain('session-must-not-pass');
    expect(serialized).not.toContain('cookie-must-not-pass');
    expect(serialized).not.toContain('unrelated-secret-must-not-pass');
  });

  it('normalizes aborts and generic SDK failures into sanitized runtime errors without exposing raw messages', async () => {
    const subject = await loadSubject();
    expect(subject.createOfficialCodexRuntime).toBeTypeOf('function');
    if (!subject.createOfficialCodexRuntime) return;

    const secret = 'SDK_SECRET_SHOULD_NOT_ESCAPE';
    const abortController = new AbortController();
    abortController.abort();

    const runtime = subject.createOfficialCodexRuntime({
      createClient: () => ({
        startThread() {
          return {
            async run(_input, options) {
              if (options?.signal?.aborted) {
                const error = new Error(`aborted ${secret}`);
                error.name = 'AbortError';
                throw error;
              }
              throw new Error(`generic sdk failure ${secret}`);
            },
          };
        },
      }),
    });

    const aborted = await runtime
      .run(validRequest({ signal: abortController.signal }))
      .catch((error: unknown) => error);
    const failed = await runtime.run(validRequest()).catch((error: unknown) => error);

    expect(aborted).toMatchObject({ name: 'CodexRuntimeError', kind: 'aborted' });
    expect(failed).toMatchObject({ name: 'CodexRuntimeError', kind: 'temporary' });
    expect(JSON.stringify(aborted)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain(secret);
  });
});
