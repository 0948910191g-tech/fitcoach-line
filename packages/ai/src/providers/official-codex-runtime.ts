import { Codex, type Input, type ThreadOptions, type TurnOptions } from '@openai/codex-sdk';
import {
  CodexRuntimeError,
  type CodexRuntime,
  type CodexRuntimeRequest,
} from './codex-provider.js';

interface CodexThreadLike {
  run(
    input: Input,
    options?: TurnOptions,
  ): Promise<{ finalResponse: string }>;
}

interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
}

export interface OfficialCodexRuntimeOptions {
  env?: Readonly<Record<string, string | undefined>>;
  createClient?: (options: { env: Record<string, string> }) => CodexClientLike;
}

const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
] as const;

function createSafeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== '') safe[key] = value;
  }
  return safe;
}

function buildInput(request: CodexRuntimeRequest): Input {
  if (!request.images?.length) return request.prompt;

  return [
    { type: 'text', text: request.prompt },
    ...request.images.map((path) => ({ type: 'local_image' as const, path })),
  ];
}

function classifySdkFailure(error: unknown, signal?: AbortSignal): CodexRuntimeError {
  if (
    signal?.aborted ||
    (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
  ) {
    return new CodexRuntimeError('aborted', 'Codex SDK execution was aborted');
  }

  // The current official SDK surfaces turn failures as generic Error(message),
  // without a stable public auth/config error discriminator. Keep unknown SDK
  // failures retryable here; Owner Alpha auth is preflighted outside this call.
  return new CodexRuntimeError('temporary', 'Codex SDK execution failed');
}

export function createOfficialCodexRuntime(
  options: OfficialCodexRuntimeOptions = {},
): CodexRuntime {
  const sourceEnv = options.env ?? process.env;
  const safeEnv = createSafeEnvironment(sourceEnv);
  const createClient =
    options.createClient ??
    ((clientOptions: { env: Record<string, string> }): CodexClientLike => new Codex(clientOptions));

  return {
    async run(request) {
      const client = createClient({ env: { ...safeEnv } });
      const thread = client.startThread({
        model: request.model,
        workingDirectory: request.workingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: request.sandboxMode,
        networkAccessEnabled: request.networkAccessEnabled,
        webSearchMode: request.webSearchMode,
        approvalPolicy: request.approvalPolicy,
      });

      try {
        const result = await thread.run(buildInput(request), {
          outputSchema: request.outputSchema,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        return { finalResponse: result.finalResponse };
      } catch (error) {
        throw classifySdkFailure(error, request.signal);
      }
    },
  };
}
