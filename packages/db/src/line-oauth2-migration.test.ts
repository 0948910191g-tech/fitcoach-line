import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LINE OAuth2 identity migration', () => {
  it('trusts only the custom:line-oauth identity provider', () => {
    const migrationPath = resolve(
      process.cwd(),
      '../../supabase/migrations/0006_line_oauth2_identity.sql',
    );

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("i.provider = 'custom:line-oauth'");
    expect(sql).toContain("trusted custom:line-oauth identity required");
    expect(sql).not.toContain("i.provider = 'custom:line';");
    expect(sql).not.toMatch(/\b(drop\s+table|truncate(?:\s+table)?|delete\s+from)\b/i);
    expect(sql).toContain(
      'revoke all on function public.link_line_identity_v1() from public, anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.link_line_identity_v1() to authenticated;',
    );
  });
});
