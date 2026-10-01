# Troubleshooting instalasi Toko360

## Persyaratan lokal

- Windows 10/11 64-bit, Linux, atau macOS.
- Node.js 22 LTS direkomendasikan; minimum 20.9.
- npm yang ikut terpasang bersama Node.js.
- Akses HTTPS ke `https://registry.npmjs.org/`.
- Folder proyek sudah diekstrak penuh, bukan dijalankan dari dalam ZIP.

## Instalasi normal

Windows:

```bat
setup-local.cmd
```

Terminal:

```bash
npm run setup
```

## Jika berhenti pada “Memasang dependency”

1. Jalankan `diagnose-install.cmd`.
2. Buka `logs/diagnose-install.log`.
3. Periksa hasil `npm ping`, registry, proxy, dan cache.
4. Jalankan `install-dependencies.cmd` untuk mencoba instalasi ulang saja.

Installer menyimpan log lengkap pada `logs/setup-*.log`. Installer memeriksa DNS/registry lebih dulu dan hanya menjalankan `npm ci` bila preflight lolos, sehingga kegagalan jaringan tidak menggantung lama atau mengubah dependency tree setengah jalan.

## Error jaringan

Kode yang umum: `EAI_AGAIN`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`.

- Coba hotspot atau jaringan lain.
- Matikan VPN sementara.
- Periksa proxy kantor/sekolah.
- Pastikan firewall atau antivirus tidak memblokir Node.js/npm.
- Pastikan registry:

```bat
npm config get registry
```

Nilai normal:

```text
https://registry.npmjs.org/
```

## Error sertifikat

Kode umum: `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Jangan menetapkan `strict-ssl=false` secara permanen. Periksa antivirus HTTPS inspection atau sertifikat proxy organisasi.

## Error izin folder

Kode umum: `EPERM`, `EACCES`, `EBUSY`.

- Ekstrak ke `C:\Projects\toko360` atau folder Dokumen milik pengguna.
- Jangan gunakan `C:\Program Files`.
- Jangan menjalankan setup langsung dari ZIP.
- Tutup proses Node.js, VS Code, dan terminal lain yang memakai folder tersebut.

## Cache

Gunakan:

```bat
npm cache verify
```

Hapus cache hanya bila log menunjukkan kerusakan integritas:

```bat
npm cache clean --force
```

## Konflik dependency

Installer otomatis mencoba ulang dengan `--legacy-peer-deps` hanya jika terdeteksi konflik peer dependency.

## Instalasi manual

```bat
npm ci --no-audit --no-fund --prefer-online --fetch-retries=1 --fetch-timeout=15000
npm run db:local:prepare
npm run validate:repo
npm run test:db:smoke
npm run dev
```
