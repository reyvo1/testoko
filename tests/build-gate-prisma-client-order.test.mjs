import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildGate = fs.readFileSync('scripts/run-build-gate.mjs', 'utf8');
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

test('build gate generates schema-specific PostgreSQL Prisma Client before TypeScript lint', () => {
  const generate = buildGate.indexOf('PRISMA_GENERATE_POSTGRES_FOR_TYPECHECK');
  const lint = buildGate.indexOf('TYPESCRIPT_LINT');
  const sqlitePrepare = buildGate.indexOf('SQLITE_DB_PREPARE');
  const finalGenerate = buildGate.indexOf('PRISMA_GENERATE_POSTGRES_FINAL');
  const build = buildGate.indexOf('SIX_APP_PRODUCTION_BUILD');
  assert.ok(generate > 0, 'typecheck Prisma generation missing');
  assert.ok(lint > generate, 'lint must run after Prisma Client generation');
  assert.ok(sqlitePrepare > lint, 'SQLite rehearsal must happen after typecheck');
  assert.ok(finalGenerate > sqlitePrepare, 'PostgreSQL Client must be restored after SQLite rehearsal');
  assert.ok(build > finalGenerate, 'production build must use final PostgreSQL Client');
});

test('PR CI does not test/build against an ungenerated or SQLite-generated Prisma Client', () => {
  assert.match(ci, /Generate PostgreSQL Prisma Client for repository tests[\s\S]*npm run db:postgres:generate[\s\S]*npm test/);
  assert.match(ci, /npm run db:local:prepare[\s\S]*npm run test:db:smoke[\s\S]*Restore PostgreSQL Prisma Client for production build typing[\s\S]*npm run db:postgres:generate[\s\S]*npm run build/);
});
