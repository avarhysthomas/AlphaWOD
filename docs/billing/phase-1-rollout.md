# Phase 1: public membership purchase and Stripe Billing

Status: implemented locally on 18 August 2026. The final verification results
and test counts are not frozen in this document. **Nothing has been deployed,
no live Stripe or membership-email configuration has been created or verified,
and neither provider has been exercised end to end.** The purchase flow is
closed by two independent gates and cannot be opened by configuration alone.

## 1. What was built

| Area | Location |
| --- | --- |
| Canonical catalogue, policy and billing maths | `functions/src/membershipPlans.ts` |
| Frontend mirror (held identical by a parity test) | `src/lib/membershipPlans.ts` |
| Checkout, portal, cancellation, webhook, recovery workers, admin callables | `functions/src/membership.ts` |
| Function export manifest | `functions/src/index.ts` |
| Public catalogue and checkout | `src/features/memberships/pages/` |
| Member billing management | `src/features/memberships/pages/MembershipManage.tsx` |
| Admin inspection and participant linking | `src/features/admin/pages/AdminMemberships.tsx` |
| Server-only billing collections | `firestore.rules` |
| Membership reconciliation query index | `firestore.indexes.json` |
| Runtime configuration template | `functions/.env.example` |

New function definitions, none deployed: seven callables —
`createMembershipCheckoutSession`, `createCustomerPortalSession`,
`getMyMemberships`, `requestMembershipCancellation`, `claimMembership`,
`listMemberships`, and `linkMembershipParticipant` — plus the `stripeWebhook`
HTTP endpoint and four scheduled functions: `recoverStripeEvents`,
`recoverMembershipCancellations`, `reconcilePastDueMemberships`, and
`retryMembershipConfirmations`.

New Firestore collections, all denied to every client: `memberships`,
`membershipIntents`, `membershipCheckoutLocks`,
`membershipEntitlementOwners`, `stripeEvents`, `membershipEmailOutbox`, and
`membershipAudit`. Checkout locks, durable entitlement-owner rows and
email-outbox entries are server-only coordination records; a browser can
neither manufacture nor alter them.

New server-owned user field: `stripeCustomerId`.

## 2. Approved catalogue as implemented

Taken from the Membership Terms draft, section 3, and reconciled against the
17 August 2026 Stripe catalogue export.

| Plan key | Name | Price | Ages | AlphaWOD access |
| --- | --- | --- | --- | --- |
| `adult_unlimited` | Adult Unlimited Membership | £60/mo | 18+ | **Yes** |
| `adult_ladies` | Adult Ladies Only Membership | £50/mo | 18+ | No |
| `adult_gym` | Adult Gym Only | £45/mo | 18+ | No |
| `youth_youngstars` | HYROX Youngstars | £35/mo | 4–11 | No |
| `youth_teenstars` | HYROX Teenstars | £35/mo | 12–16 | No |

The handover's three plan keys (`commercial`, `youngstars`, `teenstars`) did not
match the real catalogue. "Commercial" resolves to the three adult plans, and
only Adult Unlimited automatically includes AlphaWOD access. A test asserts that
exactly one plan carries that flag.

## 3. Policy decisions encoded in code

- **Proration.** `subscription_data.billing_cycle_anchor` is set to the first of
  the next calendar month in Europe/London, with
  `proration_behavior: "create_prorations"`. Stripe calculates and displays the
  initial partial charge; the full price is then taken on the first of each
  month. No proration is calculated anywhere in this codebase, which is what
  Membership Terms 5 requires.
- **Checkout session expiry** never outlives the anchor it was created against,
  so a session opened late on the last day of a month cannot be paid after the
  anchor has passed and be rejected by Stripe. The corresponding uniqueness
  locks are not reclaimed just because their local timestamp has elapsed: the
  server first checks Stripe and releases them only after a terminal
  `expired`/failed outcome. A paid, payment-pending, orphaned or uncertain
  session remains blocked for webhook or manual recovery.
- **Provider-object binding.** Before a new reservation is written, the server
  retrieves the configured Stripe Price and requires the expected live/test
  mode, active Product, exact product name, GBP amount, and one-month recurring
  interval. That validated Price id is frozen on the intent so a later catalogue
  rotation cannot strand an already-paid Session. Fulfilment then requires the
  signed Checkout Session, frozen intent, Subscription metadata, Customer and
  sole subscription-item Price to agree. Terminal Checkout events may release
  locks only after their Session id, subscription mode and plan are atomically
  bound to that same intent. A swapped or stale provider object is
  retried/manual-reviewed rather than granting the requested plan after a
  different charge.
