import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const harness = fs.readFileSync(path.join(repoRoot, 'scripts', 'fresh-state-uat.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('fresh-state harness terdaftar sebagai npm script', () => {
  assert.equal(pkg.scripts['uat:browser:fresh'], 'node scripts/fresh-state-uat.mjs');
});

test('harness me-reset database sehingga data sisa probe tidak menyesatkan check', () => {
  // Akar masalah verifikasi lokal: DB tercemar oleh probe sehingga check yang bergantung
  // pada data (dashboard donut) hijau palsu, sementara runner merah.
  assert.match(harness, /if \(dbPath\.startsWith\('file:'\)\)/);
  assert.match(harness, /if \(fs\.existsSync\(abs\)\) \{ fs\.rmSync\(abs\)/);
  assert.match(harness, /npm', \['run', 'db:local:prepare'\]/);
});

test('harness mematikan server lama agar tidak mengukur bundle basi', () => {
  // Stale Next server menyajikan CSS hash lama; UAT lalu mengukur halaman yang tidak dikirim.
  assert.match(harness, /step\('matikan server lama di port UAT'/);
  for (const port of ['4000', '3001', '3002', '3003', '3010']) {
    assert.ok(harness.includes(port), `port ${port} harus dimatikan`);
  }
});

test('harness membangun ulang keenam app sebelum UAT', () => {
  // quality:full menghapus .next, jadi tanpa build ulang UAT mengukur bundle basi.
  for (const w of ['@toko360/api', '@toko360/worker', '@toko360/admin', '@toko360/pos', '@toko360/storefront', '@toko360/employee-portal']) {
    assert.ok(harness.includes(w), `${w} harus dibangun`);
  }
});

test('probe kesiapan server mengiterasi objek probe, bukan labelnya', () => {
  // Bug nyata: pending berisi LABEL (string). Mengiterasi pending langsung membuat
  // probe.url undefined sehingga fetch selalu gagal, dan karena errornya disimpan di
  // key `undefined`, semua server dilaporkan "tidak diketahui" padahal sedang hidup.
  assert.match(harness, /for \(const probe of probes\.filter\(\(p\) => pending\.has\(p\.label\)\)\)/);
  assert.doesNotMatch(harness, /for \(const probe of \[\.\.\.pending\]\)/);
});

test('kegagalan probe melaporkan penyebab sebenarnya per endpoint', () => {
  // "tidak diketahui" tanpa penyebab hanya menebak dan membuat diagnosis salah.
  assert.match(harness, /const probeErrors = new Map\(\)/);
  assert.match(harness, /probeErrors\.set\(probe\.label, `\$\{error\?\.message \|\| error\}/);
  assert.match(harness, /server tidak siap -> \$\{detail\}/);
});

test('harness tidak melemahkan gate: UAT dijalankan dengan exit code apa adanya', () => {
  // Harness hanya menyiapkan kondisi. Ia tidak menelan kegagalan dan tidak menurunkan
  // threshold; exit != 0 harus tetap menjadi kegagalan harness.
  assert.match(harness, /const r = run\('npm', \['run', 'uat:browser'\], \{ env \}\)/);
  assert.match(harness, /if \(r\.status !== 0\) \{[\s\S]{0,320}throw new Error\('browser UAT gagal pada database segar'\)/);
  assert.match(harness, /HARNESS GAGAL di langkah/);
  assert.match(harness, /process\.exit\(1\)/);
});

test('harness memuat .env dan menyetel kredensial UAT dari seed', () => {
  assert.match(harness, /T360_UAT_ADMIN_EMAIL: parsed\.SEED_ADMIN_EMAIL/);
  assert.match(harness, /T360_UAT_ADMIN_PASSWORD: parsed\.SEED_ADMIN_PASSWORD/);
  assert.match(harness, /T360_UAT_HR_MUTATIONS: 'true'/);
});

test('harness menyamarkan kredensial saat mencetak DATABASE_URL', () => {
  // Jangan pernah mencetak user:password database ke log.
  assert.match(harness, /replace\(/);
  assert.doesNotMatch(harness, /console\.log\(`  DATABASE_URL=\$\{dbPath\}\)`/);
});
