import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

export function runAllRoleParityProbe() {
  const root = process.cwd();
  const output = path.join(root, 'handoff/quality/github-all-role-parity-probe-latest.json');
  const log = path.join(root, 'logs/all-role-postgres-parity.log');
  const sourceIdentity = sourceFingerprint(root);
  // Each file owns a full 206-model schema. Serial schema lifecycles avoid
  // simultaneous DROP locks; concurrency assertions inside tests remain parallel.
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
    'tests/ppob-cashier-parity.test.mjs',
    'tests/mobile-count-parity-behavior.test.mjs',
    'tests/personnel-role-privacy-behavior.test.mjs',
    'tests/role-read-authority-parity-behavior.test.mjs'], {
    cwd: root, env: { ...process.env, T360_PARITY_POSTGRES_TEST: 'true' },
    encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  const text = `${result.stdout || ''}${result.stderr || ''}`;
  const tests = Number(text.match(/^# tests (\d+)$/m)?.[1] || 0);
  const passed = Number(text.match(/^# pass (\d+)$/m)?.[1] || 0);
  const failed = Number(text.match(/^# fail (\d+)$/m)?.[1] || 0);
  const skipped = Number(text.match(/^# skipped (\d+)$/m)?.[1] || 0);
  const after = sourceFingerprint(root);
  const ok = result.status === 0 && tests >= 27 && passed === tests && failed === 0 && skipped === 0
    && after.value === sourceIdentity.value;
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, text);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const evidence = { status: ok ? 'PASS' : 'FAIL', generatedAt: new Date().toISOString(), sourceIdentity,
    databaseProfile: 'postgresql', target: 'LOCKED_TEST_UNIQUE_SCHEMAS', tests, passed, failed, skipped,
    providerTraffic: 'NONE', humanStage20: 'PENDING', log: path.relative(root, log) };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  if (!ok) throw new Error('Actual PostgreSQL PPOB/scan/personnel parity failed; inspect logs/all-role-postgres-parity.log.');
  console.log(`All-role PostgreSQL atomicity/authority parity PASS ${passed}/${tests}`);
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runAllRoleParityProbe(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
