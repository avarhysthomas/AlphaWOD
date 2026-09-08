# Phase 1 Handover: Public Membership Purchase & Stripe Billing

Date: 2026-08-18 (youth programme release status updated 2026-08-25)

This is the current implementation handover. The detailed operating and
deployment runbook is
[`docs/billing/phase-1-rollout.md`](billing/phase-1-rollout.md); when the two
documents differ, use that rollout guide.

## 1) Current status

Phase 1 is implemented and its closed backend rollout completed on 25 August.
All fourteen membership services—the public webhook, nine callables and four
scheduled workers—are `ACTIVE` on Node.js 24. Both selective Functions batches
succeeded with the runtime purchase gate false. IAM inspection preserved the
reviewed public-webhook, scheduler-only and service-level callable boundaries;
legacy V1 checkout remains blocked, V2 and the seven non-checkout callables have
the reviewed client transport, and the Stripe event ledger is healthy.
The five live Stripe Price/Product pairs were supplied from Dashboard exports
and independently re-read from Stripe's live API on 19 August 2026. The two
youth pairs were read again on 23 August under their former provider names. On
25 August, the same live Products were deliberately renamed and read back
through the live API: the current
MINI ALPHAS - 10 & Under offering uses `price_1U5KoQFzNDZoGGA0s4t806bH` at £30
GBP monthly on Product `prod_V5Vq0l9VAaPox9`, and the current
TEEN ALPHAS - 11 & UP offering uses `price_1U5Kt8FzNDZoGGA0ogq41DEw` at £35 GBP
monthly on Product `prod_V5VumrjZl1bWV1`. The Product IDs, Price IDs and amounts
were unchanged. Live Coupon
`zaf_youth_family_15pct_2026` was then created and verified in Stripe Dashboard
on 23 August: valid, 15% off forever, no expiry, redemption cap or Promotion
Code, and restricted exactly to those two youth Products. It is current again
from the 27 August release. The intervening live Coupon
`zaf_youth_family_10pct_2026` was created and read-only API-verified on 25 August
as 10% off forever and restricted exactly to those two Products. A 27 August
audit found zero 10% redemptions, zero open Checkout Sessions and zero in-flight
membership intents. Five existing family memberships remain frozen on their
original 15% terms. Both Coupons remain available for backward-compatible
verification; no subscription is rewritten.
On 20 August the live Product-scoped no-expiry Coupon and Promotion Code,
locked-down Portal `bpc_1U6SIkFzNDZoGGA0mSE5EepR`, active 14-event webhook
`we_1U6SObFzNDZoGGA0cw5Yyqth`, and the existence of the Stripe API,
webhook-signing and checkout-rate-limit secrets were verified. The webhook is
active on Node.js 24 in `europe-west1`; GET `405` and unsigned POST `400` probes
prove reachability and signature rejection, not a signed delivery. No signed
live webhook or live payment journey has passed, and membership email/Resend
remains unverified. A real emulator-bound Stripe sandbox journey ran
successfully on 19 August 2026 under the earlier prorated policy: the public
customer form opened hosted Checkout, settled a £24.38 test payment, received
the Stripe webhook, created an active local membership and pending confirmation
outbox, and returned through the local success route. That is a historical seam
baseline, not proof of the newly implemented £0 presale or discount. Those paths,
real Resend delivery and deployed staging remain untested.

The canonical youth release catalogue is MINI ALPHAS - 10 & Under at £30 per child per month,
designed for ages 10 and under, and TEEN ALPHAS - 11 & UP at £35 per child per month,
designed for ages 11 and up. Those age descriptions are non-blocking guidance:
checkout still requires a valid, non-future date of birth, and staff manage
programme placement internally. Each youth subscription may contain 1–10
children in the same selected programme. One child pays the standard per-child
price; at 2–10 children an automatic 15%-forever Coupon applies to the whole
monthly subtotal. A single subscription cannot mix programmes. Two MINI ALPHAS - 10 & Under
therefore recur at £51 and two TEEN ALPHAS - 11 & UP at £59.50.

The business owner explicitly approved the current mixed publication bundle on
27 August 2026: revised Membership Terms and Guardian Addendum dated 27 August,
the Privacy Notice dated 25 August, and the Cancellation Policy and Adult Waiver
dated 23 August retained unchanged. Its stable public `.txt` files, per-document effective dates
and SHA-256 digests are frozen by the publication manifest. The earlier 20 and
23 August versions remain immutable historical evidence for checkouts that
accepted them.

Purchase is controlled by two separately deployed environment controls:

1. `MEMBERSHIP_PURCHASE_ENABLED=false` in the Functions environment keeps the
   authoritative backend purchase intake closed.
