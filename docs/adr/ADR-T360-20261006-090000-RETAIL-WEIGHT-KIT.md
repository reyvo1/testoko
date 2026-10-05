# ADR T360-20261006-090000: weight units and virtual kit snapshots

Status: accepted for P6B verification; rollout remains opt-in and dependent on runtime gates.

## Context

Inventory quantities, reservations, movements, sync receipts and return allocation already use integer base units. Manufacturing owns ProductionRecipe. Accounting Core owns journals and versioned effective tax. Replacing stock with floating values or creating a second BOM/ledger would introduce incompatibility and reconciliation risk.

## Decision

Represent fractional commercial weight with integer smallest base units (250 GR = 0.250 KG). Validate configured scale EAN checksum, exact base conversion, stock and server price. Preserve full scanned label for retry/audit. Exact ordinary barcode lookup takes precedence over scale parsing. Reject unsupported weighted offline replay.

Store gallery and disabled-by-default weighing/kit policy in existing Product metadata. Media is bounded raster HTTPS/local paths without credentials or query tokens. The browser loads images directly; core performs no remote server fetch.

Use canonical active tenant ProductionRecipe for virtual kits, supporting only non-tracked physical components, no nested kits/waste and positive integer ratios. Resolve component costs and quantities inside the sale/order transaction and store immutable snapshots on SaleItem/OrderItem and return rows. Aggregate shared components before posting or reserving stock. Return/cancel reads original snapshots even when the current recipe/policy changes.

Virtual parent requires zero physical stock/reservation. Receiving/production/opname reject virtual parent stock; components retain canonical warehouse paths. If a historical operation produces parent stock after enablement, future kit resolution fails closed and catalog remains editable with an explicit domain error. No historical data is overwritten to fix it.

## Consequences and rollout

Only additive nullable JSON columns in SQLite/PostgreSQL; existing NULL rows retain legacy behavior. No historical backfill or new snapshot index. TEST expand rehearsal preserves existing transactions. Production application requires backup/restore evidence and normal migration approval, never db push/reset/demo seed.

Rollback disables policies and reverts application while leaving additive columns/snapshots. Posted effects use canonical returns/reversals. Monitor shortages, rejected labels, location drift, accounting balance and queue failures. External physical scale devices are not certified by scanner-label tests.

## Verification

SQLite behavior: replay/tamper/tenant, concurrent shared stock, return after BOM edit, order reservation/cancel, nested/physical-parent/stale recipe rejection. PostgreSQL probe and Browser immediate-scanner/manual-weight/gallery tests are mandatory runtime gates. Canonical product readiness and Human Stage-20 are unchanged.
