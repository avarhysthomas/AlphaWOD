# Phase 1 Handover: Public Membership Purchase & Stripe Billing

Date: 2026-08-18 (presale implementation status updated 2026-08-19)

This is the current implementation handover. The detailed operating and
deployment runbook is
[`docs/billing/phase-1-rollout.md`](billing/phase-1-rollout.md); when the two
documents differ, use that rollout guide.

## 1) Current status

Phase 1 is implemented in the local working tree. It has **not** been deployed,
and no live Stripe catalogue, portal, webhook or membership email configuration
has been created or verified. A real emulator-bound Stripe sandbox journey ran
successfully on 19 August 2026 under the earlier prorated policy: the public
customer form opened hosted Checkout, settled a £24.38 test payment, received
the Stripe webhook, created an active local membership and pending confirmation
outbox, and returned through the local success route. That is a historical seam
baseline, not proof of the newly implemented £0 presale or discount. Those paths,
real Resend delivery and deployed staging remain untested.

Public purchasing remains closed by two independent controls:

1. `CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION` is `false` in both plan
   catalogues because every checkout document is still stamped as a legal-review
   draft.
2. `MEMBERSHIP_PURCHASE_ENABLED` must be enabled in the Functions environment.

Do not open either control as a shortcut around the other. Legal publication,
deployment and live provider configuration are still separate release gates.
Final release test results and counts have not been frozen in this handover.
Approval must cover immutable document content/URLs and hashes plus the exact
plan- and role-specific acceptance set rendered to the buyer; changing draft
version strings is not enough, and the system must not record adult-waiver or
guardian evidence for an acceptance that did not occur.

## 2) Implemented surface

The canonical plan, policy and billing calculations live in
`functions/src/membershipPlans.ts`; `src/lib/membershipPlans.ts` is the frontend
mirror and a parity test holds the two copies together.

The new Functions surface, none deployed, is:

- seven callables: `createMembershipCheckoutSession`,
  `createCustomerPortalSession`, `getMyMemberships`,
  `requestMembershipCancellation`, `claimMembership`, `listMemberships`, and
  `linkMembershipParticipant`;
- one public HTTP endpoint: `stripeWebhook`;
- four scheduled workers: `recoverStripeEvents`,
  `recoverMembershipCancellations`, `reconcilePastDueMemberships`, and
  `retryMembershipConfirmations`.

The seven new server-only Firestore collections are:

- `memberships`;
- `membershipIntents`;
- `membershipCheckoutLocks`;
- `membershipEntitlementOwners`;
- `stripeEvents`;
- `membershipEmailOutbox`;
- `membershipAudit`.

Every one is denied to clients in `firestore.rules`. The memberships
reconciler also requires the composite index in `firestore.indexes.json` on
`state` and `nextReconcileAt`.

The current billing schema version 1 is acceptable only because none of this
surface has been deployed and first rollout assumes all seven collections are
empty. Release preflight must prove that assumption. Existing billing documents
mean stop and design a version bump/migration/backfill; this implementation is
not a compatibility layer over unknown schema-v1 data.

The routes are public catalogue `/memberships`, public checkout
`/memberships/checkout/:planKey`, public return/claim
`/memberships/success`, signed-in billing management `/account/membership`, and
admin operations `/admin/memberships`.

## 3) Money, uniqueness and entitlement invariants

Checkout creates deterministic participant locks and, for a signed-in
Adult Unlimited payer, an AlphaWOD payer lock before calling Stripe. A local
lock expiry timestamp is never enough to make a replacement sale safe. The
backend retrieves the Checkout Session and releases the lock only after Stripe
has reached a terminal expired/failed state. Paid, asynchronous-payment,
orphaned and uncertain sessions stay blocked for webhook or manual recovery.
Before a new lock is taken, the configured Stripe Price/Product is retrieved and
matched to the exact plan name, amount, GBP currency, monthly interval, active
state and key mode. The validated Price id is frozen on the intent. Paid or £0
presale fulfilment also binds the signed Session, frozen intent, Subscription metadata,
Customer, billing anchor, quantity and sole Price before creating a membership.
A terminal Checkout event can release locks only after its Session id, mode and
plan are atomically bound to that same intent. Every later convergence
revalidates the immutable subscription contract; drift restricts access and is
staff-visible, but heals when Stripe is safely restored.

