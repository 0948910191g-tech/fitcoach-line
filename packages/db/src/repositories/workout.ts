import type { DatabaseClient } from '../client';
import { selectOneForUser } from './shared';

export interface WorkoutSessionRow {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  workout_type: string;
  effort: number | null;
  estimated_kcal: number | null;
  status: string;
}

export class WorkoutRepository {
  constructor(private readonly client: DatabaseClient) {}

  getById(userId: string, workoutId: string): Promise<WorkoutSessionRow | null> {
    return selectOneForUser<WorkoutSessionRow>(this.client, 'workout_sessions', userId, workoutId);
  }
}
