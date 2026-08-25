import type { DatabaseClient } from '../client';
import { selectOneForUser } from './shared';

export interface CoachReportRow {
  id: string;
  user_id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  facts_json: Record<string, unknown>;
  report_json: Record<string, unknown>;
}

export class CoachRepository {
  constructor(private readonly client: DatabaseClient) {}

  getReportById(userId: string, reportId: string): Promise<CoachReportRow | null> {
    return selectOneForUser<CoachReportRow>(this.client, 'coach_reports', userId, reportId);
  }
}
