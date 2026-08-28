import { access, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexRuntimeError, createCodexProvider, type CodexRuntime } from './codex-provider.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function restoreAndRemove(root: string, workspace?: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function createProvider(runtime: CodexRuntime, workspaceRoot: string) {
  return createCodexProvider({
    config: {
      enabled: true,
      lunaModel: 'configured-luna-model',
      terraModel: 'configured-terra-model',
    },
    runtime,
    workspaceRoot,
  });
}

describe('CodexProvider workspace cleanup safety', () => {
  it('preserves the original sanitized provider error when cleanup also fails', async () => {
    if (process.platform === 'win32') return;

    const workspaceRoot = join(tmpdir(), `fitcoach-codex-cleanup-mask-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    let workspace: string | undefined;
    const secret = 'AUTH_SESSION_SECRET_MUST_NOT_ESCAPE';
    const runtime: CodexRuntime = {
      async run(request) {
        workspace = request.workingDirectory;
        await chmod(workspaceRoot, 0o500);
        throw new CodexRuntimeError('auth', `auth failed with ${secret}`);
      },
    };
    const provider = createProvider(runtime, workspaceRoot);

    const error = await provider.analyzeFood({ text: 'synthetic meal' }).catch((value: unknown) => value);
    await restoreAndRemove(workspaceRoot, workspace);

    expect(error).toMatchObject({
      name: 'AIProviderError',
      code: 'provider_auth_unavailable',
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(workspaceRoot);
  });

  it('sanitizes cleanup failure after a successful runtime result', async () => {
    if (process.platform === 'win32') return;

    const workspaceRoot = join(tmpdir(), `fitcoach-codex-cleanup-success-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    let workspace: string | undefined;
    const runtime: CodexRuntime = {
      async run(request) {
        workspace = request.workingDirectory;
        await chmod(workspaceRoot, 0o500);
        return { finalResponse: '{}' };
      },
    };
    const provider = createProvider(runtime, workspaceRoot);

    const error = await provider.analyzeFood({ text: 'synthetic meal' }).catch((value: unknown) => value);
    await restoreAndRemove(workspaceRoot, workspace);

    expect(error).toMatchObject({
      name: 'AIProviderError',
      code: 'provider_cleanup_failure',
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain(workspaceRoot);
  });

  it('rejects an image path outside the owned job workspace without deleting it', async () => {
    const workspaceRoot = join(tmpdir(), `fitcoach-codex-path-guard-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    const outsidePath = join(workspaceRoot, 'outside.png');
    await writeFile(outsidePath, 'synthetic-image');
    let runtimeCalls = 0;
    const runtime: CodexRuntime = {
      async run() {
        runtimeCalls += 1;
        return { finalResponse: '{}' };
      },
    };
    const provider = createCodexProvider({
      config: {
        enabled: true,
        lunaModel: 'configured-luna-model',
        terraModel: 'configured-terra-model',
      },
      runtime,
      workspaceRoot,
      materializeImage: async () => outsidePath,
    });

    const error = await provider
      .analyzeFood({ image: { storagePath: 'private-storage://food/1', mediaType: 'image/png' } })
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: 'AIProviderError',
      code: 'provider_configuration_invalid',
      retryable: false,
    });
    expect(runtimeCalls).toBe(0);
    expect(await exists(outsidePath)).toBe(true);

    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
