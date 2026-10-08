# Akses baca role — disetujui dan diterapkan

Review persetujuan otomatis menolak perluasan otoritas ini pada 2026-10-08 karena sinkronisasi frontend umum belum memberi izin eksplisit untuk mengubah batas akses finansial/aset. Penolakan tersebut kini historis: operator menjawab “Izinkan akses baca terbatas tersebut” pada pertanyaan review proposal ini. Patch backend dan pemanggil UI telah diterapkan sesuai izin itu.

## Perubahan yang diminta

1. ADMIN dengan finance.view dapat membaca kode/nama/tipe/status akun pada cabang aktif. Endpoint yang ada sudah memilih hanya id, code, name, type, isActive; tidak mengirim saldo atau jurnal.
2. ADMIN dapat membaca daftar draft/transaksi operasional yang dibuat oleh akun itu sendiri. Filter company/branch tepercaya tetap wajib dan createdById berasal dari JWT. SUPER_ADMIN/OWNER/FINANCE/AUDITOR mempertahankan scope yang sudah sah. ADMIN tidak memperoleh approve/post/reject/cancel atau pembacaan jurnal, pajak, saldo dan transaksi rekan.
3. WAREHOUSE dengan asset.maintenance dapat memilih aset pada perusahaan/cabang aktif untuk form perawatan yang sudah diizinkan. Endpoint baca baru hanya mengirim id, code, name, assetType, status, dengan pencarian dan cursor pagination. Tidak ada nilai akuisisi/buku, GPS, penanggung jawab, payroll atau data pribadi.

Tidak ada schema/migration atau perubahan posting inventory/accounting/tax. Frontend memakai katalog minimal yang terpisah dari rincian finansial aset, pencarian/pagination dan daftar keuangan milik Admin; tombol mengikuti guard aktual. Rollback mencabut tiga akses baca dan mengembalikan pemanggil UI secara bersama.

## Bukti yang wajib sebelum push

- Actual SQLite/PostgreSQL: Admin tidak melihat draft rekan/cabang/tenant lain; Warehouse tidak memperoleh rincian finansial aset; cursor/search dan scope kosong/asing fail closed.
- Matriks actual Nest role/permission; deny POST approve/post untuk Admin tetap berlaku.
- Browser: pilihan aset Warehouse, pengemudi dari penugasan fleet yang sudah sah, dan draft Admin dapat digunakan; seluruh 12 role/empat frontend serta quality gate tetap wajib.
- Produk tetap belum final: PPOB kas/jurnal, sertifikasi provider/perangkat dan Human Stage-20 terpisah.

Patch: handoff/proposals/T360-20261006-125000-role-access.patch. Diterapkan sesudah izin eksplisit. Test layanan SQLite dan matriks controller awal lulus 11/11; seluruh gate versi akhir masih wajib sebelum push. Tidak ada izin approve/post atau data rekan yang ditambahkan.

Query tetap memakai scope company/branch dan indeks tenant yang sudah ada; filter creator Finance diterapkan di database. Tidak ada migration, backfill atau perubahan data production. Rollback harus mencabut pemanggil UI dan akses baca backend bersama; pertahankan draft/receipt/audit yang telah tersimpan.
