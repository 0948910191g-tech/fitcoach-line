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
  });
});
