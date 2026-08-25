export type QueryFilters = Readonly<Record<string, string>>;
export type RpcArguments = Readonly<Record<string, unknown>>;

export interface DatabaseClient {
  select<T>(table: string, filters: QueryFilters): Promise<T[]>;
  rpc<T>(functionName: string, args: RpcArguments): Promise<T>;
}

export interface SupabaseDatabaseConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

class SupabaseRestClient implements DatabaseClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly accessToken: string,
  ) {}

  async select<T>(table: string, filters: QueryFilters): Promise<T[]> {
    const url = new URL(`/rest/v1/${table}`, this.baseUrl);
    url.searchParams.set('select', '*');

    for (const [column, expression] of Object.entries(filters)) {
      url.searchParams.set(column, expression);
    }

    const response = await fetch(url, {
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Database request failed for ${table}: HTTP ${response.status}`);
    }

    return (await response.json()) as T[];
  }

  async rpc<T>(functionName: string, args: RpcArguments): Promise<T> {
    const url = new URL(`/rest/v1/rpc/${functionName}`, this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`Database RPC failed for ${functionName}: HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

export function createUserDatabaseClient(
  config: SupabaseDatabaseConfig,
  accessToken: string,
): DatabaseClient {
  return new SupabaseRestClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, accessToken);
}

export function createServiceDatabaseClient(config: SupabaseDatabaseConfig): DatabaseClient {
  return new SupabaseRestClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    config.SUPABASE_SERVICE_ROLE_KEY,
  );
}
