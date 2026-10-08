# T360-20261006-125000 — canonical retail orchestration

Status: accepted implementation design, 2026-10-06. User requests a combined
P6C/P6D candidate and full UI/API audit before one publication. Exact P6B 12537b9
passed all four GitHub workflows. Human/release/provider acceptance stays separate.

Reuse Sales/Returns/Orders, OperationalFinanceTransaction, Accounting Core,
Notification and AutomationJob. New records represent exchange orchestration,
customer-owned communication consent, campaign intent and delivery lineage only.
They are not inventory, wallet or journal ledgers. Exchange root transaction
passes its internal transaction client to canonical services; retry surrounds the
whole exchange and stock alerts run only after commit. Initial net cash exchange
requires an owned open shift and permission intersection; providers are not netted.

Deposit account is explicitly configured active LIABILITY, distinct from existing
order advance 2105. Posted liability journal credit-minus-debit is balance truth,
tagged through AccountingEventLine customer dimensions. Pending refund documents
reserve available funds. Receipt/refund documents retain existing approval/posting.
Deposit tender is online only; original-tender returns preserve liability lineage
after ingress is disabled. No historical balance/consent is inferred or backfilled.

Customer preferences have their own durable record, changed only through existing
customer session. Campaign batches use indexed customer date/id cursor and
canonical worker leases. Notification delivery rechecks consent and verified
destination. Receipt shares have trusted-origin, tenant/id/expiry HMAC and no
secret in audit/outbox. Legacy bare public receipt access fails closed.

Staff fulfillment reuses Order reservation and Shipment inspection/posting.
Nullable staff/shift lineage preserves legacy orders; immutable Payment policy
drives cash/settlement and shift recap. Tax exports are asynchronous versioned
adapters over canonical snapshots with approved mappings and pinned official
templates, without recalculating rates or claiming production certification.

## Expand migration / backfill / query impact

Add RetailExchange (unique return/replacement and operation key, tenant date/id
index), CustomerCommunicationPreference (unique customer), CustomerCampaign
(tenant date/id index), CustomerCampaignDelivery (unique campaign/customer and
notification), nullable Order.createdById/cashierShiftId and Finance.depositCashierShiftId,
Customer tenant/date/id
index and financial customer/account/status index. Mirror SQLite/PostgreSQL.
No destructive change, no historical backfill. Nullable legacy order lineage and
absent preference preserve old transactions and default marketing off.

Rehearse expansion on explicit scratch TEST preserving previous schema rows;
production requires verified backup/restore point and staged query/index review.
Use database aggregate joins for balances, bounded queries for campaign/customer
and operator lists. No full-directory scans in a request.

## Failure, rollback and evidence

Any failed exchange rolls back return, replacement, stock, journals and receipt.
Disable new flags for rollback while allowing immutable deposit liability
closeout/historical refunds. Retain additive records; canonical reversal/return
compensates posted effects. Pause future campaign/provider jobs and reconcile
in-flight acceptance; never claim a sent message was recalled.

Verify actual replay/tamper/concurrency/tenant/permission/period/inspection,
balanced accounting, old tender returns, consent revoke, signature/expiry,
worker retry and cursor limits. Add required PostgreSQL/browser probe paths;
run stable-source full candidate, migration and all audits before one push.
External provider/sandbox and Human Stage-20 evidence cannot be fabricated.

ReportJob remains the single asynchronous export engine. Coretax jobs add atomic
leases, bounded retry/backoff/dead-letter and checks against the owned issued
document's immutable reviewed snapshot before rendering. Broad report lists redact
legal mappings; secure XML download requires tax/report authority and expiry.
No automatic DJP/provider submission or production certification is inferred.

Tax calendar authority remains Accounting Core over trusted company timezone.
New Sales/Order documents reuse the posted period/recognition instant; XML review
uses the company business date. Invalid calendar or historical period mismatch
fails closed. Existing posted periods and approved snapshots are not backfilled.
Original offline transaction business time is preserved before calendar conversion.
