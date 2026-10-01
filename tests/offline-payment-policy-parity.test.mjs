// UI POS menampilkan empat metode bayar sebagai literal `<option>`, sementara server mengirim
// `policy.paymentMethods` di endpoint config offline. Pertanyaan yang menyisakan ini: apakah daftar
// metode itu SEPADAT dengan yang server izinkan untuk mode offline?
//
// Jawabannya: TIDAK, dan memang tidak seharusnya. Server tidak mengirim daftar metode yang "boleh dipakai offline"
// — ia mengirim `['CASH']` sebagai nilai tetap yang MENJELASKAN kebijakannya lewat `note`
// ("Transaksi offline hanya menerima tunai"). Jadi `paymentMethods` itu bukan konfigurasi
// per-cabang yang perlu dibaca UI; itu satu ikon dari aturan yang ditegakkan server secara terpisah.
//
// Yang PERLU dikunci test ini, karena dua-duanya bisa lupus tanpa error:
//
//   1. UI TIDAK BOLEH mempercayai `paymentMethods` untuk keputusan transaksi. Mode offline hanya
//      boleh tunai — dan itu ditegakkan server saat replay, bukan oleh select UI. Kalau suatu saat UI
//      mulai memakai `policy.paymentMethods` untukraction menampilkan/menampilkan metode, test ini
//      harus gagal, karena saat itu ia mengira daftar itu adalah allowlist.
//
//   2. Value `['CASH']` itu tetap (bukan dari DB/env). Kalau suatu saat di-JSON-kan dari config,
//      harus ikut diuji — di sinilah drift akan muncul.
//
// Dua jebakan yang perlu dihindari saat menulis test ini:
//
//   - **Hanya assert POS punya `paymentMethods` di type** itu hampa: type member JS tidak dijalankan.
//     Yang diuji adalah APAKAH UI MEMBACA field itu di alur keputusan, dan hasilnya "tidak".
//   - **Menyebut `['CASH']` di server sebagai "hardcode yang salah"** keliru. Ini ikon kebijakan
 //     offline, bukan daftar metode dinamis — dan test ini mengunci itu sebagai policy, bukan
//     sebagai defect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pos = read('apps/pos/app/page.tsx');
const sales = read('apps/api/src/sales/sales.service.ts');

test('server mengirim paymentMethods sebagai nilai tetap, bukan allowlist per-cabang', () => {
  // Kalau ini jadi allowlist, nilainya harus datang dari DB/env. Sekarang literal — dan itu
  // DISENGAJA: endpoint ini adalah config OFFLINE, dan pesan default-nya dinyatakan di `note`.
  assert.match(sales, /paymentMethods:\s*\['CASH'\]/,
    'nilai harus tetap CASH tunggal: endpoint ini=config offline, bukan katalog metode');
  assert.match(sales, /note:\s*'Transaksi offline hanya menerima tunai/,
    'dan policy itu harus dinyatakan dalam note, supaya kasir tidak menebak');
});

test('POS hardcode 4 metode di UI, TAPI server tetap memvalidasi offline secara terpisah', () => {
  // UI menampilkan CASH/QRIS/TRANSFER/CARD sebagai literal — itu pilihan produk untuk mode ONLINE.
  const methodOptions = pos.match(/<option value="(?:CASH|QRIS|TRANSFER|CARD)"/g) ?? [];
  assert.ok(methodOptions.length >= 2,
    `harus ada literal metode di UI POS (ditemukan ${methodOptions.length}) — kalau berubah, test ini perlu ditulis ulang`);

  // Dan offline TIDAK dikendalikan oleh select UI. POS menegakkan "hanya tunai" secara lokal
  // (splitEnabled / paymentMethod !== 'CASH' memblokir offline), DAN server menegakkannya ulang saat
  // replay. Yang diuji di sini: UI punya pemeriksaan lokal, jadi kasir dapat pesan jelas, bukan 400
  // misterius dari server.
  // Anchor: `offlineQuoteState` (bukan `quoteOffline` — versi pertama saya mengarang nama itu dan
  // dapat rentang kosong, jadi assertion merah karena anchor salah, bukan karena policy hilang).
  // Dan slice ke SEJUMPLAH check berikutnya, supaya tidak menangkap blok lain yang kebetulan punya
  // teks serupa.
  const start = pos.indexOf('const offlineQuoteState = useMemo(');
  assert.ok(start > -1, 'blok offlineQuoteState harus ada — tanpa itu tidak ada offline sama sekali');
  const end = pos.indexOf('}, [', start);
  const offline = pos.slice(start, end > start ? end : start + 1600);
  assert.match(offline, /splitEnabled \|\| paymentMethod !== 'CASH'/,
    'POS harus menolak quote offline kalau bukan satu pembayaran tunai');
  assert.match(offline, /Mode offline hanya mengizinkan satu pembayaran tunai/,
    'dan harus bilang begitu ke kasir, bukan 400 tanpa penjelasan');
});

test('UI TIDAK pernah membaca policy.paymentMethods untuk keputusan apa pun', () => {
  // Ini assertion yang negation-nya delicate. `paymentMethods` muncul di TIPE POS (baris 31), tapi
  // TIDAK di alur keputusan — hanya `policy.maxOfflineAgeMinutes` yang dipakai. Kalau suatu saat UI
  // mulai memakainya (mis. filter metode dari policy), test ini harus merah — saat itu ia mengira
  // ['CASH'] adalah allowlist lengkap, padahal itu hanya ikon aturan offline.
  //
  // Cara memastikan "dipakai" bukan "dideklarasikan": cari kemunculan DI LUAR blok type. Type
  // `OfflineConfig` ada di awal file; setelah itu tidak boleh ada lagi `paymentMethods`.
  const typeDecl = pos.indexOf('paymentMethods: string[]');
  assert.ok(typeDecl > -1, 'tipe OfflineConfig harus mendeklarasikan paymentMethods');
  const afterType = pos.slice(typeDecl + 1);
  const laterUses = [...afterType.matchAll(/paymentMethods/g)];
  assert.equal(laterUses.length, 0,
    `paymentMethods muncul ${laterUses.length}x SETELAH deklarasi tipe — UI mulai memakainya sebagai `
    + 'allowlist, padahal nilainya hanya ikon aturan offline');
});