- **Cancellation.** `resolveCancellationOutcome` implements the 14 calendar day
  renewal rule and both worked examples in the Cancellation Policy, including
  the late case that carries the membership through one further paid month. The
  outcome is computed server-side and shown to the member before submission. The
  client must echo that exact `cancel_at`; if the preview crossed a deadline, the
  server refuses it and makes the member review the new dates. The legally
  decisive receipt and outcome are persisted before Stripe is called. A stable
  idempotency key, an earlier-date clamp and the five-minute
  `recoverMembershipCancellations` worker make the request crash-safe without
  ever lengthening an existing Stripe cancellation. The worker uses a ten-minute
  lease and backoff, and moves exhausted or malformed requests to audited manual
  review. If a confirmed Stripe schedule is later removed or postponed,
  convergence withdraws the displayed confirmation, queues the same frozen
  request under a new repair generation, and reasserts the promised date.
  If that promised date has already passed, recovery cancels the still-active
  subscription immediately and preserves an audited manual-review record for
  charges and any refund required after the promised date.
  Revoked app access never prevents the payer from stopping an otherwise active
  Stripe subscription.
- **Past due.** Three calendar days of grace from the failed invoice due date,
  counted on London calendar dates. The absolute deadline is persisted as
  `pastDueGraceEndsAt` so access cannot remain in grace merely because no later
  Stripe webhook arrives.
- **Disputes and refunds.** Open dispute suspends, dispute won restores, dispute
  lost or full refund revokes. Open disputes are tracked by Stripe dispute id,
  so closing one cannot erase another. Revocation is sticky: once a lost
  dispute or full refund has revoked access, a delayed event cannot restore it.
- **Cooling-off.** The express immediate-performance request is a separate,
  unticked control. Fulfilment records `contractMadeAt` from the verified Stripe
  event's `created` time and derives `coolingOffEndsAt` from that same timestamp,
  rather than from delivery time or a mutable application clock.
- **Grandfathering.** The entitlement a member held before a purchase is stored
  on the membership. If a paid membership later ends, a previous `legacy` or
  `manual` active entitlement is restored rather than removed, so a
  grandfathered member is never demoted by cancelling a later purchase.
- **Staff independence.** Admin and SGPT profiles are never touched by
  membership fulfilment; their access stays role-based with a `staff` source.
- **Duplicates.** Blocked both for the same participant identity (a deterministic
  SHA-256 digest of the normalised name and date of birth) and for a second
  AlphaWOD-granting membership on the payer or eventual entitlement target.
  Checkout locks protect in-flight purchases; durable
  `membershipEntitlementOwners` rows protect the final AlphaWOD owner across
  checkout, claim and admin linking transactions.

## 3a. Buying comes before signing up

Membership purchase is public. A visitor picks a plan, completes the participant
and guardian details, accepts the documents, and pays, with no account and no
sign-in at any point. Membership Terms 8 describes exactly this: an existing
account holder "should sign in and **claim the purchase**".

`createMembershipCheckoutSession` therefore accepts an unauthenticated call.
When the caller is signed in it links the Stripe customer to their uid straight
away; when they are not, Stripe creates the customer and collects the billing
email, which becomes the identity the purchase is later matched against. The
membership fulfils with `payerUid: null`.

`claimMembership` attaches it to an account afterwards, by one of two routes
that demand deliberately different evidence:

| Route | Evidence | Constraints |
| --- | --- | --- |
| Checkout return | The Stripe session id **and** a separate high-entropy checkout-attempt verifier held only in that browser tab | 24 hour window, verifier consumed by the winning account |
| Billing email | The account's email matches the address Stripe billed | Email must be **verified** |

The session id is not a bearer credential: a copied return URL does not contain
the separate verifier and cannot take the purchase. This browser route exists
because a brand new sign-up has not verified its email yet. The email route has
no time limit but requires verification, because without it anyone could
register a victim's address and take their membership. The attach runs in a
transaction that asserts the membership is still unclaimed, so two accounts
racing on the same purchase cannot both succeed. A claim also cannot give one
account a second AlphaWOD-granting membership.

The claim is attempted automatically on the success page once the buyer signs
in, and again on `/account/membership` from the locally held session and
verifier. An account with no membership is also offered a manual "claim a
purchase I already made", which uses the verified-email route. The confirmation
email's recovery link takes a closed-tab buyer through sign-up/login, sends a
Firebase verification email when needed, and then routes them directly to that
manual verified-email claim. An already-signed-in unverified account can resend
the verification message from the membership page.