Before 1 September 2026 00:00 Europe/London, the frozen presale saves a payment
method and requires `no_payment_required`, £0 total, no proration and no trial.
Service is dated from that local opening boundary (`1788217200`); Stripe's first
recurring anchor is midnight UTC one hour later (`1788220800`). Keeping the
provider anchor on UTC day 1 prevents BST from encoding UTC day 31. The local
membership remains `scheduled`, non-entitled and duplicate-blocking until a
positive first `invoice.paid` proves the exact expected amount; failure of that
first invoice grants no past-due access grace. At the local cutoff, standard
immediate proration to the next UTC day-1 anchor resumes. A presale intent
created before the cutoff can complete its already-open Session until five
minutes before the fixed billing anchor; new intents at the cutoff are standard.

Adult Unlimited presale Checkout can accept the allowlisted existing-member
Coupon only: £5 GBP off for three months, restricted to that Product. One shared
reusable Promotion Code is distributed to eligible members. It expires at the
local opening cutoff and has no minimum, first-time-transaction, Customer,
currency-options or maximum-redemptions restriction. Its exact provider id is
resolved before Checkout and bound through fulfilment; Stripe's unrestricted
hosted code field stays disabled. The frozen schedule is £55 for September,
October and November, then the unchanged £60 base Price from 1 December. Staff
manually moderate redemptions against the small eligible cohort. Test and live
Coupon/Code objects are separate provider configuration.

Final AlphaWOD ownership is also recorded in a deterministic
`membershipEntitlementOwners` document. Claim, fulfilment and admin linking
acquire that owner in their Firestore transaction, preventing two concurrent
paths from assigning blocking AlphaWOD memberships to one user. The same record
is retained as an `active` or `released` generation tombstone. An ended
membership releases only its own active generation, so a delayed webhook cannot
replay its old entitlement over a replacement membership or later manual grant.
If a target profile is missing or unsafe to project, the ending path still
releases the owner and sends the membership to audited manual review instead of
leaving a permanent ownership lock or mutating that profile.

`linkMembershipParticipant` is an admin-only, one-shot operation. Linking the
same target again is idempotent; attempting to replace an existing target is
rejected until there is a separate audited transfer and entitlement-restoration
workflow. A successful link acquires durable ownership and writes the audit
fields; a scheduled presale still projects no access until first payment.

The browser's resumable checkout attempt is scoped to its complete context. It
stores only an opaque attempt id and request hash in `sessionStorage`, not raw
participant or signature fields. The hash includes the payer uid or anonymous
state, checkout input and the current `CHECKOUT_DOCUMENTS` versions, so an auth
change, account switch or document-version change rotates the attempt.

The success page is also session-scoped: it only confirms a membership whose
subscription id came back from claiming that Checkout Session **with the
separate browser-held checkout-attempt verifier**, never an older membership on
the account. The Stripe id alone is not a bearer credential. The pending pair is
held per tab for no more than 24 hours, the session id is removed from the query
string/history immediately after capture, and neither is acted on until Auth
loading resolves. The confirmation email links directly to verified-email
recovery, and an already-signed-in unverified buyer can resend verification from
the membership page. The exact membership's current state and actual entitlement
projection control the return-page copy, so suspended, revoked, ended or
unapplied access is never described as active. Billing management opens a portal
for a selected subscription only after the backend verifies that membership's
payer and Stripe customer; it is not an arbitrary account-level portal lookup.
The portal configuration is retrieved on every open and must keep both Stripe
cancellation and subscription switching disabled.

Cancellation freezes its server receipt time and the exact dates shown to the
member before calling Stripe. A changed preview is rejected for review; an
existing earlier Stripe date is never lengthened; and revoked app access does
not block the payer from stopping active billing. `recoverMembershipCancellations`
runs every five minutes with a ten-minute lease, the original Stripe idempotency
key and backoff, so a process crash or outage cannot discard a received request.
Exhausted or malformed requests enter audited manual review and are visible to
the member and in the admin attention view. A confirmed schedule that later
disappears or moves later in Stripe is withdrawn from the UI and the same frozen
request is automatically reasserted under a new repair generation.
If the promised date has already passed, recovery stops the active Stripe
subscription immediately and retains audited manual-review evidence for later
charges and any required refund.

