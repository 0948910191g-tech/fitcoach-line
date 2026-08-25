import type { DatabaseClient } from '../client';
import { selectOneForUser } from './shared';

export interface FoodLogRow {
  id: string;
  user_id: string;
  eaten_at: string;
  meal_type: string | null;
  source: string;
  status: string;
  totals: Record<string, unknown>;
  confidence: number | null;
}

export class FoodRepository {
  constructor(private readonly client: DatabaseClient) {}

  getById(userId: string, foodLogId: string): Promise<FoodLogRow | null> {
    return selectOneForUser<FoodLogRow>(this.client, 'food_logs', userId, foodLogId);
  }
}