2. `REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false` is effective in Vercel
   Production deployment `Hizg4XZi7Fhft77QPEvSrE5s9aLu`, which is `Ready` and
   owns `alpha-wod.vercel.app`. The public DOM shows “Not open yet” and “Online
   purchase closed”, with every purchase control disabled.

The corrected Stripe youth configuration has passed its live API preflight. The
approved legal bundle must still be verified through the Vercel production
workflow, including `npm run verify:published-legal`, after the final release
frontend is deployed and before any gate opening. The verified closed deployment
uses the prior `main` SHA and old legal bundle, so it is not that publication
evidence. Final release test results and counts have not been frozen in this
handover. The system must continue to render and freeze the exact plan- and
role-specific acceptance set; it must not record adult-waiver or guardian
evidence for an acceptance that did not occur.

## 2) Implemented surface

The canonical plan, policy and billing calculations live in
`functions/src/membershipPlans.ts`; `src/lib/membershipPlans.ts` is the frontend
mirror and a parity test holds the two copies together.

The new Functions surface is:

- nine callables: retained legacy `createMembershipCheckoutSession`, versioned
  `createMembershipCheckoutSessionV2`, `createCustomerPortalSession`, `getMyMemberships`,
  `requestMembershipCancellation`, `claimMembership`, `listMemberships`,
  `linkMembershipParticipant`, and admin-only
  `releaseAbandonedMembershipCheckout`. The compatible frontend calls only V2 with
  `checkoutSchemaVersion: 6`; V1 remains for stale-client fail-safe rollout and
  is not an opening target;
- one public HTTP endpoint: `stripeWebhook`;
- four scheduled workers: `recoverStripeEvents`,
  `recoverMembershipCancellations`, `reconcilePastDueMemberships`, and
  `retryMembershipConfirmations`.

The ten new server-only Firestore collections are:

- `memberships`;
- `membershipIntents`;
- `membershipCheckoutLocks`;
- `membershipEntitlementOwners`;
- `stripeEvents`;
- `membershipEmailOutbox`;
- `membershipCancellationReceipts`;
- `membershipCheckoutRateAdmissions`;
- `membershipCheckoutRateLimits`;
- `membershipAudit`.

Every one is denied to clients in `firestore.rules`. The memberships
reconciler also requires the composite index in `firestore.indexes.json` on
`state` and `nextReconcileAt`.

Stored membership records now use schema version 7; the browser-to-callable
checkout request contract uses version 6. The cutover audit found existing
billing records, including five active or scheduled family memberships frozen
on their original 15% terms. The implementation preserves and renders those
frozen 15% policies and defensively supports frozen 10% policies while writing
the current 15% policy. Retaining the V1
callable export is a transport rollout boundary, not permission to accept an old
checkout request or rewrite historical commercial terms.

The routes are public catalogue `/memberships`, public checkout
`/memberships/checkout/:planKey`, public return/claim
`/memberships/success`, signed-in billing management `/account/membership`, and
admin operations `/admin/memberships`.

## 3) Money, uniqueness and entitlement invariants

Checkout creates a deterministic lock for every participant and, for a signed-in
Adult Unlimited payer, an AlphaWOD payer lock before calling Stripe. A local
lock expiry timestamp is never enough to make a replacement sale safe. The
backend retrieves the Checkout Session and releases the lock only after Stripe
has reached a terminal expired/failed state. Paid, asynchronous-payment,
orphaned and uncertain sessions stay blocked for webhook or manual recovery.
Before a new lock is taken, the configured Stripe Price/Product is retrieved and
matched to the exact approved live Price id, Product id/name, amount, GBP
currency, monthly interval, tax configuration, active state and key mode. Test
mode retains its independently verified catalogue. The validated Price id is
frozen on the intent. Paid or £0
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
reusable Promotion Code is distributed to eligible members. The app stops
accepting it at the local opening cutoff (`1788217200`). The provider-side Code
has no `expires_at`, and staff deactivate it manually when the campaign is
finished. The underlying Coupon has no `redeem_by`, so neither provider object
can invalidate an already-open presale Session. The Code has no minimum,
first-time-transaction, Customer, currency-options or maximum-redemptions
restriction. Its exact provider id is resolved before Checkout and bound through
fulfilment; Stripe's unrestricted hosted code field stays disabled. The frozen
schedule is £55 for September, October and November, then the unchanged £60 base
Price from 1 December. Staff manually moderate redemptions against the small
eligible cohort. Test and live Coupon/Code objects are separate provider
configuration.

Youth checkout freezes 1–10 separately named children with valid, non-future
dates of birth in the same selected programme. The age descriptions do not gate
checkout; staff manage placement internally. Stripe receives one subscription
item at the canonical per-child Price with quantity equal to that frozen
participant count.
At quantity 2–10 the server automatically applies the allowlisted youth-family
Coupon to the entire subtotal; fulfilment requires exactly 15% off forever, no
redemption deadline or cap, and `applies_to` containing exactly both youth
Products. There is no customer-entered family Promotion Code. Every child's
identity lock, valid date of birth, quantity, Price and discount must agree
before fulfilment;
unknown or malformed provider state fails closed.

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

