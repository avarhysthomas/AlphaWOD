> Historical audit: its source-based findings are provisional. The exact production baseline was recovered later on 8 September; see [PRODUCTION_BASELINE.md](../PRODUCTION_BASELINE.md). Production includes class-cancellation code absent from the branch originally reviewed.

# AlphaWOD commercial-readiness audit

Date: 8 September 2026. Scope: code, local checks, public deployed UI, and readiness to sell to other gyms. No production writes or payments performed.

## Verdict

AlphaWOD has a credible specialist-gym product foundation: member bookings, payment-backed access, coaching tools, progress tracking, attendance, recurring billing and guest purchases. Its commercial advantage is the connection between training and gym operations.

It is not yet a repeatable gym-software business. The largest gaps are release consistency, isolation between gym customers, configurable policies, independent payment ownership, complete staff operations, and evidence that support/recovery works without the original developer.

The reported 70+ users demonstrate real use at one gym. This audit did not independently verify user counts, revenue, retention or service availability.

## Evidence boundaries — particularly important here

- The provided workspace is `main` at `2b19fd6`, dated 30 August, with substantial existing uncommitted work.
- The public site at https://alpha-wod.vercel.app advertises PAYG and Conditioning Only, which are absent from that checkout.
- I therefore also inspected the clean local release worktree `/private/tmp/alphawod-strength-production-hotfix`, branch `codex/strength-payg-production-hotfix`, commit `ea4d851`, dated 7 September. It contains the newer features and fixes. This is a relevant release candidate, not independently proven to be the exact deployed backend revision.
- All source locations below refer to that newer worktree unless explicitly marked **workspace**. Paths are relative to its root.
- Browser checks covered public login, membership catalogue, and mobile PAYG selection/details. I did not authenticate as a member/admin, submit a purchase, inspect live IAM/rules, retrieve payment records, or perform a restore drill. Private-screen findings are code-based.
- Older launch documents and even the newer readiness JSON contain unfinished controls. They show an evidence gap; they are not proof those controls remain absent today.

## What is good

1. **The core transaction boundaries are thoughtful.** Booking capacity, class status, membership eligibility and conditioning allowances are checked server-side. Weekly quota reservation shares the booking transaction. This is materially better than hiding buttons in the browser. See `functions/src/index.ts:954` and `functions/src/conditioningQuota.ts`.
2. **Recurring billing is substantially engineered.** Signature verification, idempotency records, recovery workers, entitlement reconciliation, durable email outboxes, duplicate-purchase guards, and cancellation receipts are implemented. Preserve these mechanisms when refactoring.
3. **PAYG has a separate lifecycle.** It has guest selection, payment holds, fulfilment, cancellation/refund handling, recovery and privacy redaction. It is not merely a checkout link. See `functions/src/payg.ts`. End-to-end production outcomes still need live operational evidence.
4. **The newer release improves failure handling.** Schedule data failures have retry UI; booking actions remain unavailable until booking state is verified; successful mutations refresh booking state. This fixes several weaknesses in the provided `main` checkout.
5. **Access revocation is based on authoritative data.** Rules and callables use current profiles rather than treating stale positive custom claims as enough. Sensitive billing collections are server-only.
6. **The training product has a useful identity.** Programming, gym-floor display/timers, strength blocks, personal records, attendance and leaderboards connect a member's experience to coaching. This is a stronger initial niche than trying to match every generic leisure-management feature.
7. **The public experience is coherent.** Distinct typography, large primary actions and clear pricing work well for a gym. The live PAYG flow names the exact session and exposes terms before collecting payment. At a 390px mobile viewport, the timetable stacks into readable cards.
8. **There is meaningful verification infrastructure.** CI includes web, backend, emulator and security-rules jobs. Release guards distinguish environments and billing gates. These are assets, although passing tests do not prove the deployed configuration.

## Prioritised findings

### A01 — P0 before deploying this workspace: source and release drift

The workspace waiver gate submits `ZAF-ADULT-WAIVER-2026-08-23-01` with one acknowledgement, while its backend accepts `2026-30-05` and six older acknowledgements. A member requiring acceptance cannot complete this contract. Refreshing cannot repair the mismatch.

**Workspace evidence:** `src/features/auth/components/WaiverGate.tsx:19`, `src/lib/membershipPlans.ts:267`, `functions/src/authz.ts:18`, `functions/src/index.ts:1867`.

