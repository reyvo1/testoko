// Elemen di dalam container scrollable boleh lebih lebar dari viewport - itu makna
// overflow-x auto. Check overflow harus membedakan "kelebihan yang ditangani container" dari
// "kelebihan yang berarti konten hilang".
//
// Bug yang ditemukan: `.table` punya overflow-x: auto dan `.tr` punya min-width: 660px, jadi
// setiap baris tabel PASTI lebih lebar dari area konten di 1440. Check menandai .tr sebagai
// overflow dokumen dan gagal di subdomain "Stock Opname" - padahal scrollWidth dokumen = 1440
// (sama dengan clientWidth), yang membuktikan tidak ada overflow dokumen sama sekali.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const uat = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/admin/app/globals.css', import.meta.url), 'utf8');

test('kondisi yang ditemukan benar-benar ada di CSS (tabel memang sengaja bisa di-scroll)', () => {
  assert.match(css, /\.table \{[^}]*overflow-x: auto/);
  assert.match(css, /\.tr \{[^}]*min-width: 660px/);
  // Kalau salah satu hilang, regresi ini tidak akan terpicu dan testnya jadi tidak berarti.
});

test('check overflow mengecualikan anak container scrollable, bukan elemen arbitrary', () => {
  assert.match(uat, /const isScrollable = \(el\)/);
  // Pengecualian harus berdasarkan overflowX/overflowY auto|scroll, bukan class tertentu.
  assert.match(uat, /\/\(auto\|scroll\)\/\.test\(cs\.overflowX\)/);
  assert.match(uat, /scrollableAncestors\(el\)/);
});

test('kontainer scrollable yang isinya terpotong permanen tetap digagalkan', () => {
  // Ini yang membuat pengecualian tidak jadi jalan keluar tanpa pengawas.
  assert.match(uat, /const clippedScrollables = scrollables/);
  assert.match(uat, /el\.scrollWidth > el\.clientWidth \+ 1 && r\.right > innerWidth \+ 3/);
  // clippedScrollables harus ikut jadi syarat gagal di kedua state.
  assert.match(uat, /closed\.clippedScrollables\.length/);
  assert.match(uat, /metrics\.clippedScrollables\.length/);
});

test('check tidak hanya mengandalkan scrollWidth dokumen', () => {
  // scrollWidth=1440 = clientWidth adalah bukti tidak ada overflow dokumen; check lama sudah
  // benar soal itu, dan itu harus tetap diperiksa.
  assert.match(uat, /closed\.scrollWidth > width \+ 3/);
});

test('pengecualian tidak O(n^2) pada halaman besar', () => {
  // ancestor dicek terhadap daftar scrollable yang sudah dihitung sekali.
  assert.match(uat, /const scrollables = all\.filter\(isScrollable\)/);
  assert.ok(
    !/querySelectorAll\('body \*'\)\]\.some\(/.test(uat),
    'filter overflow masih_querySelectorAll ulang di dalam loop (O(n^2))',
  );
});