The browser persists only an opaque checkout-attempt id and a request hash in
`sessionStorage`, never the raw participant or signature fields. That hash is
bound to the payer uid (or anonymous state), the complete checkout input and the
current `CHECKOUT_DOCUMENTS` versions. Signing in or out, switching account, or
changing a document version therefore rotates the attempt instead of replaying
an idempotency key under a different legal or authentication context.

The Stripe `session_id` on the success return is also scoped to the current
checkout and is useless for an unclaimed takeover without the separate attempt
verifier. The UI claims that pair and only treats a membership whose Stripe
subscription id was returned by that claim as this purchase's confirmation; an
older membership is never substituted. The pending pair lives in per-tab
`sessionStorage` for at most 24 hours, and the page immediately removes
`session_id` from the address bar/history after capturing it. Auth state is
allowed to finish loading before claim or redirect decisions are made.

Billing management opens the Customer Portal for a specific membership. The
callable requires that membership's subscription id, verifies that the caller
is its payer, and uses its stored Stripe customer with the locked-down portal
configuration. The configuration is retrieved at runtime and refused unless it
is active with both subscription cancellation and subscription switching
disabled. It does not choose an arbitrary account-level customer.

## 3b. Recovery and convergence do not depend on webhook redelivery

After signature verification, `stripeWebhook` takes a ten-minute processing
lease in `stripeEvents`. Completed events remain terminally processed; crashed
or failed attempts become eligible again after the lease or an exponential
backoff expires. Backoff starts at one minute, caps at one hour, and an event is
dead-lettered after 12 attempts or seven days rather than replayed forever.

`recoverStripeEvents` runs every five minutes in UTC. It claims due failed or
abandoned ledger entries, retrieves each authoritative event again through
Stripe's Events API, and sends it through the same event handler as the webhook.
This closes the crash window between recording an event and completing its
effects, without relying on Stripe to issue another delivery.

Every membership update is an authoritative convergence, not a patch from an
event snapshot. A short per-membership convergence lease serialises writers;
the winner re-retrieves the current subscription from Stripe and commits only
while it still owns that lease. If a subscription, invoice, dispute or refund
event arrives before Checkout has created the membership, app-owned Stripe
objects are deliberately failed and left retryable in `stripeEvents`. Checkout
fulfilment then performs convergence itself, and the recovery worker can replay
the earlier event. Unrelated Stripe objects are ignored.

When a subscription becomes past due, the earliest unpaid timestamp and its
London-calendar grace deadline are persisted on the membership. The
`reconcilePastDueMemberships` UTC sweep runs every 15 minutes and selects both
due `past_due_grace` and due `past_due_suspended` rows by `nextReconcileAt`. It
re-reads the subscription from Stripe immediately before changing access, so it
either suspends stale debt or restores a payment that recovered without a
webhook. Grace rows use their exact deadline; suspended rows schedule another
authoritative check 15 minutes later. The `memberships` composite index on
`state` and `nextReconcileAt` supports this sweep.

## 4. The one change to the Phase 0 access model

Phase 0 made `approvalStatus` admin-only. Fulfilment of a paid Adult Unlimited
membership now also sets `approvalStatus: "approved"` for the payer, because
Membership Terms 8 says that purchase "automatically qualifies the participant
for AlphaWOD access". Phase 0 anticipated this and listed "paid Adult Unlimited
claiming" as Phase 1 work.

The grant is tightly bounded. It happens only:

- on the server-side webhook fulfilment path, never from client input;
- for a plan whose `grantsAlphaWodAccess` is true;
- when the payer bought the membership for themselves;
- after the purchase has been claimed by that account, since an unclaimed
  membership has no account to grant anything to;
- for a profile whose role is exactly `user`;
- through `resolveUserAuthorisation`, so the derived marker and custom claims
  are computed by the same Phase 0 routine as every other path.

A purchase where the payer is not the participant grants nothing automatically.
It is surfaced in the admin membership view and linked deliberately with
`linkMembershipParticipant`. The callable atomically acquires the target's
durable entitlement-owner row, applies access immediately and records the
admin/link audit. Linking is intentionally one-shot: repeating the same target
is idempotent, but changing an already linked target is refused until a separate
audited transfer/restoration workflow exists.

An entitlement-owner document is retained as an `active` or `released`
tombstone. Ending a membership releases only its own active generation; keeping
that generation record prevents a delayed webhook from replaying an old grant
over a replacement membership or later manual entitlement. If the target
profile is missing or no longer safe to project, the ending path still releases
the owner and marks the membership for manual review, with a critical audit,
rather than leaving a permanent ownership lock or mutating an unsuitable
profile.

The in-app waiver gate is unchanged and still applies after access is granted.

## 5. Two gates keep the flow closed

