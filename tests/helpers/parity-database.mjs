import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;

// Default regression stays SQLite. PostgreSQL probes must opt in and lock the
// target; each test process gets its own new schema, never the shared public schema.
export function parityDatabase(prefix) {
  const postgres = process.env.T360_PARITY_POSTGRES_TEST === 'true';
  let schema;
  let url;
  if (postgres) {
    const target = new URL(process.env.DATABASE_URL || '');
    const database = decodeURIComponent(target.pathname.slice(1));
    const host = process.env.T360_CI_EXPECTED_HOST || process.env.T360_UAT_EXPECTED_HOST;
    const expected = process.env.T360_CI_EXPECTED_DATABASE || process.env.T360_UAT_EXPECTED_DATABASE;
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || !host || !expected
      || target.hostname !== host || database !== expected
      || [target.hostname, database].some(value => /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(value))
      || /prod|production|live/i.test(process.env.NODE_ENV || '')) {
      throw new Error('Parity probe requires a locked non-production PostgreSQL TEST target.');
    }
    if (!/^[a-z][a-z0-9_]*$/.test(prefix)) throw new Error('Invalid parity TEST schema prefix.');
    schema = `t360_parity_${prefix}_${randomUUID().replaceAll('-', '')}`;
    target.searchParams.set('schema', schema);
    url = target.toString();
  }
  const scratch = mkdtempSync(path.join(tmpdir(), `t360-${prefix}-`));
  url ||= `file:${path.join(scratch, 'test.db')}`;
  return {
    url,
    prepare() {
      execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'),
        'db', 'push', '--skip-generate', '--schema',
        path.join(root, `apps/api/prisma/schema.${postgres ? 'postgresql' : 'sqlite'}.prisma`)],
      { cwd: root, env: { ...process.env, DATABASE_URL: url, RUST_LOG: 'info' }, stdio: 'pipe' });
    },
    async close(client) {
      try {
        if (schema) {
          if (!/^t360_parity_[a-z][a-z0-9_]*_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe TEST cleanup scope.');
          await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await client.$disconnect();
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}
