import { describe, expect, it } from 'vitest';
import { AIJobRepository } from './ai-job';
import { CoachRepository } from './coach';
import { FoodRepository } from './food';
import { UserRepository } from './user';
import { WorkoutRepository } from './workout';
import type { DatabaseClient, QueryFilters } from '../client';

class RecordingClient implements DatabaseClient {
  calls: Array<{ table: string; filters: QueryFilters }> = [];
  rpcCalls: Array<{ functionName: string; args: Readonly<Record<string, unknown>> }> = [];
  rpcResponse: unknown = [];

  async select<T>(table: string, filters: QueryFilters): Promise<T[]> {
    this.calls.push({ table, filters });
    return [];
  }

  async rpc<T>(functionName: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    this.rpcCalls.push({ functionName, args });
    return this.rpcResponse as T;
  }
}

describe('user-scoped repositories', () => {
  it.each([
    ['users', (client: DatabaseClient) => new UserRepository(client).getById('user-a'), { id: 'eq.user-a' }],
    [
      'food_logs',
      (client: DatabaseClient) => new FoodRepository(client).getById('user-a', 'food-b'),
      { user_id: 'eq.user-a', id: 'eq.food-b' },
    ],
    [
      'workout_sessions',
      (client: DatabaseClient) => new WorkoutRepository(client).getById('user-a', 'workout-b'),
      { user_id: 'eq.user-a', id: 'eq.workout-b' },
    ],
    [
      'coach_reports',
      (client: DatabaseClient) => new CoachRepository(client).getReportById('user-a', 'report-b'),
      { user_id: 'eq.user-a', id: 'eq.report-b' },
    ],
    [
      'ai_jobs',
      (client: DatabaseClient) => new AIJobRepository(client).getById('user-a', 'job-b'),
      { user_id: 'eq.user-a', id: 'eq.job-b' },
    ],
  ])('%s always scopes reads to the explicit user id', async (table, run, expectedFilters) => {
    const client = new RecordingClient();

    await run(client);

    expect(client.calls).toEqual([{ table, filters: expectedFilters }]);
  });

  it('looks up an application user by the verified LINE user id', async () => {
    const client = new RecordingClient();
    const repository = new UserRepository(client) as unknown as {
      getByLineUserId?: (lineUserId: string) => Promise<unknown>;
    };

    expect(repository.getByLineUserId).toBeTypeOf('function');
    if (!repository.getByLineUserId) return;
    await repository.getByLineUserId('U_SYNTHETIC_OWNER_001');

    expect(client.calls).toEqual([
      { table: 'users', filters: { line_user_id: 'eq.U_SYNTHETIC_OWNER_001' } },
    ]);
  });

  it('maps LINE event ingestion to the single atomic RPC', async () => {
    const client = new RecordingClient();
    client.rpcResponse = [
      { inserted: true, webhook_event_id: 'webhook-1', ai_job_id: 'job-1' },
    ];
    const repository = new AIJobRepository(client) as unknown as {
      ingestLineEvent?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    expect(repository.ingestLineEvent).toBeTypeOf('function');
    if (!repository.ingestLineEvent) return;

    const result = await repository.ingestLineEvent({
      providerEventId: 'evt-synthetic-001',
      eventType: 'text',
      payloadHash: 'a'.repeat(64),
      userId: '00000000-0000-4000-8000-000000000001',
      taskType: 'line_text_ingestion',
      inputRef: 'line-event:evt-synthetic-001',
    });

    expect(client.rpcCalls).toEqual([
      {
        functionName: 'ingest_line_event_v1',
        args: {
          p_provider_event_id: 'evt-synthetic-001',
          p_event_type: 'text',
          p_payload_hash: 'a'.repeat(64),
          p_user_id: '00000000-0000-4000-8000-000000000001',
          p_task_type: 'line_text_ingestion',
          p_input_ref: 'line-event:evt-synthetic-001',
        },
      },
    ]);
    expect(result).toEqual({ inserted: true, webhookEventId: 'webhook-1', aiJobId: 'job-1' });
  });
});
