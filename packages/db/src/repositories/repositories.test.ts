import { describe, expect, it } from 'vitest';
import { AIJobRepository } from './ai-job';
import { CoachRepository } from './coach';
import { FoodRepository } from './food';
import { UserRepository } from './user';
import { WorkoutRepository } from './workout';
import type { DatabaseClient, QueryFilters } from '../client';

class RecordingClient implements DatabaseClient {
  calls: Array<{ table: string; filters: QueryFilters }> = [];

  async select<T>(table: string, filters: QueryFilters): Promise<T[]> {
    this.calls.push({ table, filters });
    return [];
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
});
