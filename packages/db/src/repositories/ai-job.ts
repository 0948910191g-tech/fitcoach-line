import type { DatabaseClient } from '../client';
import { selectOneForUser } from './shared';

export interface AIJobRow {
  id: string;
  user_id: string;
  task_type: string;
  provider: string;
  status: string;
  attempts: number;
  input_ref: string | null;
  output_json: Record<string, unknown> | null;
  error_code: string | null;
}

export class AIJobRepository {
  constructor(private readonly client: DatabaseClient) {}

  getById(userId: string, jobId: string): Promise<AIJobRow | null> {
    return selectOneForUser<AIJobRow>(this.client, 'ai_jobs', userId, jobId);
  }
}
