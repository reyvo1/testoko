# P6D adapter and fulfillment design — not activated

P6D implementation depends on P6C runtime acceptance. This is preparatory audit
evidence only. Human Stage-20 and productReady are unchanged.

## Tax source audit — 2026-10-06

DJP lists Coretax XML imports and PJAP host-to-host channels:
[official template directory](https://pajak.go.id/id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml),
[official issuance channels](https://stats.pajak.go.id/index.php/id/siaran-pers/penerbitan-faktur-pajak).
The downloaded public archives were inspected for element names only; no sample
identities were copied to repository, logs or handoff.

| Public template | Archive SHA-256 | Notes |
| --- | --- | --- |
| [Faktur PK v1.4](https://pajak.go.id/sites/default/files/2025-03/Sample%20Faktur%20PK%20Template%20v.1.4.xml.zip) | a71d6c004f7d0979b9f33eedc7f669daf3238e6820d2decd13525f2cc32b9beb | TaxInvoiceBulk / ListOfTaxInvoice / TaxInvoice / GoodService; preserves official BuyerAdress spelling |
| [Dokumen dipersamakan bukti potong](https://pajak.go.id/sites/default/files/2024-12/ddbu.zip) | 640f14ce5895e4ed18c54918cb4b577a23092e5c0a5a88fde2e66b247f724e6e | SDocsBulk / ListOfSDocs; distinct from ordinary unification bupot |
| [BPMP monthly payroll](https://pajak.go.id/sites/default/files/2024-12/bpmp.zip) | d4973f18262cef8a0548be1e9b6e7c05fa844ae18360a15c456bc95cd27cbfb3 | MmPayrollBulk / ListOfMmPayroll; separate payroll ownership |

These are public sample templates, not an XSD or permission to submit tax data.
The directory lists newer converter versions separately. A sample alone does
not establish all statutory validation, accepted codes, provider API contract,
digital-signature requirements or production certification.

## Adapter boundary

Use canonical TaxDocument / TaxTransaction and versioned, effective Tax Core
configuration. Never recalculate rates in an export/provider adapter. Record
template version/hash and approved mappings for seller/branch NITKU, buyer
identity, transaction/object/unit codes, tax base, other tax base, VAT/withholding
and luxury-tax fields. Missing mappings must reject export before transmission.
An eFaktur invoice, unification bupot and payroll bupot are separate contracts;
one generic payload is insufficient.

Large exports/submissions run through canonical asynchronous jobs and adapters,
with bounded batches, stable document operation keys, immutable request checksum,
provider receipts, retry/dead-letter and reconciliation. A retry after timeout
must reconcile provider acceptance before resubmitting. Correction/cancellation
must reference the original document; no silent replacement of posted history.

Production activation requires selected PJAP/provider specification, sandbox
configuration in secret management, real acceptance/rejection/replay evidence,
approved legal mapping and operator review. No credentials may enter chat/source.
Simulation may validate our adapter boundary but cannot satisfy that certificate.

## Ship-later / ship-from-store reuse

Existing OrdersService reserves stock and posts order advances to account 2105;
Shipment uses outbound inspection, picking/packing, gate pass and atomic shipment
posting. POS must create that Order under trusted staff branch/customer authority,
not first post a Sale then duplicate it as an Order. Preserve immutable P6B kit
components through reservations and return flows.

Current order prepayment uses bank account 1102 regardless of payment method.
Cash ship-later therefore needs an explicit immutable tender/shift lineage and
canonical cash settlement mapping before it can be enabled. Shift recap must
include that order cash ingress/refund once, without an extra finance journal.
Ordinary cashier payment confirmation cannot inherit finance authority silently.
Shipping provider status must never bypass physical inspection/stock posting.

## Gates and rollback

Before schema changes, define additive SQLite/PostgreSQL SQL and indexes, legacy
NULL behavior, TEST migration/rollback evidence and production backup/restore
prerequisite. Test tenant/permission boundaries, locked periods, balanced core
journals, idempotency/concurrency, reservation/retry/conflict and provider errors.
Run existing local candidate and all exact-source GitHub gates. Disable ingress
and adapter delivery for rollback; retain pending receipts and posted snapshots,
reconcile in-flight external operations and use canonical compensation.
