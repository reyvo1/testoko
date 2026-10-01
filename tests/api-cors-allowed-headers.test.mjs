// allow-list header CORS harus lengkap terhadap header yang benar-benar dikirim client.
//
// Bug yang ditemukan: `app.enableCors({ origin, credentials: true })` tanpa allowedHeaders.
// Default Nest hanya mencantumkan header "simple" + Authorization. Admin page.tsx mengirim
// `Content-Type: application/json` pada setiap request (authFetch), jadi preflight menanyakan
// `content-type`, browser menolak seluruh request dengan net::ERR_FAILED TANPA status HTTP, dan
// UI menampilkan "Gagal memuat: Produk, Konfigurasi aplikasi, Konteks cabang" - padahal API
// sehat dan endpoint-nya balas 200 di curl.
//
// UAT tidak menangkap ini karena tidak pernah menguji request ber-preflight dari browser pada
// alur yang gagal itu; test ini menutup celah itu di level konfigurasi.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = await readFile(new URL('../apps/api/src/main.ts', import.meta.url), 'utf8');
const adminPage = await readFile(new URL('../apps/admin/app/page.tsx', import.meta.url), 'utf8');

test('precondition: Admin benar-benar mengirim Content-Type pada request', () => {
  // Kalau ini tidak true, test di bawah tidak punya bukti bahwa allow-list perlu content-type.
  assert.match(adminPage, /headers:\s*\{\s*'Content-Type':\s*'application\/json'/);
});

test('enableCors mencantumkan allowedHeaders yang memuat Content-Type', () => {
  const cors = main.match(/app\.enableCors\(\{[\s\S]*?\}\);/);
  assert.ok(cors, 'app.enableCors({...}) tidak ditemukan');
  assert.match(cors[0], /allowedHeaders/, 'allowedHeaders tidak diset - preflight akan menolak header client');
  assert.match(cors[0], /Content-Type/i, 'Content-Type harus ada di allowedHeaders');
  assert.match(cors[0], /Authorization/i, 'Authorization harus ada di allowedHeaders');
});

test('credentials:true dipertahankan dan tidak digabung dengan origin wildcard', () => {
  const cors = main.match(/app\.enableCors\(\{[\s\S]*?\}\);/);
  assert.match(cors[0], /credentials:\s*true/);
  // Wildcard + credentials ditolak browser, jadi jangan dikombinasikan.
  assert.ok(!/origin:\s*['"]\*['"]/.test(cors[0]), 'origin wildcard tidak boleh dipakai bersama credentials');
});

test('perlindungan environment staging/production tetap berlaku', () => {
  // CORS Origins wajib dikonfigurasi di environment terlindungi - jangan dilonggarkan demi
  // membuat preflight lolos.
  assert.match(main, /CORS_ORIGINS wajib dikonfigurasi/);
  assert.match(main, /origins\.includes\('\*'\)/);
});