`linkMembershipParticipant` is admin-only. The first link acquires durable
ownership; a later call for that exact target is an audited, idempotent
entitlement-projection repair after current Stripe state is rechecked. Replacing
an existing target is rejected until there is a separate audited transfer and
entitlement-restoration workflow. A scheduled presale still projects no access
until first payment.

Every state-sensitive checkout duplicate decision, claim and participant link
now converges all relevant Stripe subscriptions—including an active entitlement
owner—before its final Firestore transaction. That transaction reruns the
queries and refuses any newly discovered unconverged membership/owner, so a
delayed or dead-lettered lifecycle event cannot create a second sale or stale
grant. Provider uncertainty may heal/revoke existing access but always fails
closed before the requested new purchase, claim or link is committed.

The browser's resumable checkout attempt is scoped to its complete context. It
stores only an opaque attempt id and request hash in `sessionStorage`, not raw
participant or signature fields. The hash includes the payer uid or anonymous
state, every child in the checkout input and the current `CHECKOUT_DOCUMENTS`
versions, so an auth
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

The frozen confirmation carries each accepted registered document's title,
version, SHA-256 digest and complete canonical content both inline and as an
attached UTF-8 plain-text file. That evidence is created with the outbox record
and cannot be rebuilt from mutable links during a retry. Real Resend delivery
remains unverified and must pass the rollout checks before opening purchase.

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
review; concurrent admin linking and audited same-target projection repair;
authoritative Stripe convergence and final-transaction race closure for checkout,
claim and linking; membership-specific portal ownership;
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
1–10-child youth quantities within the same selected programme, valid
date-of-birth handling without a programme age gate, 15%-forever
whole-subtotal pricing and schema-version-4 V2 intake boundary,
healable subscription-contract drift restriction, overdue immediate
cancellation/refund review, current-state success copy and verified-email resend
recovery; App Check replay/app binding and privacy-safe checkout throttling; exact
role-specific legal evidence and durable document copies; and an online
cooling-off receipt that immediately stops billing, survives provider failure,
queues recovery/refund review and sends an independently durable acknowledgement.

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

No item below authorises opening either purchase gate. The Stripe family
configuration, closed backend rollout and closed Vercel redeployment are
complete. The final release frontend, production legal-byte verification and
remaining operational, abuse and data-lifecycle work are still blockers. Keep
both deployed controls false while completing them.
The sequence below records completed steps as well as the work still required:

1. Deploy the explicitly approved mixed bundle—27 August Membership Terms and
   Guardian Addendum, 25 August Privacy Notice, plus the unchanged 23 August
   Cancellation Policy and Adult Waiver—at its stable public URLs and run
   `npm run verify:published-legal`; do not open purchase if the production bytes
   differ. Separately staff the cooling-off
   proportionate-service/refund decision, execution and audit SLA. The online
   notice, immutable receipt, immediate provider stop, recovery and durable
   acknowledgement are implemented, but the refund amount remains a human
   review.
2. Configure the implemented anonymous-checkout controls in production: create
   the restricted reCAPTCHA Enterprise/App Check web registration and app-id/IAM
   binding; verify checkout access to the existing HMAC secret; attach real
   alert channels/budgets;
   and approve the human-challenge/incident response. Limited-use token replay
   protection, privacy-safe fixed-window throttles and stable-attempt admission
   are implemented and tested. App Check alone is not evidence that a buyer is
   human.
3. Complete legal/privacy sign-off and production evidence for the implemented
   PAYG retention policy. `redactPaygPii` now performs bounded, resumable and
   idempotent field redaction: 30 days for checkout-intent PII, 90 days after
   class end for order/outbox/guest-booking PII, and 2,190 days after class end
   for waiver identity. It defers an outbox only for a valid pre-cutoff email
   lease bounded to ten minutes, requires an exactly bound paid-Checkout event
   before promoting delayed payment PII, preserves provider/financial/class/
   legal/refund/dispute evidence, and never deletes the whole intent. The
   approval and availability gates remain false.
4. Create an isolated staging Firebase project/data plane and app origin, wired
   only to Stripe test-mode catalogue, portal and webhook configuration. The
   runtime project/key/object-mode guard is now implemented and locally covered;
   verify it again in that deployed staging boundary. The emulator-only
   `demo-*` journey is not evidence of a deployed staging environment.
5. Add an audited staff intake route for cancellation requests received by
   email. It must freeze the actual receipt time/outcome and enter the same
   durable recovery/acknowledgement state machine as the member callable;
   current copy requires written staff confirmation because no automatic inbound
   intake exists. The live selected Portal's hosted login page is disabled;
   preserve and re-verify that state before opening purchases.
