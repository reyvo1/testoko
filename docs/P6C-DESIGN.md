# P6C — implemented retail orchestration, verification in progress

Authority: T360-20261006-125000 and the operator's 2026-10-06 instruction to
combine P6C/P6D with the full UI/API audit before one publication. P6B exact
12537b9 passed all four required GitHub workflows. Canonical product phase P5,
productReady=false and Human Stage-20=PENDING remain unchanged.

## Implemented boundaries

- Direct exchange reuses inspected SaleReturn and SalesService in one outer
  serializable transaction with whole-operation retry, payload-bound idempotency,
  immutable tender/stock facts and explicit server cash difference. The initial
  supported settlement is CASH to CASH under an owned open shift and intersected
  sale/create/return/refund authority. Provider/AR netting is not implemented.
- Customer deposits reuse approved OperationalFinanceTransaction and Accounting
  Core journals. A dedicated active liability account distinct from order advance
  2105 is mandatory. No wallet/balance table. Available balance subtracts pending
  refund holds; consumption and repayment preserve customer/account lineage.
  Manual/generic finance cannot bypass the reserved account. Original historical
  deposit refunds remain available when new-ingress flag is disabled.
- CustomerCommunicationPreference is customer-owned, marketing and receipt
  consent are separate, and opt-in is bound to verified current contact hashes.
  AutomationJob batches at most 100 customers and Notification workers recheck
  consent/ownership/flag/campaign before transport. Delivery status is bounded
  and omits destinations/message body/provider responses from staff evidence.
- Receipts require an expiring HMAC share bound to sale/company/branch, minted
  under staff sale.view or authenticated customer ownership. Bare receipt-number
  access is denied. POS reprint, customer-owned receipt history and consented
  email/WhatsApp notification controls use these protected paths. Notification
  contains an account login link, never an open financial attachment/share token.

## Operator surfaces and configuration

Admin Finance/Receivables exposes draft, approval, posting and balance controls.
Integrations/Notifications exposes campaign templates, create/cancel and bounded
status history. POS Returns exposes exchange quote/confirmation; receipt history
exposes reprint and consented delivery. Storefront Account exposes separate
communication preferences and owned receipts. Existing permission guards remain
server authoritative; offline new retail paths are rejected.

Flags retail_exchange, customer_deposit and customer_campaign default OFF.
customer_deposit.config.accountCode names the dedicated liability account; a
branch DEPOSIT tender must match it and be immediate, fee/provider free and online.
RECEIPT_SIGNING_KEY should be a separately managed >=32-character secret; the
existing JWT_SECRET is the fallback. STOREFRONT_PUBLIC_URL and PUBLIC_API_URL must
be trusted configured HTTPS origins (loopback HTTP accepted in TEST only). Never
put actual secrets in source/handoff. Actual notification provider acceptance is
separate from local queue verification.

## Migration, tests and rollback

Versioned additive SQL T360-20261006-p6cd-retail-orchestration matches SQLite and
PostgreSQL. Adds exchange lineage, consent/contact proofs, campaign/delivery
records and optional finance shift lineage, without inferred historical consent
or balance backfill. Tenant/date/customer/status indexes support bounded cursors
and liability aggregation. TEST rehearsal preserves legacy fixtures; production
requires a verified backup/restore point and STAGING query-plan review.

Behavioral tests execute real services on isolated SQLite, covering rollback,
parallel replay/overdraw, tenant/permission/inspection denial, balanced journals,
locked periods, historical refunds, consent revocation/contact changes and share
expiry/tampering/ownership. Both heavy GitHub workflows now require the additional
PostgreSQL orchestration probe and real browser operator controls. Current-source
full gates are still in progress; no provider/human certification is claimed.

Rollback disables new ingress/campaign flags and future campaign jobs, preserves
all records and immutable snapshots, and uses canonical inspected return/reversal
for posted effects. Deposit liabilities remain repayable. Reconcile in-flight
provider acceptance; already delivered messages cannot be recalled.
