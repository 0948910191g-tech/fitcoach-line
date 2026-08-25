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

export interface LineEventIngestionInput {
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  userId: string;
  taskType: string;
  inputRef: string;
}

export interface LineEventIngestionResult {
  inserted: boolean;
  webhookEventId: string;
  aiJobId: string | null;
}

interface LineEventIngestionRpcRow {
  inserted: boolean;
  webhook_event_id: string;
  ai_job_id: string | null;
}

export class AIJobRepository {
  constructor(private readonly client: DatabaseClient) {}

  getById(userId: string, jobId: string): Promise<AIJobRow | null> {
    return selectOneForUser<AIJobRow>(this.client, 'ai_jobs', userId, jobId);
  }

  async ingestLineEvent(input: LineEventIngestionInput): Promise<LineEventIngestionResult> {
    const rows = await this.client.rpc<LineEventIngestionRpcRow[]>('ingest_line_event_v1', {
      p_provider_event_id: input.providerEventId,
      p_event_type: input.eventType,
      p_payload_hash: input.payloadHash,
      p_user_id: input.userId,
      p_task_type: input.taskType,
      p_input_ref: input.inputRef,
    });
    const row = rows[0];

    if (!row) {
      throw new Error('LINE event ingestion returned no result');
    }

    return {
      inserted: row.inserted,
      webhookEventId: row.webhook_event_id,
      aiJobId: row.ai_job_id,
    };
  }
}