## 4) Authoritative Stripe recovery

`stripeWebhook` verifies the raw-body signature before writing or processing an
event. `stripeEvents` is the durable ledger: an event gets a ten-minute worker
lease, retry backoff, and a terminal processed or dead-letter state. Failed or
abandoned events are reclaimed every five minutes by `recoverStripeEvents`,
which retrieves the event again from Stripe before using the same handler.

Membership lifecycle events never apply the event's subscription snapshot as
truth. A short per-membership convergence lease serialises writers, after which
the owner retrieves the current subscription from Stripe and commits only while
it still holds that lease. This prevents delayed or out-of-order webhook events
from overwriting newer state.

Disputes are tracked by individual Stripe dispute ids. Closing one dispute does
not clear another open dispute. `accessRevoked` is sticky: a lost dispute or full
refund cannot be undone by a delayed invoice or subscription event.

Stripe may send subscription, invoice, dispute or refund events before Checkout
has fulfilled locally. If the authoritative subscription carries this app's
intent metadata but the membership does not yet exist, processing fails
deliberately so the event remains retryable. Checkout fulfilment performs its own
authoritative convergence, and the recovery worker can then replay the earlier
event. Unrelated Stripe objects are ignored.

Checkout fulfilment records `contractMadeAt` from the verified Stripe event's
`created` timestamp and derives `coolingOffEndsAt` from that same value. The
cooling-off window therefore does not drift with webhook delivery or worker
retry time.

Past-due grace is not webhook-only. The earliest unpaid time, exact London-date
grace deadline and `nextReconcileAt` are persisted. Every 15 minutes,
`reconcilePastDueMemberships` queries due `past_due_grace` and
`past_due_suspended` rows using the `state`/`nextReconcileAt` index and retrieves
the current subscription from Stripe. It suspends debt after grace and also
keeps checking suspended memberships so a recovered payment can restore access
without a webhook.

## 5) Durable confirmation email

Checkout fulfilment atomically creates the membership and a frozen
`membershipEmailOutbox` record. Its purchase summary, amount actually returned
by Stripe, acceptance version ids, typed signature and Resend idempotency key are
created once; webhook replays cannot rebuild or alter them. Email failure never
rolls back a paid or £0 scheduled membership.

`retryMembershipConfirmations` runs every five minutes. Each email gets a
ten-minute worker lease, transient retry with backoff, and a 20-second Resend
request timeout. The adapter reads Resend's typed provider error name as well as
its HTTP status:

- permanent request errors go to `dead_letter`;
- uncertain/transient errors remain retryable;
- systemic authentication, validation, quota and rate-limit failures stop the
  remainder of that worker batch so one provider/configuration fault does not
  consume every row's attempts;
- unresolved delivery reaches `manual_review` after 23 hours, one hour inside
  Resend's 24-hour idempotency window.

Terminal `dead_letter` and `manual_review` paths emit a critical log and a
`confirmation_email_terminal` entry in `membershipAudit`. Status, latest error
and provider message id are projected onto the membership and shown to admins;
the admin attention filter includes terminal confirmation failures.

The current email is not yet the complete durable contract copy: it lists
document version ids but does not include or attach the immutable approved
document contents. Before launch, the frozen outbox/confirmation must carry the
actual accepted documents (with immutable identity/hash evidence), not merely
identifiers or links whose contents can later change.

## 6) Verification inventory and limits

Run the release checks from the repository root:

```sh
CI=true npm test -- --watchAll=false
npm run build
npm test --prefix functions
npm run lint --prefix functions
npm test --prefix rules-tests
npm run test:compat --prefix rules-tests
npm run test:emulator --prefix functions
```

The Phase 1-specific test inventory is:

