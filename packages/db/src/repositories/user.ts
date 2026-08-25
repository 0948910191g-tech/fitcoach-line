import type { DatabaseClient } from '../client';
import { selectOne } from './shared';

export interface UserRow {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  timezone: string;
  status: string;
}

export class UserRepository {
  constructor(private readonly client: DatabaseClient) {}

  getById(userId: string): Promise<UserRow | null> {
    return selectOne<UserRow>(this.client, 'users', { id: `eq.${userId}` });
  }
}
