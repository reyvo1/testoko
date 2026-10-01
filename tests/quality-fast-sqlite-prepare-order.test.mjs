import assert from 'node:assert/strict';
import test from 'node:test';

const scripts = JSON.parse(
  await import('node:fs').then((fs) => fs.promises.readFile(new URL('../package.json', import.meta.url), 'utf8')),
).scripts;

// BUG yang ditemukan UAT GitHub + gate lokal 2026-10-01: `quality:fast` menjalankan `npm test`
// tanpa menyiapkan SQLite lebih dulu. Runtime test instantiate PrismaClient lewat URL SQLite,
// sehingga di mesin yang Prisma Client-nya sedang PostgreSQL (setelah `db:postgres:generate`)
// mereka gagal dengan "the URL must start with the protocol `postgresql://`" - 59 test.
// Di laptop yang kebetulan client-nya sudah SQLite, bug ini tidak terlihat sama sekali.
//
// Yang dikunci di sini adalah URUTAN, bukan isi perintahnya: `db:local:prepare` (yang sudah
// mencakup `prisma:generate:sqlite`) harus mendahului `npm test`.
test('quality:fast menyiapkan SQLite sebelum menjalankan npm test', () => {
  const fast = scripts['quality:fast'];
  assert.match(fast, /db:local:prepare/, 'quality:fast harus menyiapkan SQLite');
  assert.match(fast, /npm test/, 'quality:fast harus menjalankan npm test');

  const prepare = fast.indexOf('db:local:prepare');
  const test = fast.indexOf('npm test');
  assert.ok(prepare < test,
    'db:local:prepare harus mendahului `npm test`, atau runtime test memakai Prisma Client ' +
    'dengan protocol yang salah');
});

test('quality:full dan quality:fast tidak prepping SQLite dua kali', () => {
  // Keduanya dipanggil berurutan. `db:local:prepare` itu mahal (generate + push + seed),
  // jadi genau satu yangceland harus llevarlo.
  const full = scripts['quality:full'];
  assert.match(full, /quality:fast/, 'quality:full harus lewat quality:fast');
  //dbl.Full boleh memanggil prepare sendiri HANYA kalau fast tidak, atau sebaliknya.
  const fullPrepares = full.includes('db:local:prepare');
  const fastPrepares = scripts['quality:fast'].includes('db:local:prepare');
  assert.ok(fullPrepares !== fastPrepares,
    'hanya satu dari quality:full / quality:fast yang boleh prepping SQLite; ' +
    `full=${fullPrepares} fast=${fastPrepares} (dua-duanya = kerja dua kali)`);
});
