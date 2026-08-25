import type { DatabaseClient, QueryFilters } from '../client';

export async function selectOneForUser<T>(
  client: DatabaseClient,
  table: string,
  userId: string,
  id: string,
): Promise<T | null> {
  const rows = await client.select<T>(table, {
    user_id: `eq.${userId}`,
    id: `eq.${id}`,
  });

  return rows[0] ?? null;
}

export async function selectOne<T>(
  client: DatabaseClient,
  table: string,
  filters: QueryFilters,
): Promise<T | null> {
  const rows = await client.select<T>(table, filters);
  return rows[0] ?? null;
}
