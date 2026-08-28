import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { z, type ZodType } from 'zod';
import { buildCoachPrompt, buildDailyReportPrompt, buildWeeklyReportPrompt } from '../prompts/coach.v1.js';
import { buildFoodPrompt } from '../prompts/food.v1.js';
import { buildWorkoutPrompt } from '../prompts/workout.v1.js';
import {
  AIProviderError,
  type AIProvider,
  type AIProviderExecutionContext,
  type AnalyzeFoodInput,
  type CoachInput,
  type DailyReportInput,
  type ParseWorkoutInput,
  type ProviderImageInput,
  type WeeklyReportInput,
} from '../provider.js';
import {
  coachReplySchema,
  dailyReportSchema,
  weeklyReportSchema,
  type CoachReply,
  type DailyReport,
  type WeeklyReport,
} from '../schemas/coach.js';
import { foodAnalysisSchema, type FoodAnalysis } from '../schemas/food.js';
import { workoutAnalysisSchema, type WorkoutAnalysis } from '../schemas/workout.js';

const WORKSPACE_PREFIX = 'fitcoach-codex-job-';

export type CodexRuntimeErrorKind = 'temporary' | 'auth' | 'configuration' | 'aborted';

export class CodexRuntimeError extends Error {
  readonly kind: CodexRuntimeErrorKind;

  constructor(kind: CodexRuntimeErrorKind, message = 'Codex runtime failure') {
    super(message);
    this.name = 'CodexRuntimeError';
    this.kind = kind;
  }
}

export interface CodexRuntimeRequest {
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
}

export interface CodexRuntime {
  run(request: CodexRuntimeRequest): Promise<{ finalResponse: string }>;
}

export interface CodexProviderConfig {
  enabled: boolean;
  lunaModel: string;
  terraModel: string;
}

export interface CodexProviderOptions {
  config: CodexProviderConfig;
  runtime: CodexRuntime;
  workspaceRoot?: string;
  materializeImage?: (image: ProviderImageInput, workspace: string) => Promise<string>;
}

function permanentError(code: string, message: string): AIProviderError {
  return new AIProviderError(message, { code, retryable: false });
}

function temporaryError(code: string, message: string): AIProviderError {
  return new AIProviderError(message, { code, retryable: true });
}

function classifyRuntimeError(error: unknown, signal?: AbortSignal): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (signal?.aborted) {
    return temporaryError('provider_aborted', 'Codex execution was aborted');
  }

  if (error instanceof CodexRuntimeError) {
    switch (error.kind) {
      case 'temporary':
        return temporaryError('provider_temporary_failure', 'Codex provider is temporarily unavailable');
      case 'auth':
        return permanentError('provider_auth_unavailable', 'Codex authentication is unavailable');
      case 'configuration':
        return permanentError('provider_configuration_invalid', 'Codex provider configuration is invalid');
      case 'aborted':
        return temporaryError('provider_aborted', 'Codex execution was aborted');
    }
  }

  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
    return temporaryError('provider_aborted', 'Codex execution was aborted');
  }

  return temporaryError('provider_temporary_failure', 'Codex provider is temporarily unavailable');
}

function asJsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

function parseProviderJson<T>(raw: unknown): T {
  if (typeof raw !== 'string') {
    throw permanentError('invalid_json', 'Codex returned invalid JSON');
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw permanentError('invalid_json', 'Codex returned invalid JSON');
  }
}

function assertOwnedWorkspace(workspaceRoot: string, workspace: string): void {
  const root = resolve(workspaceRoot);
  const candidate = resolve(workspace);
  if (dirname(candidate) !== root || !basename(candidate).startsWith(WORKSPACE_PREFIX)) {
    throw permanentError('provider_configuration_invalid', 'Unsafe Codex workspace path');
  }
}

