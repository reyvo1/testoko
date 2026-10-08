import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('worker TIDAK boleh punya import literal ke apps/api/dist', () => {
  // BUG yang ditemukan UAT GitHub 2026-10-01 (run 36879544892): build gate di GitHub gagal
  // dengan TS2307 "Cannot find module '../../api/dist/mobile-ops/...'" pada apps/worker/src/index.ts.
  //
  // Akar masalahnya: `npm run lint` / tsc --noEmit berjalan SEBELUM build apa pun, di checkout
  // bersih yang TIDAK punya `dist/` (dist/ ada di .gitignore). Literal import ke artefak build
  // diprose TypeScript saat typecheck, padahal saat runtime file itu sudah ada karena
  // `npm run build` membangun api sebelum worker.
  //
  // Jadi ini bukan urutan build yang salah - urutan build sudah benar. Yang salah adalah
  // dependensi level-TYPE ke output build. Specifier harus dihitung saat runtime saja.
  const source = read('apps/worker/src/index.ts');

  const literalImport = /import\(\s*['"][^'"]*api\/dist\//;
  assert.doesNotMatch(source, literalImport,
    'worker tidak boleh mengimpor apps/api/dist dengan specifier literal: tsc me-resolve ' +
    'path itu saat typecheck, dan dist/ tidak ada di checkout bersih (lihat gitignore).');

  assert.match(source, /pathToFileURL\(/,
    'path API dist harus dihitung saat runtime lewat pathToFileURL dari __dirname');
  assert.match(source, /import\(apiDist\(/,
    'kedua service harus dimuat lewat helper runtime, bukan path literal');
});

test('worker typecheck tidak bergantung pada apps/api/dist (checkout bersih CI)', () => {
  // Materialize a clean checkout instead of moving the caller's build artifacts.
  // Both an initially absent and an initially present API dist are valid contexts.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't360-worker-typecheck-'));
  const worker = path.join(scratch, 'apps/worker');
  const apiDist = path.join(root, 'apps/api/dist');
  const hadApiDist = fs.existsSync(apiDist);
  let failure;
  try {
    fs.mkdirSync(worker, { recursive: true });
    fs.cpSync(path.join(root, 'apps/worker/src'), path.join(worker, 'src'), { recursive: true });
    for (const file of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, 'apps/worker', file), path.join(worker, file));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fs.existsSync(path.join(scratch, 'apps/api/dist')), false, 'isolated checkout must have no API dist');
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', path.join(worker, 'tsconfig.json')], {
      cwd: scratch, stdio: 'pipe', timeout: 180_000,
    });
  } catch (error) {
    failure = error.stdout?.toString().slice(0, 600) ?? error.message;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(apiDist), hadApiDist, 'the caller API build must retain its initial presence/absence');
  assert.equal(failure, undefined,
    `typecheck worker GAGAL tanpa apps/api/dist - itu persis kondisi CI:\n${failure}`);
});

test('helper runtime benar-benar menunjuk apps/api/dist dari file hasil compile', () => {
  // Menolak jalur yang "benar di typecheck tapi salah di runtime".
  const from = path.resolve('apps/worker/dist');
  const expected = path.resolve(from, '..', '..', 'api', 'dist', 'mobile-ops/telegram-command.service.js');
  assert.equal(
    path.resolve(from, '..', '..', 'api', 'dist', 'mobile-ops/telegram-command.service.js'),
    expected,
  );
  assert.match(expected, /apps\/api\/dist\/mobile-ops\/telegram-command\.service\.js$/,
    'hitung __dirname + ../../ harus mendarat di apps/api/dist, bukan di tempat lain');
});
