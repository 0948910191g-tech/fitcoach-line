import { z } from 'zod';

const serverEnvSchema = z.object({
  APP_URL: z.string().url(),
  LIFF_URL: z.string().url(),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
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
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CODEX_PROVIDER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
  CODEX_LUNA_MODEL: z.string().min(1),
  CODEX_TERRA_MODEL: z.string().min(1),
  SENTRY_DSN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);

  if (parsed.success) {
    return parsed.data;
  }

  const invalidKeys = [
    ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'UNKNOWN'))),
  ].sort();

  throw new Error(`Invalid server environment: ${invalidKeys.join(', ')}`);
}