function assertPathInsideWorkspace(workspace: string, candidatePath: string): string {
  const root = resolve(workspace);
  const candidate = resolve(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${sep}`)) {
    throw permanentError('provider_configuration_invalid', 'Codex image must be materialized inside its workspace');
  }
  return candidate;
}

export class CodexProvider implements AIProvider {
  private readonly workspaceRoot: string;

  constructor(private readonly options: CodexProviderOptions) {
    this.workspaceRoot = options.workspaceRoot ?? tmpdir();
  }

  async analyzeFood(
    input: AnalyzeFoodInput,
    context?: AIProviderExecutionContext,
  ): Promise<FoodAnalysis> {
    if (!input.text?.trim() && input.image === undefined) {
      throw permanentError('provider_configuration_invalid', 'Food analysis requires text or an image');
    }

    return this.execute<FoodAnalysis>({
      model: input.image === undefined ? this.lunaModel() : this.terraModel(),
      prompt: buildFoodPrompt(input),
      schema: foodAnalysisSchema,
      ...(input.image === undefined ? {} : { image: input.image }),
      ...(context === undefined ? {} : { context }),
    });
  }

  async parseWorkout(
    input: ParseWorkoutInput,
    context?: AIProviderExecutionContext,
  ): Promise<WorkoutAnalysis> {
    return this.execute<WorkoutAnalysis>({
      model: this.lunaModel(),
      prompt: buildWorkoutPrompt(input),
      schema: workoutAnalysisSchema,
      ...(context === undefined ? {} : { context }),
    });
  }

  async generateCoachReply(
    input: CoachInput,
    context?: AIProviderExecutionContext,
  ): Promise<CoachReply> {
    return this.execute<CoachReply>({
      model: this.lunaModel(),
      prompt: buildCoachPrompt(input),
      schema: coachReplySchema,
      ...(context === undefined ? {} : { context }),
    });
  }

  async generateDailyReport(
    input: DailyReportInput,
    context?: AIProviderExecutionContext,
  ): Promise<DailyReport> {
    return this.execute<DailyReport>({
      model: this.terraModel(),
      prompt: buildDailyReportPrompt(input),
      schema: dailyReportSchema,
      ...(context === undefined ? {} : { context }),
    });
  }

  async generateWeeklyReport(
    input: WeeklyReportInput,
    context?: AIProviderExecutionContext,
  ): Promise<WeeklyReport> {
    return this.execute<WeeklyReport>({
      model: this.terraModel(),
      prompt: buildWeeklyReportPrompt(input),
      schema: weeklyReportSchema,
      ...(context === undefined ? {} : { context }),
    });
  }

  private ensureEnabled(): void {
    if (!this.options.config.enabled) {
      throw permanentError('provider_disabled', 'Codex provider is disabled');
    }
  }

  private lunaModel(): string {
    this.ensureEnabled();
    const model = this.options.config.lunaModel.trim();
    if (!model) {
      throw permanentError('provider_configuration_invalid', 'Codex Luna model is not configured');
    }
    return model;
  }

  private terraModel(): string {
    this.ensureEnabled();
    const model = this.options.config.terraModel.trim();
    if (!model) {
      throw permanentError('provider_configuration_invalid', 'Codex Terra model is not configured');
    }
    return model;
  }

  private async createWorkspace(): Promise<string> {
    await mkdir(this.workspaceRoot, { recursive: true });
    return mkdtemp(join(this.workspaceRoot, WORKSPACE_PREFIX));
  }

  private async cleanupWorkspace(workspace: string): Promise<void> {
    assertOwnedWorkspace(this.workspaceRoot, workspace);
    await rm(workspace, { recursive: true, force: true });
  }

  private async materializeImage(image: ProviderImageInput, workspace: string): Promise<string> {
    if (!this.options.materializeImage) {
      throw permanentError(
        'provider_configuration_invalid',
        'Codex image materializer is not configured',
      );
    }

    try {
      const localPath = await this.options.materializeImage(image, workspace);
      return assertPathInsideWorkspace(workspace, localPath);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw temporaryError('provider_temporary_failure', 'Codex image preparation failed');
    }
  }

  private async execute<T>(options: {
    model: string;
    prompt: string;
    schema: ZodType;
    image?: ProviderImageInput;
    context?: AIProviderExecutionContext;
  }): Promise<T> {
    this.ensureEnabled();
    const signal = options.context?.signal;
    if (signal?.aborted) {
      throw temporaryError('provider_aborted', 'Codex execution was aborted');
    }

    const workspace = await this.createWorkspace();
    let result: T | undefined;
    let executionError: unknown;

    try {
      const imagePath =
        options.image === undefined ? undefined : await this.materializeImage(options.image, workspace);
      const request: CodexRuntimeRequest = {
        prompt: options.prompt,
        model: options.model,
        workingDirectory: workspace,
        outputSchema: asJsonSchema(options.schema),
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        approvalPolicy: 'never',
        ...(signal === undefined ? {} : { signal }),
        ...(imagePath === undefined ? {} : { images: [imagePath] }),
      };

      let finalResponse: string;
      try {
        ({ finalResponse } = await this.options.runtime.run(request));
      } catch (error) {
        throw classifyRuntimeError(error, signal);
      }

      result = parseProviderJson<T>(finalResponse);
    } catch (error) {
      executionError = error;
    }

    try {
      await this.cleanupWorkspace(workspace);
    } catch {
      if (executionError === undefined) {
        throw temporaryError('provider_cleanup_failure', 'Codex workspace cleanup failed');
      }
    }

    if (executionError !== undefined) throw executionError;
    return result as T;
  }
}

export function createCodexProvider(options: CodexProviderOptions): CodexProvider {
  return new CodexProvider(options);
}
