import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAIRouter } from '../router.js';

const VALID_FOOD = {
  confidence: 0.9,
  assumptions: ['synthetic fixture'],
  normalizedUnits: {
    mass: 'g',
    energy: 'kcal',
    protein: 'g',
    carbs: 'g',
    fat: 'g',
    sugar: 'g',
    sodium: 'mg',
  },
  items: [
    {
      name: 'ข้าวไก่สังเคราะห์',
      quantity: { value: 250, unit: 'g' },
      components: ['ข้าว', 'ไก่'],
      caloriesKcal: 400,
      proteinG: 30,
      carbsG: 45,
      fatG: 10,
      sugarG: 3,
      sodiumMg: 500,
    },
  ],
  totals: {
    caloriesKcal: 400,
    proteinG: 30,
    carbsG: 45,
    fatG: 10,
    sugarG: 3,
    sodiumMg: 500,
  },
} as const;

const VALID_WORKOUT = {
  confidence: 0.94,
  assumptions: ['synthetic fixture'],
  normalizedUnits: {
    weight: 'kg',
    duration: 's',
    distance: 'm',
    energy: 'kcal',
  },
  mode: 'strength',
  exercises: [
    {
      name: 'Bench press',
      sets: [
        { setType: 'working', reps: 10, weightKg: 40, rpe: 8 },
        { setType: 'working', reps: 10, weightKg: 40, rpe: 8 },
        { setType: 'working', reps: 10, weightKg: 40, rpe: 8 },
      ],
    },
  ],
  estimatedEnergyKcal: { min: 80, max: 120 },
} as const;

const VALID_COACH = {
  confidence: 0.88,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { energy: 'kcal', protein: 'g', weight: 'kg' },
  factsUsed: ['protein_remaining=40g'],
  missingData: [],
  message: 'วันนี้เพิ่มโปรตีนอีกประมาณ 40 กรัมตามข้อมูลที่ระบบให้มา',
} as const;

const VALID_REPORT = {
  confidence: 0.87,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { energy: 'kcal', protein: 'g', weight: 'kg' },
  factsUsed: ['calories=1700', 'protein=120g'],
  missingData: [],
  summary: 'สรุปจากข้อเท็จจริงที่ระบบส่งให้เท่านั้น',
  nextActions: ['ทำตามเป้าหมายโปรตีนที่ backend คำนวณไว้'],
} as const;

type RuntimeRequest = {
  prompt: string;
  model: string;
  workingDirectory: string;
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
  images?: readonly string[];
  sandboxMode: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  approvalPolicy: string;
};

type Runtime = {
  run(request: RuntimeRequest): Promise<{ finalResponse: string }>;
};

