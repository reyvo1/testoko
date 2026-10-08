# Project Checkpoints

Checkpoint adalah snapshot yang telah melewati quality gate, bukan sekadar nama ZIP.

Format:

```text
RC<major>.<minor>.<patch>.<sequence>_<MODULE>_<MILESTONE>
```

Contoh:

```text
RC0.5.1.1_WORKFLOW_GOVERNANCE_BASELINE
RC0.6.0.3_INVENTORY_ATOMIC_POSTING
```

Checkpoint wajib mencatat:

- Commit SHA dan tag.
- Work item yang masuk.
- Migration version.
- Feature flag state.
- Hasil CI/UAT/load test.
- Database backup/restore point.
- Known issues.
- Rollback procedure.

Hanya checkpoint terakhir yang dinyatakan resmi di release notes yang boleh menjadi basis sesi pengembangan berikutnya.

## RC0.5.2.1_ONE_CLICK_WORK_AUTOMATION

- Baseline: v0.5.2.
- Menambahkan backlog machine-readable, pemilih dependency-aware, work packet generator, branch automation, editor launcher, dan optional external-agent hook.
- Tidak mengubah schema atau data bisnis.
- Baseline resmi menggantikan RC0.5.1.1 untuk pekerjaan berikutnya.

## RC0.5.3.1_EMBEDDED_INSTRUCTIONS_DYNAMIC_CHAT_HANDOFF

- Baseline: v0.5.3.
- Menambahkan instruksi sistem canonical maksimal 8.000 karakter dan adapter untuk agent/Copilot/ChatGPT.
- Menambahkan generator chat pertama dinamis berdasarkan checkpoint, Git, work item, database profile, backlog, dan quality gate.
- Menambahkan tombol pindah akun/chat, clipboard automation, pencatatan quality gate, dan perlindungan secret.
- Tidak mengubah schema atau data bisnis.
- Baseline resmi menggantikan RC0.5.2.1 untuk pekerjaan berikutnya.

## Engineering evidence — P6B sequencing 2026-10-06

This is engineering sequencing evidence, not a new formal release tag/checkpoint.
P6B work item T360-20261006-090000, business commit
12537b96547f9fd88849fa92902a65cf97d3ec7b, fingerprint
0a5cb03bd41ac8f5bdeee4f51795f754ffa8743405297f85398cefbcd1689757,
passed Governance 37363402271, CI 37363402348, Full System 37363589397 and
Full Automated UAT 37363596627. Additive migration T360-20261006-p6b-retail-snapshots
was rehearsed on TEST; no production database or backup was changed. Main remains
P6A, P6B is draft PR #1. Existing device/provider certification and Human Stage-20
remain PENDING. Rollback disables new product retail policies while preserving
immutable snapshots and compensating posted effects through canonical returns.

The operator authorizes combined P6C/P6D work item T360-20261006-125000 and all-menu
UI/backend parity verification before one push. The formal checkpoint at the top
of PROJECT-STATE remains unchanged until its actual release workflow passes.
