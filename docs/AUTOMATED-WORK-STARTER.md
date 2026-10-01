# Toko360 One-Click Work Automation

Dokumen ini menjelaskan tombol `.cmd` yang menyiapkan pekerjaan berdasarkan Development Kit dan roadmap.

## Tujuan

Saat `mulai-pekerjaan-otomatis.cmd` atau `buat-work-item.cmd` diklik, sistem dapat:

1. membaca backlog pada `config/implementation-backlog.json`;
2. memastikan dependency pekerjaan telah selesai;
3. memilih tugas READY dengan prioritas tertinggi;
4. membuat work item lengkap pada `work-items/active/`;
5. membuat branch Git jika kondisi repository aman;
6. membuat paket kerja di `work-items/generated/<WORK_ITEM_ID>/`;
7. menjalankan workflow validation;
8. membuka `TASK.md` di VS Code atau Notepad;
9. menjalankan external agent hanya bila dikonfigurasi secara eksplisit.

## Tombol Windows

### Mulai otomatis

```text
mulai-pekerjaan-otomatis.cmd
```

Menu:

- Ambil tugas roadmap berikutnya.
- Buat pekerjaan khusus.
- Lanjutkan pekerjaan aktif.
- Lihat status workflow.

`buat-work-item.cmd` membuka menu yang sama agar kompatibel dengan workflow versi sebelumnya.

### Lanjutkan pekerjaan

```text
lanjutkan-pekerjaan.cmd
```

Membuka paket work item aktif. Bila lebih dari satu work item aktif, pengguna memilih salah satunya.

### Status

```text
status-pekerjaan.cmd
```

Menampilkan jumlah backlog, pekerjaan aktif, dependency yang sudah selesai, serta tugas berikutnya yang READY.

## Perintah terminal

```bash
npm run work:auto
npm run work:custom
npm run work:resume
npm run work:status
```

## Isi paket otomatis

Setiap pekerjaan menghasilkan:

```text
work-items/generated/<WORK_ITEM_ID>/
├── TASK.md
├── IMPLEMENTATION-CHECKLIST.md
├── AI-PROMPT.md
├── SESSION-HANDOFF.md
└── BUKA-PEKERJAAN.cmd
```

`TASK.md` menjadi titik mulai developer. `AI-PROMPT.md` adalah instruksi lengkap yang dapat diberikan kepada coding agent. `SESSION-HANDOFF.md` digunakan saat berpindah sesi atau developer.

## Backlog machine-readable

Backlog resmi berada di:

```text
config/implementation-backlog.json
```

Setiap item mempunyai:

- key dan priority;
- dependency;
- module dan delivery wave;
- risk;
- feature flag;
- dampak database, inventory, accounting, tax, payment, payroll, sync, security, dan performance;
- business rules;
- acceptance criteria;
- test plan;
- dokumentasi sumber.

Tugas otomatis hanya dipilih apabila seluruh dependency backlog sudah mempunyai work item `CLOSED` pada `work-items/completed/`.

## Git branch

Apabila Git tersedia dan working tree aman, script membuat branch seperti:

```text
feature/t360-20260729-220800-atomic-stock-mutation
security/t360-20260729-220800-tenant-isolation
```

Apabila repository sudah mempunyai perubahan yang belum disimpan, script tidak memindahkan branch agar pekerjaan pengguna tidak hilang.

## Optional external agent

Konfigurasi berada di:

```text
config/work-automation.json
```

Default:

```json
{
  "agent": {
    "enabled": false,
    "command": "",
    "args": ["{promptFile}"]
  }
}
```

Agent tidak aktif secara bawaan. Untuk menjalankan coding agent eksternal, isi command yang memang tersedia pada komputer dan aktifkan `agent.enabled`. Script akan memberikan `AI-PROMPT.md` kepada command tersebut.

## Batas otomatisasi

Tombol `.cmd` dapat menyiapkan pekerjaan, branch, paket instruksi, checklist, dan optional agent hook. Ia tidak boleh menandai fitur sebagai selesai tanpa:

- perubahan source code;
- test sesuai work item;
- quality gate;
- staging/UAT bila diperlukan;
- release evidence.

Keputusan bisnis, credential vendor, tarif pajak resmi, migration production, dan konflik data tetap membutuhkan review manusia.