type Provider = {
  analyzeFood(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
  parseWorkout(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
  generateCoachReply(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
  generateDailyReport(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
  generateWeeklyReport(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
};

type CodexSubject = {
  createCodexProvider?: (options: {
    config: { enabled: boolean; lunaModel: string; terraModel: string };
    runtime: Runtime;
    workspaceRoot?: string;
    materializeImage?: (
      image: { storagePath: string; mediaType?: string },
      workspace: string,
    ) => Promise<string>;
  }) => Provider;
  CodexRuntimeError?: new (
    kind: 'temporary' | 'auth' | 'configuration' | 'aborted',
    message?: string,
  ) => Error;
};

async function loadSubject(): Promise<CodexSubject> {
  const modulePath: string = './codex-provider.js';
  return import(modulePath).catch(() => ({}));
}

async function createProvider(
  runtime: Runtime,
  overrides: Partial<Parameters<NonNullable<CodexSubject['createCodexProvider']>>[0]> = {},
): Promise<{ provider: Provider; subject: CodexSubject }> {
  const subject = await loadSubject();
  expect(subject.createCodexProvider).toBeTypeOf('function');
  if (!subject.createCodexProvider) throw new Error('CodexProvider is not implemented');

  const provider = subject.createCodexProvider({
    config: {
      enabled: true,
      lunaModel: 'configured-luna-model',
      terraModel: 'configured-terra-model',
    },
    runtime,
    ...overrides,
  });
  return { provider, subject };
}

function sequenceRuntime(outputs: readonly unknown[]) {
  const requests: RuntimeRequest[] = [];
  let index = 0;
  const runtime: Runtime = {
    async run(request) {
      requests.push(request);
      const value = outputs[index++];
      return { finalResponse: typeof value === 'string' ? value : JSON.stringify(value) };
    },
  };
  return { runtime, requests };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeError(error: unknown): { message?: string; code?: string; retryable?: boolean; cause?: unknown } {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as { message?: unknown; code?: unknown; retryable?: unknown; cause?: unknown };
  return {
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
    ...(value.cause === undefined ? {} : { cause: value.cause }),
  };
}

describe('CodexProvider phase 2 contract', () => {
  it('implements the complete AIProvider surface without a real Codex login', async () => {
    const { runtime } = sequenceRuntime([
      VALID_FOOD,
      VALID_WORKOUT,
      VALID_COACH,
      VALID_REPORT,
      VALID_REPORT,
    ]);
    const { provider } = await createProvider(runtime);

    await expect(provider.analyzeFood({ text: 'ข้าวไก่', locale: 'th-TH' })).resolves.toEqual(VALID_FOOD);
    await expect(provider.parseWorkout({ text: 'Bench press 40kg 10x3 RPE8' })).resolves.toEqual(
      VALID_WORKOUT,
    );
    await expect(
      provider.generateCoachReply({ question: 'วันนี้ควรกินอะไรเพิ่ม', facts: {} }),
    ).resolves.toEqual(VALID_COACH);
    await expect(
      provider.generateDailyReport({ facts: {}, periodStart: '2026-08-28', periodEnd: '2026-08-28' }),
    ).resolves.toEqual(VALID_REPORT);
    await expect(
      provider.generateWeeklyReport({ facts: {}, periodStart: '2026-08-22', periodEnd: '2026-08-28' }),
    ).resolves.toEqual(VALID_REPORT);
  });

  it('fails permanently and never invokes runtime when provider is disabled', async () => {
    let calls = 0;
    const runtime: Runtime = {
      async run() {
        calls += 1;
        return { finalResponse: JSON.stringify(VALID_FOOD) };
      },
    };
    const { provider } = await createProvider(runtime, {
      config: { enabled: false, lunaModel: 'luna-from-config', terraModel: 'terra-from-config' },
    });

    const error = await provider.analyzeFood({ text: 'ข้าว' }).catch((value: unknown) => value);
    expect(calls).toBe(0);
    expect(safeError(error)).toMatchObject({ code: 'provider_disabled', retryable: false });
  });

  it('routes models from config: Luna for clear text work and Terra for image/report work', async () => {
    const { runtime, requests } = sequenceRuntime([
      VALID_FOOD,
      VALID_FOOD,
      VALID_WORKOUT,
      VALID_COACH,
      VALID_REPORT,
      VALID_REPORT,
    ]);
    const workspaceRoot = join(tmpdir(), `fitcoach-codex-routing-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    const imageSource = join(workspaceRoot, 'source.png');
    await writeFile(imageSource, 'synthetic-image');

    const { provider } = await createProvider(runtime, {
      workspaceRoot,
      config: { enabled: true, lunaModel: 'LUNA_FROM_ENV', terraModel: 'TERRA_FROM_ENV' },
      materializeImage: async (_image, workspace) => {
        const target = join(workspace, 'food.png');
        await writeFile(target, await readFile(imageSource));
        return target;
      },
    });

    await provider.analyzeFood({ text: 'ข้าวไก่' });
    await provider.analyzeFood({ image: { storagePath: 'private://food.png', mediaType: 'image/png' } });
    await provider.parseWorkout({ text: 'Bench press 40kg 10x3 RPE8' });
    await provider.generateCoachReply({ question: 'กินอะไรเพิ่ม', facts: {} });
    await provider.generateDailyReport({ facts: {}, periodStart: 'a', periodEnd: 'b' });
    await provider.generateWeeklyReport({ facts: {}, periodStart: 'a', periodEnd: 'b' });

    expect(requests.map((request) => request.model)).toEqual([
      'LUNA_FROM_ENV',
      'TERRA_FROM_ENV',
      'LUNA_FROM_ENV',
      'LUNA_FROM_ENV',
      'TERRA_FROM_ENV',
      'TERRA_FROM_ENV',
    ]);
    expect(requests.map((request) => request.model)).not.toContain('gpt-5.6-luna');
    expect(requests.map((request) => request.model)).not.toContain('gpt-5.6-terra');
  });

  it('requests JSON-only structured output and leaves schema mismatch to AIRouter/Zod', async () => {
    const invalidShape = { confidence: 0.9, assumptions: [] };
    const { runtime, requests } = sequenceRuntime([invalidShape]);
    const { provider } = await createProvider(runtime);
    const router = createAIRouter(provider as never);

    const error = await router.analyzeFood({ text: 'ข้าว' }).catch((value: unknown) => value);
    expect(safeError(error)).toMatchObject({ code: 'schema_mismatch', retryable: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.outputSchema).toEqual(expect.any(Object));
    expect(requests[0]?.prompt).toContain('JSON เท่านั้น');
    expect(requests[0]?.prompt).toContain('confidence');
    expect(requests[0]?.prompt).toContain('assumptions');
    expect(requests[0]?.prompt).toContain('normalizedUnits');
    expect(requests[0]?.prompt).not.toContain('```');
  });

  it('classifies malformed final response as permanent invalid_json', async () => {
    const { runtime } = sequenceRuntime(['not-json-at-all']);
    const { provider } = await createProvider(runtime);

    const error = await provider.analyzeFood({ text: 'ข้าว' }).catch((value: unknown) => value);
    expect(safeError(error)).toMatchObject({ code: 'invalid_json', retryable: false });
  });

  it('classifies typed temporary and permanent runtime failures without leaking raw details', async () => {
    const subject = await loadSubject();
    expect(subject.CodexRuntimeError).toBeTypeOf('function');
    if (!subject.CodexRuntimeError) throw new Error('CodexRuntimeError is not implemented');

    const secret = 'SESSION_TOKEN_SHOULD_NEVER_ESCAPE';
    const temporaryRuntime: Runtime = {
      async run() {
        throw new subject.CodexRuntimeError!('temporary', `transient ${secret}`);
      },
    };
    const permanentRuntime: Runtime = {
      async run() {
        throw new subject.CodexRuntimeError!('auth', `auth ${secret}`);
      },
    };
    const { provider: temporaryProvider } = await createProvider(temporaryRuntime);
    const { provider: permanentProvider } = await createProvider(permanentRuntime);

    const temporary = await temporaryProvider.analyzeFood({ text: 'ข้าว' }).catch((value: unknown) => value);
    const permanent = await permanentProvider.analyzeFood({ text: 'ข้าว' }).catch((value: unknown) => value);

    expect(safeError(temporary)).toMatchObject({ code: 'provider_temporary_failure', retryable: true });
    expect(safeError(permanent)).toMatchObject({ code: 'provider_auth_unavailable', retryable: false });
    expect(JSON.stringify(safeError(temporary))).not.toContain(secret);
    expect(JSON.stringify(safeError(permanent))).not.toContain(secret);
  });

  it('passes the worker-owned AbortSignal into the Codex runtime and classifies abort safely', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const subject = await loadSubject();
    expect(subject.CodexRuntimeError).toBeTypeOf('function');
    if (!subject.CodexRuntimeError) throw new Error('CodexRuntimeError is not implemented');

    const runtime: Runtime = {
      async run(request) {
        receivedSignal = request.signal;
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new subject.CodexRuntimeError!('aborted', 'runtime aborted')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
    };
    const { provider } = await createProvider(runtime);
    const promise = provider.analyzeFood({ text: 'ข้าว' }, { signal: controller.signal });
    controller.abort();

    const error = await promise.catch((value: unknown) => value);
    expect(receivedSignal).toBe(controller.signal);
    expect(safeError(error)).toMatchObject({ code: 'provider_aborted', retryable: true });
  });

  it('creates a unique workspace per execution and removes only provider-owned workspaces', async () => {
    const workspaceRoot = join(tmpdir(), `fitcoach-codex-isolation-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    const sentinel = join(workspaceRoot, 'KEEP_ME.txt');
    await writeFile(sentinel, 'keep');
    const seen: string[] = [];
    const runtime: Runtime = {
      async run(request) {
        expect(await exists(request.workingDirectory)).toBe(true);
        seen.push(request.workingDirectory);
        return { finalResponse: JSON.stringify(VALID_FOOD) };
      },
    };
    const { provider } = await createProvider(runtime, { workspaceRoot });

    await Promise.all([
      provider.analyzeFood({ text: 'job A' }),
      provider.analyzeFood({ text: 'job B' }),
    ]);

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    for (const workspace of seen) {
      expect(resolve(dirname(workspace))).toBe(resolve(workspaceRoot));
      expect(basename(workspace)).toMatch(/^fitcoach-codex-job-/);
      expect(await exists(workspace)).toBe(false);
    }
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
    expect(await exists(workspaceRoot)).toBe(true);
  });

  it('cleans its isolated workspace after runtime failure', async () => {
    const workspaceRoot = join(tmpdir(), `fitcoach-codex-cleanup-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    let workspace: string | undefined;
    const subject = await loadSubject();
    expect(subject.CodexRuntimeError).toBeTypeOf('function');
    if (!subject.CodexRuntimeError) throw new Error('CodexRuntimeError is not implemented');
    const runtime: Runtime = {
      async run(request) {
        workspace = request.workingDirectory;
        throw new subject.CodexRuntimeError!('temporary', 'synthetic transient failure');
      },
    };
    const { provider } = await createProvider(runtime, { workspaceRoot });

    await provider.analyzeFood({ text: 'ข้าว' }).catch(() => undefined);

    expect(workspace).toBeDefined();
    expect(await exists(workspace!)).toBe(false);
    expect(await exists(workspaceRoot)).toBe(true);
  });

  it('materializes a private food image inside the isolated workspace without exposing its storage reference', async () => {
    const workspaceRoot = join(tmpdir(), `fitcoach-codex-image-${crypto.randomUUID()}`);
    await mkdir(workspaceRoot, { recursive: true });
    let materializedInput: string | undefined;
    let request: RuntimeRequest | undefined;
    const runtime: Runtime = {
      async run(value) {
        request = value;
        const imagePath = value.images?.[0];
        expect(imagePath).toBeDefined();
        expect(await readFile(imagePath!, 'utf8')).toBe('synthetic-image');
        return { finalResponse: JSON.stringify(VALID_FOOD) };
      },
    };
    const { provider } = await createProvider(runtime, {
      workspaceRoot,
      materializeImage: async (image, workspace) => {
        materializedInput = image.storagePath;
        const target = join(workspace, 'input.png');
        await writeFile(target, 'synthetic-image');
        return target;
      },
    });

    await provider.analyzeFood({ image: { storagePath: 'private-storage://food/1', mediaType: 'image/png' } });

    expect(materializedInput).toBe('private-storage://food/1');
    expect(request?.images).toHaveLength(1);
    expect(request?.prompt).not.toContain('private-storage://food/1');
  });

  it('enforces the official SDK-supported read-only/no-network posture for every request', async () => {
    const { runtime, requests } = sequenceRuntime([VALID_COACH]);
    const { provider } = await createProvider(runtime);

    await provider.generateCoachReply({ question: 'วันนี้ควรทำอะไร', facts: { proteinRemainingG: 40 } });

    expect(requests[0]).toMatchObject({
      sandboxMode: 'read-only',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      approvalPolicy: 'never',
    });
  });
});