The newer branch already derives the backend waiver version and acknowledgement from the canonical catalogue (`functions/src/authz.ts:53`). Do not treat this as a demonstrated live outage or rebuild an existing fix. Consolidate the release history, preserve uncommitted work deliberately, identify exact frontend/backend/rules revisions and add a cross-layer waiver contract test. A release must come from one reviewed commit and an explicit deployment manifest.

### A02 — P1 before a shared second-gym launch: no tenant isolation

Users, classes, bookings, memberships, settings and staff permissions are global. No gym-scoped ownership boundary was found. An administrator is effectively administrator of this application's gym, rather than one selected customer organisation.

**Evidence:** `firestore.rules`, `functions/src/index.ts:954`, `functions/src/index.ts:2296`.

Introduce organisation membership, per-gym roles, gym-bound data and server-side authorisation on every path, including Storage, background workers, exports and support tooling. Add negative tests proving Gym A cannot access Gym B. A separate Firebase/Stripe deployment per pilot gym is a possible interim isolation model, but it still needs automated provisioning and configuration; copying the repository manually will create maintenance drift.

### A03 — P1 commercial architecture: one merchant's billing configuration

The current implementation uses a shared Stripe secret/client and an allowlisted Zero Alpha catalogue. It does not provide connected-gym onboarding, per-gym payment-account routing or billing of gyms for your software.

**Evidence:** `functions/src/membership.ts:151`, `functions/src/membership.ts:418`, `functions/src/stripeLiveCatalog.ts`.