`createMembershipCheckoutSession` refuses to run unless **both** are true:

1. `CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION` is `true` in
   `functions/src/membershipPlans.ts`. It is `false`, and a test in each of the
   two copies asserts that.
2. `MEMBERSHIP_PURCHASE_ENABLED=true` in the Functions environment.

Every legal document in `CHECKOUT_DOCUMENTS` is still a version stamped
"DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION". The public pages show a
"not open yet" notice and point at support while the first gate is closed.

**Do not flip gate 1 by replacing labels or version strings alone.** Each plan
and payer/participant relationship needs an approved immutable document set,
with stable URLs or attached content and content hashes, rendered before the
checkbox and stored exactly as accepted. Common terms, cancellation and privacy
material must be distinguished from role-specific evidence: an adult waiver
must not be recorded unless the adult participant actually accepted it, and a
guardian/youth addendum must not be recorded for an adult purchase. The current
single checkbox and global document-version object cannot truthfully prove
those different acts. Phase 0 recorded the same blocker for waiver identifier
`2026-30-05`, which remains an unapproved legacy value.

## 6. Local verification

Run from the repository root:

```sh
CI=true npm test -- --watchAll=false
npm run build
npm test --prefix functions
npm run lint --prefix functions
npm test --prefix rules-tests
npm run test:compat --prefix rules-tests
npm run test:emulator --prefix functions
```

The verification inventory is: frontend plan/parity, membership-service,
checkout, success, management and auth-loading tests; Functions build, lint and
pure plan/policy tests; Firestore/Storage plus temporary-lockdown compatibility
rules tests; and the Functions callable-boundary and billing handler/emulator
suites. Section 10a records what the billing suite does and does not prove.
Record the final command results and counts at release time; this document does
not assert a final total. Local passing tests are not deployment evidence and do
not replace provider testing. The real local Stripe test-mode payment run
recorded below covers hosted Checkout and webhook fulfilment, but not Resend
delivery.

## 7. Provider configuration required before release

The emulator-bound Stripe provider exercise described below was completed on
19 August 2026. The live/staging deployment and Resend items remain undone and
require the applicable provider owner.

For the isolated, non-deployed provider exercise, follow
[`local-stripe-test-journey.md`](./local-stripe-test-journey.md). Its test-only
checkout bypass is limited to the local Firebase emulators, the
`demo-alphawod-stripe` namespace, localhost, an explicit opt-in and Stripe test
objects. It does not change the production publication or runtime gates.

1. **Create an isolated staging environment before the provider round trip.**
   Use a separate Firebase project, Firestore/Auth/Functions data plane and app
   origin, never the production project with a test Stripe key. Configure only
   Stripe test-mode products, prices, portal and webhook there. The runtime
   guard now binds the exact Firebase project id to `test` or `live`, verifies
   test/restricted-test versus live/restricted-live key prefixes, rejects test
   mode outright on production project `alphawod-d1f2f`, and checks Price,
   Product, Session, Subscription, Portal configuration and webhook/Event
   `livemode`. Verify those controls again in the deployed staging boundary;
   the local `demo-*` journey is intentionally emulator-only. Only after those
   controls are verified should the Resend test delivery run.

   The local `demo-alphawod-stripe` exercise completed on 19 August 2026:
   public catalogue/form -> real hosted Stripe sandbox Checkout -> £24.38 test
   payment -> Stripe-delivered webhook -> fulfilled intent and active local
   membership -> local success redirect. The exact Session and Subscription
   were independently re-read from Stripe; the durable confirmation outbox was
   present and pending. Resend, anonymous account claim and deployed staging
   were not exercised.
2. **Verify the live catalogue.** A real provider lookup on 18 August 2026
   proved the earlier `price_1U5K...` mapping is live-mode, not test-mode as the
   handover had claimed. The corrected `price_1U5P...` mapping in
   `functions/.env.example` is the verified sandbox catalogue. Products,
   prices, the portal configuration, and the webhook endpoint/signing secret
   remain mode-specific and never carry across.

   The corrected test IDs in `functions/.env.example` are correct for the dry
   run and a test-mode deployment. The checkout preflight retrieves the configured Price
   and expanded Product and verifies mode, active state, name, GBP amount and
   monthly recurrence before taking an identity lock. `resolvePriceId` also
   refuses the known test IDs alongside an `sk_live_` key.

   Check the live prices against the approved catalogue: £60, £50, £45, £35,
   £35, all GBP, monthly, and confirm the tax behaviour matches the test
   products.
3. **Confirm tax presentation.** The exported prices have
   `tax_behavior: unspecified` and the business is not VAT registered. Automatic
   tax is disabled in code. Confirm this matches the Stripe Dashboard so the
   displayed price is the total customer price.
