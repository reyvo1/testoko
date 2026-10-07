# P6C/P6D combined verification — T360-20261006-125000

This item follows the operator's explicit instruction to implement P6C and P6D,
inspect all four UI surfaces, and publish once after the combined local checks.
P6B dependency is exact-source runtime verified on 12537b9. Canonical product
phase remains P5, productReady=false and Human Stage-20=PENDING.

## Corrective local verification complete

| Gate | Executed evidence | Status |
| --- | --- | --- |
| Source/domain/UI audit | 206 models, 552 API handlers, 538 UI controls; 70/70 Admin contextual destinations; nine canonical domain ownership records; recovery 48/48 | PASS |
| PostgreSQL expand migration | Explicit TEST database, legacy ReportJob status/filters/output/progress preserved; new retry/lease defaults checked | PASS |
| PostgreSQL domain runtime | All seven domain assertions pass on final fingerprint 20ff8d4cd788b87a8c349e538512fa617255a31aa4fbf578d73978c28e78c678: exchange concurrency/rollback, deposit ledger/overdraw, receipt/consent, campaign batch, inspected staff fulfillment, real XML worker and retry/dead-letter/lease recovery | PASS |
| Full local candidate | 1734/1734 regression, all-workspace lint, DB smoke, six production builds/API boot, legacy SQLite preservation, critical source mapping 12/12; unchanged fingerprint 20ff8d4cd788b87a8c349e538512fa617255a31aa4fbf578d73978c28e78c678; completed 2026-10-06T15:46:26Z | PASS |
| Built Browser UAT | 57/57 checks PASS, nine new operator scenarios, all registered navigation, no JavaScript exceptions, 1440/1024/390 geometry and inspected new desktop/mobile panels; same final source/artifact | PASS |
| Exact-source GitHub gates | Commit `cbc0e3b0382ef88266b6fce4e66a0ba70f32c2a0`: [Governance](https://github.com/reyvo1/testoko/actions/runs/37457370376), [CI](https://github.com/reyvo1/testoko/actions/runs/37457370524), [Full System](https://github.com/reyvo1/testoko/actions/runs/37457398259), [Full UAT](https://github.com/reyvo1/testoko/actions/runs/37457407199) | Governance/CI PASS; System/UAT FAIL |
| Actual provider certification / human review | Real chosen-provider sandbox acceptance/replay/reconciliation and Human Stage-20 | PENDING |

Generated evidence under handoff/quality is tied to a source fingerprint and,
for browser execution, the six built artifacts. Source inventory proves coverage
and permission contracts; it does not prove every possible business interaction
has been clicked. Browser checks exercise all registered navigation and selected
critical mutation paths; domain tests cover denial, retry and atomic rollback.

Final local candidate, complete built-browser wrapper and PostgreSQL probe
all match the final fingerprint above. Six artifact build identity:
`204bb062360c5ab2c2d259db29fac5a124f6b2b64423f0aae167d96a28706cc4`.
Browser completed 2026-10-06T15:52:03Z; PostgreSQL probe 15:53:24Z. The stale offline
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

The nine new operator scenarios pass within the mandatory complete built-browser
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

Combined publication completed once in [draft PR #2](https://github.com/reyvo1/testoko/pull/2).
GitHub acceptance metadata added afterward remains local to preserve the operator
request for one push. No second source publication, merge or release is implied.

## Corrective candidate

The GitHub browser screenshot proves that the pending-count badge renders
`Retur 1`; exact whole-button matching of `Retur` timed out. The repair targets
the labelled span inside POS navigation, waits for a real pending badge/hydration
and verifies active workspace plus the same quote/confirm/atomic return checks.
No browser or financial assertion is skipped.

Five retail flags previously had no controls in the module-based Features list.
The existing Settings/Features menu now configures them for the trusted branch
through the existing Platform API, including dedicated deposit liability account.
Role/permission checks match the API; missing or ambiguous scope fails closed.
Flags remain default OFF, and provider certification is still independent.

Nine focused browser scenarios PASS on a newly created isolated PostgreSQL TEST
database. Final complete gate PASS 1734/1734 regression plus lint/migration/DB
smoke/six builds/API boot; complete built Browser UAT PASS 57/57; actual PostgreSQL
worker/domain probe PASS 7/7. All match `20ff8d4cd788b87a8c349e538512fa617255a31aa4fbf578d73978c28e78c678`. Source audit PASS: 538 controls,
552 handlers, 206 models, 70/70 contexts. Corrective source publication/GitHub
acceptance remains pending; earlier published evidence remains historical.

## Operator disposition

The operator selected **Simpan lokal saja** for the additional corrective push.
Code commit `e64be71b6f58735025076ea58391e45dcc9cf5b9` remains local. No corrected-source GitHub
acceptance is claimed; PR #2 remains on `cbc0e3b0382ef88266b6fce4e66a0ba70f32c2a0`.
Local gates above passed; publishing/dispatching the correction requires a later
explicit operator instruction. Owned temporary TEST services are stopped and
evidence/scratch databases retained. Human/provider/production readiness pending.

## 2026-10-07 corrective publication authorization

Operator subsequently instructed **ok push saja**, superseding the prior local-only disposition for this correction. Publish the verified source and checkpoint to existing draft PR #2 and run four exact-commit GitHub gates. Source/local evidence unchanged; GitHub outcome pending. This does not authorize merge or production release and does not close human/provider acceptance.

## 2026-10-07 — actual GitHub blockers and local root fix

Published 8c6ab2a Governance/CI PASS; final System 37497869209 and UAT 37497875023 FAIL. Browser artifacts (not continue-on-error step conclusions) fail at P6CD tax document controls: UTC-derived UI date excludes documents created after midnight in company timezone. P6CD domain/worker probes PASS in both runs. System also reports two HIGH production dependencies: sharp <0.35.5 and source-map-js <1.2.2.

Root fix in local verification: existing Tax Core reconciliation returns the trusted calendar/date-only bounds; UI uses server defaults rather than UTC currentMonthRange, preserving manual filters. Month-boundary behavior and browser calendar parity are asserted. Patch-only sharp 0.35.5/source-map-js 1.2.2 installed deterministically; production dependency audit and source/UI audits PASS. Full candidate/browser/PostgreSQL verification pending on changed source. Prior local 1734/57/7 PASS belongs to 20ff source, not this root fix. No production/schema/history mutation, human/provider acceptance or assertion weakening.

Rollback: revert the calendar response/UI together if required; retain canonical tax/period history. Dependency rollback must use a verified safe patch, not the known-vulnerable versions. No migration/backfill needed. Official advisories: https://github.com/advisories/GHSA-wq5f-xc86-pv6w and https://github.com/advisories/GHSA-68fv-2mgg-jv7q.

## 2026-10-07 — calendar/security root fix locally verified

Trusted Tax Core business-calendar bounds now initialize Tax workspace filters; manual filters are preserved and missing calendar fails visibly. Actual month-boundary assertions show UTC and Makassar documents remain selectable; browser checks the server/UI calendar before legal review/export. Patch-only sharp 0.35.5 and source-map-js 1.2.2 lockfile installed deterministically; native sharp image smoke and zero-high/critical production audit PASS. No schema, backfill, posted-history or business posting change.

All final local gates PASS on a7facd546ecbcb68507b3511de3e072c2385529fa35dd27a6e6ad847de0a03b8: 1734/1734 regression, lint, expand rehearsal/DB smoke, six builds/boot, Browser 57/57 and PostgreSQL/worker 7/7. Artifact 82118cb7e3ebaefabae99506d0940d118cf5eada12fe65ac978e5dff34d8bdf4 unchanged; all five evidence files bind this same source. UI audit 538 controls/70 contexts unchanged. Owned TEST PostgreSQL/API/worker/Next services stopped; fixtures/evidence retained. Publish to existing draft PR #2 and run four exact-commit gates under current operator authorization. Prior published failure is historical; human/provider/product readiness remain pending, no merge/release.

## 2026-10-07 — only P3 retail maturity metadata remains

ea74d64 final System/UAT still FAIL solely on P3: customer_campaign/customer_deposit/pos_ship_later/retail_exchange/tax_export have incomplete capability maturity metadata. Downloaded System artifact proves Browser PASS 57/57, P6CD domain/worker PASS, zero-high/critical production dependency audit PASS, P5/R7/R8/staging/DR/Stage-20 automated PASS. Actual archive log contains exact P3 missing-feature error; no remaining tax/calendar/browser failure. Human Stage-20 remains pending.

Local shared retail catalog fills conservative LIMITED/ADAPTER_REQUIRED metadata in bootstrap and runtime manifest. Absent flags remain OFF with no DB writes; actual scoped config/rollout and bootstrap existing enabled/account settings remain intact; server-owned metadata cannot be replaced by scoped readiness claims. Focused behavior/unchanged P3 contracts PASS 7/7; full candidate, complete browser and real PostgreSQL P3/P6CD verification pending. Prior a7fac evidence belongs to published ea74d64, not this changed source.

Rollback: revert read-only retail catalog/default metadata overlay and matching bootstrap import together; no schema/backfill or flag activation. Stored scoped flags/config are not removed.

## 2026-10-07 — retail catalog correction locally verified

Shared server-owned maturity catalog fixes the actual P3 blocker without changing gates. All six current evidence files PASS on source `97c23ea387f8b440b1102ce78cb47a3d9bf3eab0e5dfa9efe998ba1844d4f548`: 1736/1736 regression, lint/migration/DB smoke/six builds/API boot, Browser 57/57, actual PostgreSQL P3 13/13 and P6CD domain/worker 7/7, production dependency audit zero high/critical. Build artifact `62e1a29ed7a778774e6f09ed3d32765c107f3e951abecefc6c05b67e74913eb5`. Scoped flags/account/provider config and rollout remain preserved; five new flags default OFF. Publish this correction to existing draft PR #2 under operator authorization and require four actual final GitHub outcomes. Human Stage-20/provider certification/product readiness remain pending.

Operator additionally asks for completeness review and PPOB in the cashier menu. Audit the existing DigitalServices backend and product roadmap after publishing this verified correction; do not invent provider certification or duplicate the module.
