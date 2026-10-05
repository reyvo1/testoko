# P6 retail engineering waves

Authority: recovered operator package `toko360-next-chat-p6a-handoff-20261005.zip`,
`02-HANDOFF-P6A.md` sections 4 and 6. These are engineering labels; canonical
product phase remains P5 and Human Stage-20 remains PENDING.

- P6A: dynamic tenders, split payment, customer AR, original-tender refunds.
- P6B: weighted/fractional goods, scale barcode, product gallery, kit consumption.
- P6C: direct exchange orchestration and customer communication/receipt delivery.
- P6D: Indonesia tax adapters, ship-later/ship-from-store, provider certification.

Execute one wave, verify it, then proceed. No new financial/inventory ledger.
External provider certification requires real configuration and executed evidence.
The recovered package also assigns customer deposits to P6C; this is not a
customer wallet or a replacement for existing AR/payment ledgers.

## Verified P6A baseline — 2026-10-06

Local HEAD and origin/main are `d07446c6edac764aa32a3231b42faafa17913a63`.
The following exact-commit runs completed successfully:

- [Workflow Governance](https://github.com/reyvo1/testoko/actions/runs/37325983846)
- [Full System Simulation](https://github.com/reyvo1/testoko/actions/runs/37325984046)
- [Full Automated UAT](https://github.com/reyvo1/testoko/actions/runs/37325983813)

Build, regression, browser, PostgreSQL, migration rehearsal and automated
Stage-18/19/20 passed. Optional live Telegram was skipped; Human Stage-20 is
still pending. This evidence applies to that commit, not later source changes.

## P6B design

Physical inventory remains integer in the smallest configured base unit (for
example GR). Scale labels carry an integer quantity in that unit; price/tax
remain server authoritative. No global conversion of stock columns to decimals.
EAN-13 checksum and configured product key must match; ambiguous/unsupported
labels fail closed. Direct serial-port scale integration requires a device
adapter and is not certified by a keyboard-scanner test.

Gallery and weighing configuration use existing Product metadata. Kit BOM uses
existing ProductionRecipe; transaction components are immutable snapshots.
Consumed components and returned components follow canonical append-only
InventoryMovement and location balances. Accounting/tax stay in Accounting Core.
Virtual kits require zero physical parent stock/reservation. Receiving,
production posting and stock-opname of a virtual parent fail closed; components
are received/counted normally. Unexpected historical parent stock blocks kit
quotes/sales and remains visible for correction, preserving posted history.
Tracked/serial components and nested kits require dedicated lineage and must
fail closed until supported.

Migration plan: additive transaction snapshot columns only, SQLite/PostgreSQL
parity. Existing rows use NULL and retain existing behavior. No backfill of
historical transactions. No new indexes are needed for snapshot-only reads.
Rehearse against an isolated TEST database, preserving a legacy transaction;
production requires a verified backup/restore point before applying expansion.
Rollback application first, leave additive columns, disable new retail policies;
posted inventory/accounting effects use canonical returns/reversals.

P6C/P6D implementation must wait for P6B quality gates; neither is claimed complete.