4. **Create the Customer Portal configuration** (one per mode) and put its
   `bpc_...` ID in `STRIPE_PORTAL_CONFIGURATION_ID`.

   `subscription_cancel` and `subscription_update` must both be disabled.
   Cancellation runs through the in-app
   request flow so the 14-day notice rule is applied and the receipt time is
   recorded as evidence; Stripe's own cancel button would bypass both. Enable
   only invoice history and payment-method update, which is exactly what the
   Cancellation Policy tells customers the portal is for.

   Pause is no longer a Customer Portal feature in the Stripe API, so the
   no-pause rule needs nothing configured.

   Passing no configuration would make Stripe fall back to the account's default
   portal configuration, which has cancellation enabled. That is why
   `createCustomerPortalSession` refuses to open a portal when this is unset or
   when the retrieved configuration enables cancellation/subscription changes,
   rather than quietly using the default.

   Disable every shareable hosted Customer Portal login page for unsafe/default
   configurations too. Runtime validation protects sessions this app creates;
   it cannot stop a customer using a separately enabled Stripe-hosted login URL.
5. **Enable dynamic payment methods** in the Dashboard. The code deliberately
   does not pin `payment_method_types`.
6. **Set the Stripe API and email secrets.**

   ```sh
   firebase functions:secrets:set STRIPE_SECRET_KEY
   ```

   The code reuses the `RESEND_API_KEY` secret definition used by member invites,
   but no membership-email live configuration or delivery has been verified.
   Verify the `zeroalphafitness.co.uk` sending domain in Resend so confirmations
   are not rejected or spam-filed.

7. **Create the webhook endpoint before the first webhook deployment.** Use the
   deterministic final `stripeWebhook` Functions URL while purchasing is still
   closed, subscribe it to the events below, copy the endpoint's newly issued
   `whsec_...` value, and only then run
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`. This avoids the
   impossible ordering of trying to configure a signing secret before Stripe
   has created the endpoint that issues it. Deploy the webhook only after the
   real secret exists. Subscribe to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`,
   `charge.dispute.created`, `charge.dispute.closed`, `charge.refunded`.
8. **Configure Firebase Auth recovery email routing.** Add the staging and final
   app origins to Firebase Auth's authorised domains/action settings, then prove
   that a buyer can close the Checkout tab, follow the confirmation's sign-up or
   login route, receive and complete email verification, and claim by the billed
   address on `/account/membership`.

## 8. Deployment notes that inherit Phase 0 constraints

**Deployment remains closed.** The items below are pre-deployment requirements,
not authorisation to deploy.

The Phase 0 runbook's callable-freeze and identity-admin-freeze rules still
apply to any deployment that touches the existing functions.

- `stripeWebhook` is an `onRequest` function and **must be publicly invokable**.
  It is not a callable and must not be given the callable IAM lockdown. Its
  security is the Stripe signature check, which runs against the raw body before
  anything else, plus the recoverable `stripeEvents` lease ledger.
- The seven new callables must be created and then re-blocked in the same way
  Phase 0 step 7 describes for its four new callables: the Firebase CLI makes
  newly created callables public on creation. Keep them blocked through the
  migration/final-rules work and until the compatible frontend is live.
- The four scheduled functions — `recoverStripeEvents`,
  `recoverMembershipCancellations`, `reconcilePastDueMemberships`, and
  `retryMembershipConfirmations` — must be
  included in the selective deployment and their UTC schedules verified. They
  are workers, not public callables or the public webhook, so do not apply either
  of those IAM patterns to them.
- Deploy selectively. Do not use `--only functions`.
- The `functions` package's old blanket `npm run deploy` command is deliberately
  blocked. Use the selective manifest in this runbook with the Phase 0-pinned
  Firebase CLI 15.5.1; the workstation's older global CLI is not release proof.
- Rules changes are additive: seven new deny-all collection blocks. No existing
  rule was modified.
- Deploy the `memberships` composite index on `state` and
  `nextReconcileAt` before the grace-reconciliation worker is enabled.
- Schema version 1 is acceptable for this first rollout only because none of
  the billing surface has been deployed and the rollout assumes all seven
  billing collections are empty. Preflight must prove they are clean. If any
  billing documents exist, stop and design a version bump/migration/backfill;
  this code is not a dual-read migration for unknown data.
- After final rules and backend contracts are ready, deploy the frontend through
  the confirmed Vercel production workflow and verify SPA rewrites. Only then
  restore the exact reviewed service-level client-callable transport for these
  seven callables, following the Phase 0 restoration manifest; never use a
  project-level invoker grant. Keep the webhook's public HTTP IAM and scheduler
  identities separate.
