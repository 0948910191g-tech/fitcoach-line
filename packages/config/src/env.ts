import { z } from 'zod';

const supabasePublicEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

const serverEnvSchema = supabasePublicEnvSchema.extend({
  APP_URL: z.string().url(),
  LIFF_URL: z.string().url(),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_LOGIN_CHANNEL_ID: z.string().regex(/^\d+$/, 'must be a numeric LINE Login channel ID'),
  LINE_LOGIN_CALLBACK_URL: z.string().url(),
  OWNER_LINE_USER_IDS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1)).min(1)),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CODEX_PROVIDER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
  CODEX_LUNA_MODEL: z.string().min(1),
  CODEX_TERRA_MODEL: z.string().min(1),
  SENTRY_DSN: z.string().url().optional(),
});

export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function invalidEnvError(prefix: string, issues: ReadonlyArray<{ path: PropertyKey[] }>): Error {
  const invalidKeys = [
    ...new Set(issues.map((issue) => String(issue.path[0] ?? 'UNKNOWN'))),
  ].sort();
  return new Error(`${prefix}: ${invalidKeys.join(', ')}`);
}

export function getSupabasePublicEnv(source: NodeJS.ProcessEnv = process.env): SupabasePublicEnv {
  const parsed = supabasePublicEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  throw invalidEnvError('Invalid Supabase public environment', parsed.error.issues);
}

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  throw invalidEnvError('Invalid server environment', parsed.error.issues);
}