Decide who takes member payments, who handles refunds/disputes and how gyms pay you. A candidate is a connected Stripe account per gym with a separate subscription for the software. Stripe documents Connect specifically for SaaS platforms; exact responsibilities depend on configuration, so choose the model deliberately rather than simply adding account IDs. [Stripe Connect guidance](https://docs.stripe.com/connect/saas-platforms-and-marketplaces).

### A04 — P1 operational completeness: a gym cannot independently configure its timetable and policies

Strength blocks depend on title matching and fixed weekday/hour combinations. Booking cutoffs are hard-coded. Conditioning has a fixed London-week policy and eligible slots. A timetable-template editor exists but is not mounted in `App.tsx`. Creation assigns the creator as coach. Generated occurrences are only created, not reconciled after template changes; the generator also treats every creation error as a skipped occurrence, hiding failures other than duplicates.

**Evidence:** `functions/src/index.ts:450`, `functions/src/index.ts:495`, `functions/src/index.ts:861`, `src/features/wod/pages/AdminTemplates.tsx:86`, `src/App.tsx`.

Build an owner-facing setup and timetable area: class types, rooms, coaches, capacity, recurrence, holidays, booking/cancellation windows and membership eligibility. Define 'this class', 'future classes' and 'whole series' edits. Class cancellations need affected-member notifications and explicit PAYG refund handling. Surface genuine generation errors. Keep policy versions attached to purchases/entitlements so changing settings does not silently rewrite existing agreements.

### A05 — P1 access design: staff roles are too coarse

The `admin/user/sgpt/banned` model combines job roles and account state. SGPT can receive the entire staff-directory projection, including member emails, and access training logs broadly. Routine roster operations require admin. That forces another gym to choose between limited operational access and excessive authority.

**Evidence:** `functions/src/authz.ts`, `functions/src/index.ts:2296`, `firestore.rules:70`, `firestore.rules:146`.

Separate account status from capabilities. Add owner, manager, reception, coach and finance capabilities, with assigned-member/class scoping where appropriate. Require stronger authentication for privileged staff and record privileged changes. Do not infer that deployed MFA is absent merely because no app MFA flow was found; verify the identity configuration.

### A06 — P1 consistency: participation waiver enforcement remains primarily a UI boundary

The member booking path checks access, membership, class eligibility, quota and capacity but does not check current waiver acceptance. The Firestore access helper likewise does not require the waiver. An otherwise authorised member can bypass the browser gate and reach protected operations through the API.

**Evidence:** `functions/src/index.ts:954`, `functions/src/index.ts:1658`, `firestore.rules`; compare `src/features/auth/components/WaiverGate.tsx`.

Define precisely which actions require acceptance—booking, attendance, workout access—and enforce those on the server. Preserve access to billing, cancellation and support. This is an implementation-boundary finding, not a conclusion about the legal validity of a waiver.

### A07 — P1 supportability: recovery evidence needs to become an operated service

There is considerable recovery code and documentation, but no verified restore drill in this audit. The newer readiness record still marks delivery acknowledgement, backlog resolution, access backfill and some complete provider-to-app journeys unverified. These records may be stale relative to the live site.

**Evidence:** `ops/release/conditioning-payg-readiness.json`, `docs/billing/production-operations.md`, `.github/workflows/ci.yml`.

Create an accurate deployment/operations record: exact revisions, enabled gates, scheduled-worker health, delivered synthetic alerts, named responders and restore results. Add customer-visible failure recovery, browser error reporting and uptime checks. No app-wide React error boundary or active frontend exception-reporting integration was found. Prove backups by restoring into an isolated environment and checking linked identities, bookings, billing projections and stored assets—not merely by showing a backup setting. [Firestore backup guidance](https://firebase.google.com/docs/firestore/backups).

### A08 — P1 commercial operations: data portability and customer offboarding

PAYG has substantial retention/redaction work in the newer release; it would be wrong to say there is no privacy engineering. What remains missing from the inspected product surface is a complete gym-level import/export/offboarding workflow and an auditable process covering the full member lifecycle.

Deliver validated CSV import with preview and duplicate handling; member/gym exports; retention-aware deletion/anonymisation; a subprocessor inventory; and a clear support-access policy. Define legal controller/processor roles and the contracts appropriate to selling the service. [ICO controller/processor contracts guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/).

### A09 — P2 definite UI defects: promised queue and notifications do nothing

Full classes show **Join queue**, but the same button is disabled when `full` is true. The displayed 'waitlist' value is over-capacity arithmetic, not a queue. The Schedule notification bell has no handler.

**Evidence:** `src/features/bookings/pages/Schedule.tsx:906`, `src/features/bookings/pages/Schedule.tsx:1217`, `src/features/bookings/pages/Schedule.tsx:1336`.

Use honest 'Full' copy until a real ordered waitlist exists. Implement offers, expiry, acceptance, cancellation and capacity-safe promotion. Wire the bell to actual notifications or remove it. Booking confirmations, reminders and gym-initiated cancellations should precede decorative engagement notifications.

### A10 — P1 member self-service: no password-reset entry point

The live login offers email/password login, registration, membership and PAYG links but no forgotten-password path. Source imports login and email verification, not password reset. A forgotten password can prevent booking and create staff support work.

**Evidence:** live `/` inspection; `src/features/auth/pages/Login.tsx`.

Add reset request, clear confirmation, resend/rate-limit handling and a verified return route. Preserve intended destinations after authentication. Use understandable errors instead of raw provider messages. Test mobile and cross-device recovery.

### A11 — P2 growing-data correctness: bounded lists masquerade as complete data

Admin membership retrieval only takes the newest 500 memberships and 500 checkout intents; no paging contract is exposed by that list path. Directory retrieval reads all users. Performance analytics sample the latest 1,500 logs. Older memberships may become undiscoverable from the returned dataset even while still relevant; sampled metrics need explicit scope.

**Evidence:** `functions/src/membership.ts:8771`, `functions/src/index.ts:2296`, `src/features/admin/services/performance.ts:28`.

Add server-side pagination, search and filters, separately query unresolved operational cases, and calculate business totals independently of list pages. Label samples/time windows. Schedule capacity is fetched once per week load, so another user's booking/cancellation can leave displayed places stale; revalidate on focus or use a small live capacity projection. Transactional booking still protects actual capacity.

### A12 — P1 accessibility, P2 touch ergonomics: private staff screens need a focused pass

Roster labels using white at 34% opacity on `#151311` calculate to approximately 3.10:1; at 38%, approximately 3.57:1. These are below the 4.5:1 normal-text threshold. The add-member modal lacks dialog semantics/focus handling, and its visible select label is not programmatically associated. Several roster actions are 36px square, small for fast gym-floor use; that alone is not a claim of failing WCAG 2.2's 24px minimum.

**Evidence:** `src/features/bookings/pages/ClassRoster.tsx:483`, `:695`, `:787`. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Improve muted text tokens, use accessible dialog primitives, associate labels, preserve visible focus, and use approximately 44px operational touch targets. Keep the current visual identity. A complete screen-reader and authenticated-device audit remains outstanding.

### A13 — P2 maintainability: growing complexity concentrates release risk

The newer `membership.ts` is 11,410 lines, `payg.ts` 9,195 and `index.ts` 2,926. Business policies, provider integration and recovery processes are difficult to change confidently in modules of this size. The frontend still uses Create React App, which React has deprecated for new apps and recommends migrating away from. [React announcement](https://react.dev/blog/2025/02/14/sunsetting-create-react-app).

Extract domain modules behind existing tested interfaces: booking policy, entitlements, provider adapters, fulfilment, cancellations, communications and audit. Migrate build tooling separately from money-moving logic. Do not rewrite the whole application simply to adopt a newer framework.

## Provisional interface score

This is a sampled interface score, not a security certification or production-readiness score.

| Dimension | Score / 4 | Reason |
|---|---:|---|
| Accessibility | 2 | Good public form labelling; private roster contrast and modal issues |
| Performance | 2 | Lazy routes and bounded reads; stale capacity and incomplete aggregate strategy |
| Responsive design | 3 | Live mobile PAYG readable; small private staff actions remain |
| Theming | 1 | Recognisable identity but extensive fixed colours and little gym-level theming |
| Implementation integrity | 2 | Product-specific structure; dead bell and misleading queue action |
| Total | 10 / 20 | Significant targeted work; no justification for wholesale visual replacement |

The Impeccable detector on the workspace returned three aesthetic advisories: common font, decorative background and palette. These were not treated as functional defects. Typography and established branding are not themselves bugs. Suggested UI work: `$impeccable harden` for failures/dialogs, `$impeccable adapt` for staff touch targets, `$impeccable clarify` for queue/error copy, then `$impeccable polish`. Re-audit after fixes.

## Product roadmap and acceptance gates

### First: protect current members

Consolidate the production source and waiver fix; verify the deployment and operations evidence; add password recovery; correct dead controls; enforce the intended waiver boundary; prove an isolated restore. Acceptance: a controlled member journey can sign in/recover, accept the current waiver, book/cancel and manage billing; concurrent bookings and failed/reordered provider events cannot corrupt access or capacity.

### Next: make one other gym operable

Choose isolated deployments or shared tenants; establish independent merchant ownership; build configuration, roles and complete timetable operations; add import/export and gym onboarding. Acceptance: a second gym can create plans and a timetable, invite staff, import members and operate without database-console edits or code changes. Cross-gym reads/writes fail in tests.

### Then: make it commercially useful

Add waitlists, reminders, class-change communication, configurable packs/credits and pauses where the target gym needs them; a useful finance view with collected/failed/refunded revenue rather than only subscription status; and a daily action queue for expiring access, missing waivers, payment exceptions and inactive members. Existing no-pause rules are a Zero Alpha policy, not intrinsically a software defect.

Lead/intro-session tracking and retention follow-ups are valuable next additions. Door-access hardware, payroll, stock/POS and a native app can wait unless pilot gyms demonstrate that they block a sale. Youth billing is not equivalent to a complete guardian portal with multiple participants, emergency contacts, collection permissions and attendance workflows.

Pilot with a small number of similar coaching-led gyms. Track time to onboard, support minutes per gym, failed bookings, payment exceptions, class occupancy, member retention and infrastructure cost per gym. Do not set a confident delivery date or software price until the pilot scope and operating costs are measured.

## Checks executed

| Target | Result |
|---|---|
| Provided workspace frontend tests | 30 suites, 287 tests passed |
| Provided workspace backend tests | 123 passed |
| Provided workspace infrastructure tests | 23 passed |
| Provided workspace web/backend lint | Passed |
| Provided workspace frontend build | Passed; main JS approximately 146.93 kB gzip, with additional chunks |
| Provided workspace monitoring template | Five policies cover 29 critical markers; not proof alerts were delivered |
| Newer release frontend tests | 34 suites, 315 tests passed |
| Newer release backend tests | 247 passed initially; one local fake-server test was blocked by sandbox loopback binding and passed on isolated retry; all 248 passed across the runs |

The release frontend tests temporarily reused the workspace dependency installation through a symlink; the dependency declarations matched, and the link was removed afterwards. Tests ran with available Node 22.17.0, whereas the project specifies Node 24; this does not replace CI verification on the supported runtime. I did not run the complete Firestore/Storage emulator suites, load testing, authenticated browser journeys or a real provider purchase in this audit.

Only this report was added to the provided workspace. Existing source changes were preserved. No production configuration, member data, bookings or payments were changed.