- Before maintenance ends, inspect IAM and smoke-test each callable through the
  real Firebase client transport. The public checkout callable must reach its
  handler and fail at the still-closed legal/runtime gate, not at Cloud Run IAM
  or CORS; signed-in, owner-only and admin callables must reach their handlers
  and enforce their respective authentication/authorisation boundaries.

## 9. Launch blockers still open

These are release blockers, not optional future enhancements:

- Publish the approved immutable legal documents, render the exact set relevant
  to each plan and payer/participant relationship, and store stable URLs/content
  hashes plus truthful evidence for only that set. The current global draft
  version object can imply adult or guardian acceptance that did not occur.
- Make the durable confirmation carry or attach the actual immutable documents
  accepted at checkout. Version ids alone are not a durable copy of the
  contract, and links to changeable web pages are not sufficient.
- Freeze the validated commercial plan snapshot (product/name, amount,
  currency and recurrence) on the intent and copy it to the membership/outbox.
  A Price id alone does not stop a later code-catalogue deployment from making
  the membership or confirmation describe different terms from an open Session.
- Build the statutory cooling-off cancellation path before purchase opens. The
  current backend fails closed and routes an inside-window request to staffed
  review; it does not apply the ordinary renewal-notice outcome. The finished
  path needs immediate stopping, proportionate-service/refund review and the
  durable acknowledgement described below.
- Protect the deliberately anonymous checkout callable with a reviewed abuse
  design: suitable App Check enforcement, per-source/attempt/participant rate
  limits, an anti-bot or challenge strategy, Stripe-session/budget alerts,
  dashboards and an incident runbook. App Check alone is not proof of a human.
- Build and verify the isolated deployed staging Firebase/Stripe test-mode
  boundary described in section 7. The explicit project/key/object-mode guard
  is implemented and locally covered, but the emulator-only `demo-*` journey is
  not evidence of a deployed staging boundary. Do not point a test key at
  production Firebase data or infer safety from price-id prefixes.
- Close the remaining authoritative-state boundary before opening checkout:
  checkout duplicate checks, verified-email/session claims, and admin participant
  linking currently make their final eligibility decision from stored
  membership state. They must converge every relevant existing Stripe
  subscription first (or fail closed on uncertainty), so a delayed/dead-lettered
  lifecycle event cannot permit a second sale or stale access grant.
- Integrate ordinary admin `setMemberEntitlement` changes with
  `membershipEntitlementOwners`. A manual grant/restriction made while an active
  Stripe generation owns the account must be rejected or transactionally update
  that membership's restoration snapshot; otherwise a later cancellation can
  erase the newer admin decision.
- Add an idempotent entitlement-projection recovery worker or explicit audited
  repair action. The UI/admin list now expose both pending and manual-review
  projection, but visibility alone does not heal a crash after paid fulfilment
  commits and before access is applied.
- Add an audited staff intake path for cancellation requests received by email.
  It must freeze the actual receipt time and policy outcome, write immutable
  audit evidence, and enter the same durable recovery state machine as the
  member callable. Until that exists, customer copy requires written staff
  confirmation and does not claim that inbound email is automatically applied.
- Add a durable, idempotent cancellation-acknowledgement outbox for the online
  request path, carrying the immutable request id, receipt time and frozen dates
  through retry/manual review. The purchase-confirmation outbox does not provide
  this separate cancellation receipt.
- Disable and verify every Stripe-hosted Customer Portal login page that could
  expose an unsafe default configuration. Runtime checks cover the selected
  in-app configuration only.
- Configure and test Firebase Auth's authorised verification-action route,
  including the closed-tab/cross-device verified-email recovery journey. The
  implemented browser-held checkout verifier deliberately does not survive on a
  different device.
- Approve and implement a lawful retention schedule and safe cleanup for
  terminal intents and redundant outbox PII. Cleanup may run only after the
  Stripe state is authoritative and every checkout lock has been settled or
  released; uncertain/orphaned locks must fail closed into monitoring/manual
  review, not disappear under a blind TTL. Preserve the final membership,
  audit, acceptance and immutable confirmation evidence that lawfully requires
  retention.
- Complete the ordered backend/rules/frontend deployment, restore callable
  client transport only after the frontend is in place, and pass the per-service
  IAM and Firebase-client smoke checks in section 8.
- Run a real isolated Stripe test-mode journey through hosted Checkout,
  Stripe-delivered webhooks and Events recovery, plus a real Resend test
  delivery, before considering either purchase gate. Nothing in the emulator
  suite substitutes for this.

