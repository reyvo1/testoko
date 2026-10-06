# T360-20261006-125000 expand-only retail orchestration

Authority: ADR-T360-20261006-125000-RETAIL-ORCHESTRATION and P6C/P6D design.
Apply only after P6B expansion. Adds orchestration/consent/campaign lineage and
nullable staff/shift links, contact-bound consent proofs and canonical ReportJob retry/lease fields; no second money/stock ledger. SQLite/PostgreSQL parity.
No consent, balance or historical order lineage backfill. Legacy absent preferences
mean no marketing consent; NULL staff/shift links preserve existing order behavior.

Tenant/date/id, customer/refund/account/status and shift/post-date indexes support
bounded lists, campaign cursors and canonical journal aggregation. Rehearse on
explicit isolated TEST preserving legacy rows, then STAGING with query plans.
Production requires an approved backup/restore point before expansion.

Rollback application and disable new ingress; retain additive tables/columns and
immutable snapshots. Close existing deposit liabilities through canonical refund
documents. Use inspected returns/journal reversals for posted effects. Cancel
future campaigns and reconcile in-flight provider acceptance. Do not drop data.

ReportJob attempt/lease defaults preserve existing jobs. Coretax jobs use bounded retries/dead-letter and reclaim expired leases; legacy report processing is unchanged. No historical RUNNING job is reclassified without an explicit Coretax lease.
