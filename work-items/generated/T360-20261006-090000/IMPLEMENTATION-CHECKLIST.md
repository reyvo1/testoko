# P6B verification checklist

- [x] Recover operator handoff and verify P6A exact GitHub green baseline.
- [x] Audit canonical domain paths and additive migration/rollback plan.
- [x] Weighted label validation, tenant-owned policy and immutable kit snapshots.
- [x] Admin/POS/Storefront surfaces and idempotent configuration.
- [x] SQLite behavioral tests, concurrency, replay, historical return, reservation/cancellation.
- [x] SQLite expand rehearsal.
- [x] Final stable-source full local candidate gate on scratch TEST (1714/1714, lint, six-app build, boot, migration).
- [x] Exact-source PostgreSQL P6B probe and full GitHub workflows (3d8e774, runs 37358962197/37358970410).
- [x] P6B Browser operator-path evidence (scanner, manual weight, loaded raster).
- [ ] P6C/P6D continuation after prerequisite gates.
- [ ] Human Stage-20 (separate mandatory gate).

- [ ] Auxiliary PR CI prerequisite repair exact-commit green.