- frontend catalogue/parity tests:
  `src/lib/membershipPlans.test.ts` and
  `src/lib/membershipPlans.parity.test.ts`;
- frontend service, checkout, success, management and auth-loading tests under
  `src/features/memberships/` and `src/features/auth/pages/`;
- pure Functions plan/policy tests in
  `functions/test/membershipPlans.test.js`;
- callable and billing-handler emulator coverage in
  `functions/test-emulator/membership.test.js`, with `fakeStripe.js` at the
  network boundary and a test confirmation sender;
- Firestore/Storage and Phase 0 compatibility coverage in
  `rules-tests/rules.test.mjs` and `rules-tests/compat.rules.test.mjs`.

Current focused coverage includes terminal-only checkout-lock reclamation;
active/released entitlement-owner generations and missing-profile release/manual
review; concurrent one-shot admin linking; membership-specific portal ownership;
runtime Price/Product matching and unsafe portal-configuration refusal;
automatic collection with no pause/trial drift; automatic-payment grace from
the signed failure event rather than invoice creation;
authoritative dispute re-retrieval with sticky revocation; pre-fulfil event
retry; grace/suspended reconciliation; `contractMadeAt` from Stripe
`event.created`; checkout-attempt payer scoping and no-PII storage; per-tab
24-hour claim expiry, success-query stripping and session-scoped confirmation;
auth-loading behaviour; immutable email payload/idempotency retry; and
orphan-outbox manual review.
It also covers the £0/no-proration presale contract, scheduled access and first-
invoice activation/failure, the allowlisted three-payment discount, UTC day-1
anchor regression, terminal Session-to-intent binding, frozen Price rotation,
healable subscription-contract drift restriction, overdue immediate
cancellation/refund review, current-state success copy and verified-email resend
recovery, plus refusal of an ordinary renewal cancellation while the statutory
cooling-off window is still open.

Before release, add explicit focused cases for convergence-lease contention;
two simultaneous dispute ids; document-version attempt rotation; confirmation
ten-minute lease expiry; typed permanent/systemic Resend classification and the
batch circuit; the 20-second timeout; the 23-hour manual-review boundary; and
terminal audit/admin projection. Those behaviours are implemented and described
above, but the present test inventory does not prove them directly.

Do not describe the automated suites themselves as a real provider end-to-end
test. Separately, the controlled emulator-bound run documented in
`docs/billing/local-stripe-test-journey.md` opened hosted Stripe Checkout,
settled a test-mode payment under the former policy, received Stripe-delivered events, fulfilled the
local membership and returned through the success route on 19 August 2026. It
did not exercise the real Events recovery worker, account claim, deployed
staging or real Resend delivery; normal checkout remains closed.

## 7) Release work still required

No item below authorises deployment or opening either purchase gate. Complete
the applicable legal, abuse and data-lifecycle design before provider testing,
then follow this order:

1. Replace the draft labels with approved immutable document content, stable
   URLs and hashes. Render and persist the exact per-plan/per-role set so the
   record never falsely asserts adult-participant or guardian acceptance. Make
   the frozen confirmation carry or attach that actual content, not only
   version ids. Freeze the full validated commercial plan snapshot on the
   intent/membership/outbox as well; a Price id alone cannot keep an open
   Session's name and amount aligned with a later code-catalogue deployment.
   Build the statutory cooling-off route: the current ordinary cancellation
   path fails closed inside that window and requires staffed immediate-stop,
   proportionate-service/refund review and durable acknowledgement.
2. Design and verify controls for anonymous checkout: appropriate App Check,
   per-source/attempt/participant rate limits, bot/challenge protection,
   Stripe-session and budget monitoring/alerts, and an incident runbook. App
   Check alone is not evidence that a buyer is human.
3. Approve a lawful retention and cleanup policy for terminal intents and
   redundant outbox PII. Automated cleanup must wait for authoritative Stripe
   settlement and checkout-lock release, preserve required final evidence, and
   route uncertain/orphaned records to monitoring/manual review rather than
   deleting the lock blindly.
