# P6D — implemented fulfillment and versioned XML, verification in progress

The operator authorized combined P6C/P6D implementation and one publication after
local verification. P6B exact-source dependency is green. Human Stage-20 remains
PENDING and productReady=false; selected production providers remain unconfirmed.

## Tax source audit — 2026-10-06

DJP lists Coretax XML imports and PJAP host-to-host channels:
[official template directory](https://pajak.go.id/id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml),
[official issuance channels](https://stats.pajak.go.id/index.php/id/siaran-pers/penerbitan-faktur-pajak).
The downloaded public archives were inspected for element names only; no sample
identities were copied to repository, logs or handoff.

| Public template | Archive SHA-256 | Notes |
| --- | --- | --- |
| [Faktur PK v1.4](https://pajak.go.id/sites/default/files/2025-03/Sample%20Faktur%20PK%20Template%20v.1.4.xml.zip) | a71d6c004f7d0979b9f33eedc7f669daf3238e6820d2decd13525f2cc32b9beb | TaxInvoiceBulk / ListOfTaxInvoice / TaxInvoice / GoodService; preserves official BuyerAdress spelling |
| [BPPU Unifikasi](https://pajak.go.id/sites/default/files/2024-12/bppu.zip) | 8a90ea38737bd8d5f0563c12c11ec076b91138f0865ac9f46fd0d4414b004deb | BpuBulk / ListOfBpu; implemented separate BPPU contract |
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

## Trusted business calendar

Accounting Core derives new TaxTransaction periods from the authenticated company
timezone. Sales and Order tax documents reuse that posted period and the same
recognition instant. Reviewed XML uses the company business date, not UTC day.
Missing/invalid timezone aborts posting. Export rejects historical period/date
mismatches for explicit canonical review/correction; no historical backfill or
mutation is performed. Previously approved immutable snapshots remain unchanged.
The actual month-boundary regression covers Asia/Makassar, UTC, historical
immutability and invalid-calendar transaction rollback.

## Ship-later / ship-from-store reuse

Existing OrdersService reserves stock and posts order advances to account 2105;
Shipment uses outbound inspection, picking/packing, gate pass and atomic shipment
posting. POS must create that Order under trusted staff branch/customer authority,
not first post a Sale then duplicate it as an Order. Preserve immutable P6B kit
components through reservations and return flows.

Staff Order now binds the trusted actor/customer/branch and owned open shift.
Cash confirmation uses an immutable immediate CASH tender snapshot and the same
canonical order-advance event; normal legacy bank prepayment keeps account 1102.
Shift recap includes paid/refunded staff Order cash once. Pending unpaid staff
orders block shift close and have bounded recovery/cancellation controls. No Sale
is created for this flow. Shipping retains inspection/packing/physical posting.
Paid orders close through canonical customer return/refund, never unpaid cancel.

## Gates and rollback

Before schema changes, define additive SQLite/PostgreSQL SQL and indexes, legacy
NULL behavior, TEST migration/rollback evidence and production backup/restore
prerequisite. Test tenant/permission boundaries, locked periods, balanced core
journals, idempotency/concurrency, reservation/retry/conflict and provider errors.
Run existing local candidate and all exact-source GitHub gates. Disable ingress
and adapter delivery for rollback; retain pending receipts and posted snapshots,
reconcile in-flight external operations and use canonical compensation.

## Implemented XML workflow and limits

TaxDocument/TaxTransaction/posted AccountingEvent reconciliation supplies amounts.
Historical versioned TaxCode.calculationRules.coretax supplies statutory VAT rate
and OtherTaxBase ratio, or BPPU object code. Export refuses missing mapping,
amount/rate overrides, source drift, wrong ownership and mismatched posted totals.
Legal review snapshots seller/branch TIN/NITKU and buyer/transaction/product/unit
codes; approval is immutable and auditable. Faktur PK v1.4 and BPPU 2024-11 have
separate pinned contracts and checksums in the shared renderer.

Admin Finance/Tax exposes source reconciliation, legal approval, queue status and
authenticated XML download. Canonical ReportJob carries immutable checksummed
facts, scope/review checks, atomic leases, bounded retries, backoff/dead-letter and
lease recovery. Download expires after one day and requires tax/report authority;
broad report lists redact legal mappings. Physical file cleanup uses the existing
report storage operational retention policy and needs deployment review.

The first Faktur export supports issued original Sale/Order VAT documents with
fully reconciled goods lines. Shipping/service fees without corresponding export
source lines, corrections/replacements/cancellations and nonzero luxury tax fail
closed; dedicated contracts/mappings are required before enabling those cases.
Payroll BPMP remains its own domain and is not certified by BPPU output. These
exports are operator-reviewed files, not automatic DJP/PJAP submission. Public
archive checksums prove the pinned sample structure, not statutory/XSD acceptance.

Flags pos_ship_later and tax_export default OFF. Production requires actual PJAP,
shipping/payment provider selection, sandbox specs/configuration, acceptance,
rejection/replay/reconciliation evidence and legal/operator review. TEST queue and
XML correctness cannot substitute for those requirements.
