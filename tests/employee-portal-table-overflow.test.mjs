import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(repoRoot, 'apps', 'employee-portal', 'app', 'globals.css'), 'utf8');
const ux = fs.readFileSync(path.join(repoRoot, 'apps', 'employee-portal', 'app', 'employee-portal-app.tsx'), 'utf8');

test('container tabel Employee Portal tidak boleh melebar mengikuti konten', () => {
  // Runner: viewport 390x844, .table terukur 642px (right=679) sehingga dokumen scrollWidth
  // 679 dan dianggap overflow. Penyebabnya .table tidak dikunci lebarnya, jadi min-width:auto
  // membuatnya mengikuti .tr yang min-width:640px.
  assert.match(css, /\.table\{[^}]*min-width:0/, 'wajib ada min-width:0');
  assert.match(css, /\.table\{[^}]*width:100%/, 'wajib dikunci width:100%');
  assert.match(css, /\.table\{[^}]*max-width:100%/, 'wajib ada max-width:100%');
  // Sifat scrollable wajib tetap ada - tanpa itu konten jadi tidak terjangkau.
  assert.match(css, /\.table\{[^}]*overflow-x:auto/);
});

test('baris tabel Employee Portal boleh lebih lebar dan harus bisa digeser', () => {
  // min-width pada .tr memang disengaja: kolom Slip gaji butuh lebar. Justru itu alasan
  // .table harus jadi container scroll, bukan ikut melebar.
  assert.match(css, /\.tr\{[^}]*min-width:640px/);
});

test('kartu induk tabel punya min-width:0 agar rantai pem contractions tidak melebar', () => {
  // Tanpa min-width:0 pada .card, rantai flex/grid tetap bisaBreast ke konten di dalamnya.
  assert.match(css, /\.card\{[^}]*min-width:0/);
});

test('Employee Portal memuat .table di dalam article.card', () => {
  // Mengunci struktur yang diuji: kalau .table pindah ke induk lain, fix width:100%
  // mungkin tidak lagi berlaku dan test ini perlu ditinjau ulang.
  assert.match(ux, /<article className="card">[\s\S]{0,2200}?<div className="table">/);
});