4. Create an isolated staging Firebase project/data plane and app origin, wired
   only to Stripe test-mode catalogue, portal and webhook configuration. The
   runtime project/key/object-mode guard is now implemented and locally covered;
   verify it again in that deployed staging boundary. The emulator-only
   `demo-*` journey is not evidence of a deployed staging environment.
5. Make checkout duplicate checks, claim, and admin participant linking
   authoritatively converge any relevant existing Stripe subscriptions before
   their final eligibility transaction, failing closed on provider uncertainty.
   Also integrate ordinary admin entitlement changes with the active
   `membershipEntitlementOwners` generation so a later cancellation cannot
   erase a newer manual decision. Add an idempotent projection-recovery worker
   or audited repair action; pending/failed projection is visible but does not
   heal itself after a crash. Add an audited staff intake route for email
   cancellation requests that freezes receipt time/outcome and enters the same
   recovery state machine; current copy requires written staff confirmation
   because no automatic inbound-email intake exists. Add a durable idempotent
   cancellation-acknowledgement outbox for the online path; the purchase email
   is not a receipt for a later cancellation request. Disable every
   Stripe-hosted portal login page that could expose an unsafe/default portal
   configuration, since runtime checks cover only sessions created by this app.
6. The emulator-bound hosted Checkout payment and Stripe-delivered webhook seam
   passed under the former policy on 19 August 2026. Re-run the new £0 presale
   twice: once without a code and once with the TEST ONLY shared Adult
   Unlimited code. Then use an isolated Stripe Test Clock to prove the expected
   September/October/November £55 invoices and December £60 invoice. In deployed
   staging, additionally exercise Events recovery, anonymous account claim, a
   configured Resend test sender/recipient and actual Resend delivery.
7. Prepare and verify the separate live Stripe catalogue, prices, £5/repeating-
   three-month Product-restricted Coupon and one shared reusable Promotion Code,
   locked-down Customer Portal, webhook subscriptions/secrets and verified
   Resend domain, without enabling purchase. Put the live Coupon id in
   `STRIPE_EXISTING_MEMBER_COUPON_ID` and the live `promo_...` id in
   `STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID`; never reuse the test objects.
8. Prove all seven production billing collections are empty before accepting
   schema version 1. If they are not, stop for a migration/version plan. Then
   enter the Phase 0 maintenance, callable-transport and identity-admin freezes
   with the required backups and IAM restoration manifest.
9. Deploy the deny-all rules and `state`/`nextReconcileAt` index, then
   selectively deploy the seven callables, public webhook and four scheduled
   workers. Create and immediately re-block new callables; keep the webhook
   public and scheduler IAM separate. Do not use a blanket Functions deploy.
   The `functions` package's blanket deploy script is deliberately blocked; use
   the selective manifest with the Phase 0-pinned Firebase CLI 15.5.1.
10. After final rules and backend contracts are ready, deploy the compatible
   frontend through the confirmed Vercel production workflow. Only then restore
   the exact reviewed service-level client-callable transport for the seven
   callables—never a project-wide invoker grant—and verify IAM, schedules and
   SPA routing.
11. Smoke-test every callable through the real Firebase client transport. The
    anonymous checkout must reach the handler and fail at the closed gate rather
    than IAM/CORS, while signed-in, ownership and admin paths must enforce their
    handler boundaries. Record final release results and counts; only after all
    blockers and provider checks pass may the runtime purchase gate be
    considered.

Cooling-off self-service and its durable acknowledgement remain launch blockers;
inside-window requests are failed closed to staffed review rather than passed
through the ordinary renewal-notice calculation.
Automated Promotion Code issuance, advance price-change notices, automated youth
onboarding, and an audited linked-participant transfer workflow are deliberately
not built. The shared code is created, distributed and manually moderated by the
provider owner.

## 8) Start here

- Current runbook: `docs/billing/phase-1-rollout.md`
- Billing implementation: `functions/src/membership.ts`
- Function exports: `functions/src/index.ts`
- Policy/catalogue: `functions/src/membershipPlans.ts`
- Frontend membership service and pages: `src/features/memberships/`
- Rules and index: `firestore.rules`, `firestore.indexes.json`
- Phase 0 deployment constraints: `docs/security/phase-0-rollout.md`