## 9a. Durable confirmation email

Fulfilment queues a durable confirmation for scheduled delivery via Resend. Its
frozen body currently includes the plan, participant and guardian summary,
monthly price, the amount actually charged today (taken from Stripe's
`amount_total`, never recalculated), the first full billing date, the
cancellation rule and how to exercise it, the refund and no-pause statements,
the cooling-off end date and immediate-performance choice, accepted document
version ids, and the typed signature. It does **not** include or attach the full
immutable legal documents. It must not be described as the complete durable
contract copy until the document-content blocker above is implemented.

For an unclaimed purchase it also carries the claim link, which is the only
thing that brings back a buyer who paid and closed the tab.

Fulfilment atomically creates the membership and one
`membershipEmailOutbox` entry. That entry's frozen purchase summary,
acceptance metadata and stable Resend idempotency key
`membership-confirmation/{subscriptionId}/v1` are created once and never
rebuilt; only its delivery status, leases, attempts and provider result change.
Replayed checkout events therefore cannot replace the original amount or body.

`retryMembershipConfirmations` owns delivery and runs every five minutes in
UTC. It takes a ten-minute lease and retries transient failures with backoff,
always sending the frozen payload with the same Resend idempotency key. Automatic
retry stops after 23 hours, deliberately inside Resend's 24-hour idempotency
window; an unresolved delivery then moves to `manual_review`, while permanent
request errors are dead-lettered.

The Resend adapter parses the provider's typed error name as well as its HTTP
status and times each request out after 20 seconds. Transient errors stay
retryable. Systemic authentication, quota, validation and rate-limit failures
open a batch-level circuit: the worker stops that run after the first such
failure rather than consuming attempts for every queued email. Every terminal
`dead_letter` or `manual_review` outcome produces a critical log and a
`confirmation_email_terminal` audit entry. Delivery state, provider id and the
latest error are projected onto the membership and exposed in the admin list;
the admin attention filter includes terminal confirmation failures.

Email availability never controls whether the paid membership fulfils and an
email failure never rolls back access. Recovery is driven by the durable outbox
and its scheduled worker; it does not wait for another Stripe webhook retry.

Requires `RESEND_API_KEY` (already used for invites) and the
`MEMBERSHIP_FROM_EMAIL` param, which defaults to
`hello@zeroalphafitness.co.uk`. That domain must be verified in Resend.

## 9b. Known product gaps, deliberately not built

- **Cooling-off self-service.** The express request and calculated cooling-off
  end are recorded, but the ordinary renewal cancellation is deliberately
  refused inside that window. A staffed immediate-stop/proportionate-service
  process and durable acknowledgement remain launch blockers in section 9.
- **Promotion codes.** Terms 3 allows them; `allow_promotion_codes` is not
  enabled.
- **Price-change notice flow.** Terms 6 requires advance notice; not built.
- **Youth onboarding workflow.** Payment deliberately does not book a first
  session; the approved message tells the guardian they will be contacted.

## 10. Open items for the business

1. The Cancellation Policy's own legal appendix flags the late-notice rule
   (collecting one further month) as needing a UK consumer-law fairness review
   before publication. The code implements the approved rule as written.
2. Youth product naming differs between the catalogue and the policy: Stripe
   calls the junior product "HYROX Youngstars U11" while the approved age band
   is 4–11 inclusive. The code follows the approved band. Consider renaming the
   Stripe product to avoid a customer-visible contradiction.
3. Decide whether a member on Ladies Only or Gym Only should be able to sign in
   at all. Today they get an account with no AlphaWOD access, which correctly
   lands on `/access-restricted`, and they can still reach
   `/account/membership` to manage billing.

## 10a. Billing handler emulator coverage

`functions/test-emulator/membership.test.js` runs selected real exported
handlers and exported billing cores against the Firestore and Auth emulators.
`fakeStripe.js` stands in for the Stripe network boundary, and confirmation
delivery uses a test sender. No real Stripe account or key, Resend delivery, or
external network access is needed, so this partial handler suite runs in CI and
locally.

It covers:

- the checkout core's Stripe request, stable retry, billing anchor and atomic
  participant/payer reservations, including authoritative terminal-state checks
  before an elapsed reservation can be reclaimed, while the exported handler's
  legal gate remains closed;
- membership-specific Customer Portal ownership, configuration and return URL,
  including refusal of a configuration that permits subscription changes;
- Price/Product catalogue preflight before a checkout reservation is written;
- webhook signature acceptance/rejection before durable event processing;
- checkout-event fulfilment, membership persistence, reservation release,
  `contractMadeAt` from Stripe `event.created`, the derived cooling-off end and
  durable confirmation enqueueing, including a frozen Price surviving config
  rotation and refusal of a terminal event from a different Checkout Session;
