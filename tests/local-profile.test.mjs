import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function models(schema) { return [...schema.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]); }

test('local profile uses SQLite and does not require root Docker Compose', () => {
  const env = readFileSync('.env.local.example', 'utf8');
  assert.match(env, /DATABASE_PROFILE=sqlite/);
  assert.match(env, /DATABASE_URL=file:\.\/data\/toko360\.db/);
  assert.equal(existsSync('docker-compose.yml'), false);
});

test('SQLite and PostgreSQL schemas stay structurally aligned', () => {
  const sqlite = readFileSync('apps/api/prisma/schema.sqlite.prisma', 'utf8');
  const postgres = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');
  assert.deepEqual(models(sqlite), models(postgres));
  assert.match(sqlite, /provider\s*=\s*"sqlite"/);
  assert.match(postgres, /provider\s*=\s*"postgresql"/);
  assert.doesNotMatch(sqlite, /@db\.Decimal/);
});

test('Windows one-click scripts are available', () => {
  assert.equal(existsSync('setup-local.cmd'), true);
  assert.equal(existsSync('start-local.cmd'), true);
  assert.equal(existsSync('reset-local-database.cmd'), true);
});
