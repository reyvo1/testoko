# P6C design — dependency gate pending

Scope comes from the recovered operator P6A package: direct exchanges, customer
deposits, CRM campaigns and receipt delivery. This document is design evidence,
not implementation or runtime acceptance. P6B final exact-source gates must pass
before activating P6C implementation.

## Existing authority and decisions

- Exchanges reuse requested/approved SaleReturn, inspection/confirmation,
  SalesService, InventoryMovement and Accounting Core. One outer serializable
  transaction must contain both confirmations; retry must not commit either half.
  Initial cash net settlement requires the actor's open shift and explicit
  acknowledgement of the server-computed difference. Provider netting requires
  provider evidence. Roles/permissions must intersect existing sale and refund
  authority; ordinary CASHIER authority must not expand silently.
- Deposits reuse OperationalFinanceTransaction documents and posted Accounting
  Core liability journal lines. No mutable wallet balance or second financial
  ledger. Order advances already use account 2105; deposit configuration must use
  a separate active liability account. Receipt/refund requires draft, approval
  and posting. Consumption and pending refund holds must be tested concurrently.
  Immutable original-tender returns remain possible after disabling new deposits.
- Campaigns reuse AutomationJob batching and Notification/provider workers.
  Marketing consent must be separate from receipt consent and customer-owned;
  editable master-data metadata cannot constitute consent. Verified destinations
  and opt-out are checked again before transport. No simulated transport may
  produce production certification.
- Existing /receipts/:saleNumber is publicly enumerable. Receipt expansion must
  secure this boundary before use: tenant-bound expiring signed shares minted
  under sale.view, or authenticated customer ownership. Public origin comes from
  trusted configuration; request Host is not authority. Tokens and contact data
  must not appear in audit logs, test evidence or handoff.

## Migration and verification plan

Only additive orchestration/consent/campaign lineage required by the final design
may be added. Match SQLite and PostgreSQL schemas and versioned SQL, register the
expand migration, preserve legacy transactions in isolated TEST rehearsal, and
measure the tenant/customer/date cursor queries. Existing history has no inferred
consent or wallet backfill. Production requires a verified backup/restore point.

Behavioral verification must cover transaction rollback, exact/altered replay,
parallel exchange/deposit attempts, cross-tenant/branch denial, accounting balance,
locked periods, inspection and permission denial, historic tender refunds,
consent revocation, receipt signature/expiry/ownership, queue retry and bounded
campaign pagination. Add exact-source PostgreSQL and browser paths to both full
workflows; retain all existing gates. Human Stage-20 remains separate.

Rollback disables new ingress/campaigns, preserves additive records and original
snapshots, and uses canonical reversal/return for posted stock and money. Existing
deposit liabilities must remain repayable; pending provider work must be paused
without claiming an in-flight message can be recalled.

## P6D external design prerequisite

Selected tax/shipping/payment providers and their sandbox access are still
unconfirmed. DJP documents XML import and PJAP host-to-host channels; an arbitrary
generic HTTP adapter cannot be described as a production Coretax integration.
Current official templates must be pinned/versioned before implementing exports:
[DJP templates](https://pajak.go.id/id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml),
[DJP issuance channels](https://stats.pajak.go.id/index.php/id/siaran-pers/penerbitan-faktur-pajak).
Ship-later/from-store reuses existing Order reservation, advance, inspection,
Shipment and Accounting Core; no Sale followed by a duplicate Order posting.