- Stripe event leases, retry backoff, crash recovery and scheduled retrieval of
  an abandoned event through the fake Stripe Events API, including pre-fulfil
  event retry;
- authoritative dispute re-retrieval and sticky revocation under a delayed,
  out-of-order event;
- immutable subscription-contract revalidation during convergence, with
  healable access restriction and staff-visible manual review on provider drift,
  including refusal of manual invoicing, paused collection and trials;
- persisted past-due grace deadlines and `nextReconcileAt`, including the
  scheduled sweep's grace suspension and suspended-membership recovery, with
  automatic-payment grace starting from the signed failure event rather than
  invoice creation;
- immutable confirmation payload/amount, stable Resend idempotency key,
  transient retry and orphan-outbox `manual_review` handling;
- claiming by checkout session grants access and approves the account;
- an unverified email cannot claim without the session id **and** matching
  checkout-attempt verifier;
- a verified matching email can claim without it;
- a different verified account cannot claim someone else's purchase;
- a purchase can only be claimed once, even by two holders of the same link;
- an expired session link is refused;
- youth, Ladies Only and Gym Only never move a member's entitlement;
- staff keep role-based `staff` access when they buy a membership;
- cancellation sends the policy's exact `cancel_at` to Stripe with
  `proration_behavior: none`, binds submission to the displayed preview, stores
  the matching outcome, never lengthens an earlier Stripe date, remains
  available for revoked-but-billing-active subscriptions, and is recovered by a
  leased scheduled worker after a crash or provider failure; recovery also
  requeues a removed confirmed schedule, rotates its repair generation, and
  preserves a payment already crossed by an earlier mid-month provider end;
  overdue drift stops billing immediately while preserving refund-review
  evidence, while an inside-window cooling-off request fails closed into the
  staffed path instead of receiving the ordinary renewal-notice outcome;
- only the payer can cancel;
- a member sees only their own memberships;
- durable active/released entitlement-owner generations prevent a claim or
  concurrent checkout from giving one account a second AlphaWOD membership and
  prevent a delayed ended membership replaying over a later grant;
- ending a membership can release its owner and route the projection to manual
  review when the target profile is missing or unsafe;
- admin participant linking converges access immediately and will not silently
  transfer an already linked membership.

Separate frontend service and page tests prove that checkout persistence keeps
raw form data out of storage, rotates when chargeable details or payer identity
change, and waits for Auth to resolve before making post-checkout routing and
claim decisions. They also cover the separate checkout-claim verifier, per-tab
24-hour pending-claim expiry, immediate success-query stripping, session-scoped
confirmation that cannot display an older membership as the returned checkout,
current-state copy that does not call revoked/suspended/ended or unapplied access
active, verified-email resend recovery, and stale/pending/manual-review
cancellation presentation.

The following implemented seams still need explicit focused automated cases in
the final release suite: concurrent convergence-lease contention; two open
dispute ids where only one closes; checkout-attempt rotation after a document
version change; confirmation ten-minute lease expiry; typed permanent versus
systemic Resend failures and the batch circuit; the 20-second timeout; the
23-hour manual-review boundary; and terminal audit/admin projection. They are
implementation facts described above, not coverage this document claims today.

The automated emulator suite is still not an end-to-end provider test: it does
not call Stripe's service or send through Resend. Separately, the controlled
local run in `local-stripe-test-journey.md` did open real hosted test Checkout,
settle a test payment, receive Stripe-delivered events, fulfil the local intent
and membership, and return through the success route on 19 August 2026. It did
not exercise real Resend delivery, a deployed staging boundary, anonymous claim
or production. The normal publication and runtime gates remain closed; only the
emulator-bound, explicit test journey can bypass publication.

The Stripe host override used by the suite comes from `STRIPE_API_HOST`,
`STRIPE_API_PORT` and `STRIPE_API_PROTOCOL`. These are never set in a deployed
environment, so production always talks to the real Stripe API.

Both emulator suites reset the shared emulator between tests, so
`test:emulator` runs the files with `--test-concurrency=1`.

## 11. Route map

| Route | Access |
| --- | --- |
| `/memberships` | Public |
| `/memberships/checkout/:planKey` | Public — no sign-in required to buy |
| `/memberships/success` | Public — the buyer lands here from Stripe before they have an account |
| `/account/membership` | Signed in; deliberately outside the AlphaWOD gate so a member on a plan without app access can still manage billing |
| `/admin/memberships` | Admin |
