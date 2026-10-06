# P6C/P6D combined verification — T360-20261006-125000

This item follows the operator's explicit instruction to implement P6C and P6D,
inspect all four UI surfaces, and publish once after the combined local checks.
P6B dependency is exact-source runtime verified on 12537b9. Canonical product
phase remains P5, productReady=false and Human Stage-20=PENDING.

## Local verification complete — GitHub staging next

| Gate | Executed evidence | Status |
| --- | --- | --- |
| Source/domain/UI audit | 206 models, 552 API handlers, 536 UI controls; 70/70 Admin contextual destinations; nine canonical domain ownership records; recovery 48/48 | PASS |
| PostgreSQL expand migration | Explicit TEST database, legacy ReportJob status/filters/output/progress preserved; new retry/lease defaults checked | PASS |
| PostgreSQL domain runtime | All seven domain assertions pass on final fingerprint 2deee66eb3e72652bab0afa85ec195026716814b33e33575bd9816d118669c90: exchange concurrency/rollback, deposit ledger/overdraw, receipt/consent, campaign batch, inspected staff fulfillment, real XML worker and retry/dead-letter/lease recovery | PASS |
| Full local candidate | 1734/1734 regression, all-workspace lint, DB smoke, six production builds/API boot, legacy SQLite preservation, critical source mapping 12/12; unchanged fingerprint 2deee66eb3e72652bab0afa85ec195026716814b33e33575bd9816d118669c90; completed 2026-10-06T11:26:32Z | PASS |
| Built Browser UAT | 56/56 checks PASS, eight new operator scenarios, all registered navigation, no JavaScript exceptions, 1440/1024/390 geometry and inspected new desktop/mobile panels; same final source/artifact | PASS |
| Exact-source GitHub gates | Governance, CI, Full System Simulation and Full Automated UAT | Pending one combined publication |
| Actual provider certification / human review | Real chosen-provider sandbox acceptance/replay/reconciliation and Human Stage-20 | PENDING |

Generated evidence under handoff/quality is tied to a source fingerprint and,
for browser execution, the six built artifacts. Source inventory proves coverage
and permission contracts; it does not prove every possible business interaction
has been clicked. Browser checks exercise all registered navigation and selected
critical mutation paths; domain tests cover denial, retry and atomic rollback.

Final local candidate, complete built-browser wrapper and PostgreSQL probe
all match the final fingerprint above. Six artifact build identity:
`f0a63b20580ac96381caaf887fd151506e4d694e479a3e510580ca92863b4a0d`.
Browser completed 2026-10-06T11:31:31Z; PostgreSQL probe 11:32:45Z. The stale offline
source assertion requiring UTC was updated to require original business time,
trusted company calendar and reuse of the Core tax period; no guard was removed.

## Repaired findings

- Tax monthly periods and XML dates now use the trusted company business
  calendar across local midnight/month boundaries. Documents reuse Core posting
  periods; invalid calendars abort and historical mismatches require explicit
  canonical review without rewriting posted history.
- PostgreSQL duplicate receipt creation inside an interactive transaction must
  retry the whole serializable operation. Reading from an aborted transaction
  previously changed a concurrent idempotent replay into HTTP 500.
- PostgreSQL JSONB key ordering must not invalidate export snapshots. Checksum
  serialization now sorts object keys recursively while retaining array order
  and detecting any changed fact.
- Deposit customer selection uses a dedicated tenant-scoped bounded lookup. The
  legacy Customer list returns an array and cannot be treated as a cursor page.
- POS product names and SKUs need their own grid rows rather than sharing one
  narrow flex row with the icon and price.
- Browser automation waits for mutation controls to become enabled after prior
  asynchronous requests, and opens the operator's shift before posting cash.
- XML browser evidence downloads the newly created export job, rather than an
  unrelated previous successful job.
- Branch-only tender edits revalidate the existing deposit policy against the
  effective destination branch and reject global or mismatched liability scope.
- Campaign tables occupy the full workspace so their action column is visible;
  receipt history has bounded scrolling so the POS catalog remains accessible.
  Account punctuation and employee master help now use clear operator wording.

The eight new operator scenarios pass within the mandatory complete built-browser
run. Final checks retain desktop/mobile screenshots of new operator panels;
operator navigation, mutations and geometry are verified with production builds.

## Operational boundary

Exchange currently supports CASH-to-CASH under an owned shift. Customer deposit
ingress needs a dedicated liability account, separate from order advance 2105;
balances come from posted journals and pending refund holds. New retail flows
are online-only and default OFF. Disabling ingress preserves historical deposit
repayment and canonical compensation paths.

Staff fulfillment creates one canonical Order, reserves stock, records immediate
cash once and follows the existing inspection/packing/shipping lifecycle. It
does not also create a Sale. Cart promotion/points/manual discounts are not yet
an Order discount contract; the operator reviews the canonical Order total.

Faktur PK v1.4 and BPPU 2024-11 are separate pinned XML contracts. Export uses
posted Tax Core facts and immutable operator-approved legal mapping. Unmapped
fees, corrections/replacements, nonzero luxury tax and payroll BPMP certification
are outside the implemented contract and fail closed. File generation is not
automatic submission or proof of DJP/PJAP acceptance.

TEST fixtures and isolated scratch databases were used. The operator database,
production database and real notification destinations were not used. Production
migration still requires backup/restore, staging query review and deployment
retention/monitoring checks described in the migration and domain designs.