6. The emulator-bound hosted Checkout payment and Stripe-delivered webhook seam
   passed under the former policy on 19 August 2026. Re-run the new £0 presale
   twice: once without a code and once with the TEST ONLY shared Adult
   Unlimited code. Then use an isolated Stripe Test Clock to prove the expected
   September/October/November £55 invoices and December £60 invoice. In deployed
   staging, additionally exercise Events recovery, anonymous account claim, a
   configured Resend test sender/recipient and actual Resend delivery. Run one-
   and two-child journeys for both youth plans and independently verify Stripe
   item quantities, every Firestore participant, the family Coupon and recurring
   totals (£51 for two MINI ALPHAS - 10 & Under; £59.50 for two TEEN ALPHAS - 11 & UP). The existing
   post-payment verifier does not yet prove the family Coupon.
7. **Completed 25 August:** the live catalogue, £5/repeating-three-month
   Product-restricted no-expiry Coupon
   `zaf_existing_member_5off_3mo_2026`, shared no-expiry Promotion Code
   `promo_1U6EsgFzNDZoGGA0DjPqkz08`, locked-down Portal and webhook destination
   were verified without enabling purchase; enabled versions of the required
   Stripe secrets were confirmed to exist. Their exact provider ids are recorded
   in the git-ignored production configuration, while the Resend domain and
   delivery remain a separate opening check. The operator re-read all five live
   Price/Product pairs and confirmed that youth-family Coupon
   `zaf_youth_family_15pct_2026` is exactly 15% off forever, has no redemption
   deadline, cap or Promotion Code, and applies only to the two youth Products.
   Its id was recorded in `STRIPE_YOUTH_FAMILY_COUPON_ID`, and
   `npm run verify:stripe-live-config --prefix functions` passed with purchasing
   closed.
8. **Completed cutover audit:** five existing family memberships remain frozen
   on their original 15% terms, while no old Checkout Session or Stripe event
   was in flight. The release preserves those historical commercial terms and
   applies the 15% Coupon only to new eligible checkouts. The unused 10% Coupon
   remains available for historical verification. The V1 callable
   remains a stale-client safety boundary, not an opening target.
9. Deploy the `state`/`nextReconcileAt` index and reviewed final deny-all rules.
   Keep the backend runtime purchase parameter false. Confirm the external
   Vercel project, Production branch, canonical domain and complete Production
   environment; the repository cannot prove those bindings.
10. Only after the revised document source checks pass, and with
    `REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`, deploy the exact reviewed
    frontend commit through that confirmed Vercel workflow. Record its commit
    SHA, verify SPA routing and run the deployed-byte legal preflight. Do not
    continue if the public bytes differ from the canonical registry.
11. **Completed 25 August:** the armed backend preflight and both selective
    batches succeeded. The first deployed the signed public webhook and four
    scheduled workers; the second deployed all nine callables, including both
    checkout exports. All fourteen services report `ACTIVE` on Node.js 24.
12. **Completed 25 August:** post-deployment IAM inspection kept the webhook
    public and scheduler paths separate, re-blocked all nine callables, then
    restored only the reviewed service-level client transport for
    `createMembershipCheckoutSessionV2` and the seven non-checkout callables.
    Legacy `createMembershipCheckoutSession` remains blocked. The Stripe event
    ledger is healthy and the backend gate remains false. Preserve these
    invariants during the final release frontend deployment and every future
    selective Functions update.
13. Record final release results and counts. Only after every blocker and
    provider check passes may an authorised operator open only the V2 backend
    intake and then deploy the same frontend commit with its Vercel Production
    purchase gate true, using `production-operations.md`. Rollback closes and
    redeploys V2 first, then closes the frontend gate. V1 remains closed.

Cooling-off self-service now freezes an immutable receipt before the provider
change, stops billing immediately, recovers interrupted work and queues a
durable acknowledgement without passing the request through the ordinary
renewal-notice calculation. The staffed decision, calculation, execution and
audit SLA for any proportionate service charge or refund remains a launch
blocker.
Automated Promotion Code issuance, advance price-change notices, automated youth
onboarding, and an audited linked-participant transfer workflow are deliberately
not built. The shared code is created, distributed and manually moderated by the
provider owner, including deactivation when the campaign is finished. Provider
object lifetime never extends the application's fixed presale cutoff.

## 8) Start here

- Current runbook: `docs/billing/phase-1-rollout.md`
- Billing implementation: `functions/src/membership.ts`
- Function exports: `functions/src/index.ts`
- Policy/catalogue: `functions/src/membershipPlans.ts`
- Frontend membership service and pages: `src/features/memberships/`
- Rules and index: `firestore.rules`, `firestore.indexes.json`
- Phase 0 deployment constraints: `docs/security/phase-0-rollout.md`
