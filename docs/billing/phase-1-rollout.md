# Phase 1: public membership purchase and Stripe Billing

Status: implemented locally on 18 August 2026 and live-provider status updated
20 August 2026. Final release results and test counts are not frozen here. The
only new production service deployed is the public `stripeWebhook` receiver;
the seven callables, four scheduled workers and customer frontend remain
undeployed. The five live Price/Product pairs, Product-scoped no-expiry Coupon
and Promotion Code, locked-down Portal, 14-event webhook destination and the
existence of the three billing secrets have been verified as described in
section 7. No signed live webhook delivery or live payment journey has passed.
All five 20 August legal documents are approved, their final DOCX and canonical
public text are synchronized into both registries, and the legal source gate is
`true`. The backend and frontend environment purchase gates remain `false` and
cannot be opened by provider configuration alone.

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

New function definitions: seven currently undeployed callables —
`createMembershipCheckoutSession`, `createCustomerPortalSession`,
`getMyMemberships`, `requestMembershipCancellation`, `claimMembership`,
`listMemberships`, and `linkMembershipParticipant` — plus the deployed public
`stripeWebhook` HTTP endpoint and four currently undeployed scheduled functions:
`recoverStripeEvents`, `recoverMembershipCancellations`,
`reconcilePastDueMemberships`, and
`retryMembershipConfirmations`.

New Firestore collections, all denied to every client: `memberships`,
`membershipIntents`, `membershipCheckoutLocks`,
`membershipEntitlementOwners`, `stripeEvents`, `membershipEmailOutbox`,
`membershipCancellationReceipts`, `membershipCheckoutRateAdmissions`,
`membershipCheckoutRateLimits`, and `membershipAudit`. Checkout locks, durable
entitlement-owner rows, cancellation receipts, pseudonymous abuse-control rows
and email-outbox entries are server-only coordination/evidence records; a
browser can neither manufacture nor alter them.

New server-owned user field: `stripeCustomerId`.

## 2. Approved catalogue as implemented

Taken from the approved Membership Terms dated 20 August 2026, section 3, and
reconciled against the 17 August 2026 Stripe catalogue export.

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

- **Founding presale.** Until 1 September 2026 00:00 Europe/London, Checkout
  uses `subscription_data.proration_behavior: "none"`, always collects a
  payment method, charges £0 and fixes the first recurring anchor at 1 September
  2026 00:00 UTC. Service is dated from local opening midnight one hour earlier.
  The resulting Stripe Subscription can be `active`, but the application keeps
  the membership `scheduled`, non-entitled and duplicate-blocking until a
  positive first `invoice.paid` proves the expected £60 or discounted £55 was
  received. A failed first invoice does not receive past-due access grace.
- **Standard billing after opening.** At the local opening cutoff, the one-off
  presale policy switches off. The next calendar month is derived from the
  Europe/London business date, then the Stripe anchor is constructed on UTC day
  1 with `proration_behavior: "create_prorations"`. Stripe calculates and
  displays the immediate partial charge. Using UTC day 1 avoids a BST
  London-midnight instant becoming UTC day 31 and drifting to month-end.
- **Existing-member discount.** Adult Unlimited presale requires the approved
  Coupon and Promotion Code ids and refuses checkout if either is missing. An
  eligible customer may enter the one shared code in the AlphaWOD registration
  form; the server resolves it before reserving the purchase and passes Stripe
  that exact allowlisted Promotion Code id. Hosted Checkout's unrestricted
  promotion-code box stays disabled. Fulfilment revalidates the exact Coupon and
  requires £5 GBP off, repeating three months, restriction to the Adult
  Unlimited Product and no Coupon `redeem_by`, plus the shared reusable
  Promotion Code with no automatic expiry and no customer, minimum,
  first-time-transaction or currency-options restrictions. The app still stops
  accepting the code at the local opening cutoff; staff deactivate the Code
  when the campaign is finished. The base Price remains £60:
  discounted members pay £55 on the September, October and November invoices,
  then £60 from 1 December. Unknown or malformed discounts fail closed.
- **Checkout session expiry** never outlives the anchor it was created against,
  so a session opened late on the last day of a month cannot be paid after the
  anchor has passed and be rejected by Stripe. Its uniqueness locks are frozen
  with the Session. A presale intent created even one second
  before local opening cutoff gets Stripe's required completion window and is
  capped five minutes before the fixed first-payment anchor; an intent created
  at the cutoff switches to standard billing. Standard Sessions retain the
  one-hour anchor margin. Those locks are not reclaimed just because their
  local timestamp has elapsed: the
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
- **Cooling-off.** The express request to begin performance on the displayed
  service-start date is a separate, unticked control. Fulfilment records
  `contractMadeAt` from the verified Stripe
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

Phase 0 made `approvalStatus` admin-only. Fulfilment of an eligible Adult
Unlimited membership sets `approvalStatus: "approved"` for the payer only after
payment entitlement is earned, because Membership Terms 8 says that purchase
"automatically qualifies the participant for AlphaWOD access". A £0 presale
fulfils as `scheduled` and deliberately projects nothing; this both prevents
early access and preserves any legacy/manual access already held. The first
successful recurring invoice activates and projects the membership. Phase 0
anticipated this and listed "paid Adult Unlimited claiming" as Phase 1 work.

The grant is tightly bounded. It happens only:

- on the server-side fulfilment/convergence path, never from client input;
- for a plan whose `grantsAlphaWodAccess` is true;
- when the payer bought the membership for themselves;
- after the first required payment has succeeded and the purchase has been
  claimed by that account, since an unclaimed
  membership has no account to grant anything to;
- for a profile whose role is exactly `user`;
- through `resolveUserAuthorisation`, so the derived marker and custom claims
  are computed by the same Phase 0 routine as every other path.

Adult online checkout is self-purchase only: the form always records the adult
as both participant and payer, and the backend rejects a forged adult request
where those roles differ before reserving anything or contacting Stripe.
Delegated registration is limited to youth plans, which retain separate child
and paying-adult records. `linkMembershipParticipant` remains fail-closed support
for legacy/test records where an AlphaWOD-granting purchase predates this rule;
it is not part of the public adult purchase journey. The callable atomically
acquires the target's durable entitlement-owner row, applies access immediately
and records the admin/link audit. Repeating the same target is an explicit,
audited projection repair after Stripe is rechecked; changing an already linked
target is refused until a separate audited transfer/restoration workflow exists.
Checkout duplicate admission, claims and links all converge every relevant
Stripe subscription and active entitlement owner before the final Firestore
transaction; a newly discovered unconverged record or provider uncertainty
fails closed before the requested new action is committed.

An entitlement-owner document is retained as an `active` or `released`
tombstone. Ending a membership releases only its own active generation; keeping
that generation record prevents a delayed webhook from replaying an old grant
over a replacement membership or later manual entitlement. If the target
profile is missing or no longer safe to project, the ending path still releases
the owner and marks the membership for manual review, with a critical audit,
rather than leaving a permanent ownership lock or mutating an unsuitable
profile.

Membership checkout presents the canonical approved Adult Participant Waiver
to a new Adult Unlimited buyer and freezes that registered version and exact
acknowledgement with the purchase evidence. This closed publication release
does not change the pre-existing AlphaWOD in-app waiver gate for current users;
any later transition of that separate gate requires a compatible callable and
frontend rollout rather than a frontend-only deployment. Media consent remains
separate and is not inferred from membership-waiver acceptance.

## 5. Approval and purchase gates

`createMembershipCheckoutSession` refuses to run unless **both** are true:

1. `CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION` is `true` in
   `functions/src/membershipPlans.ts`. It is now `true` in both the backend and
   frontend catalogue copies, and their parity and publication tests enforce
   that synchronized value.
2. `MEMBERSHIP_PURCHASE_ENABLED=true` in the Functions environment.

The browser adds a separately deployed customer-visible control:
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=true`. Catalogue links and form submission
stay closed unless the approved source gate and this frontend gate are both
true. It is a rollout/kill-switch control, not a security boundary; the two
server checks above remain authoritative for creating a Stripe Session.

On 20 August 2026 the business owner explicitly approved the final Membership
Terms, Privacy Notice, Cancellation, Refund and Cooling-off Policy, Adult
Participant Waiver and Parent/Guardian Addendum. The final DOCX files live under
`docs/legal-review/2026-08-20/`. Their canonical text, stable versioned URLs,
effective dates and SHA-256 digests are synchronized between the public `.txt`
files and both `CHECKOUT_DOCUMENTS` registries. The checked-in source therefore
passes the legal publication gate.

The code resolves an exact plan/signer-specific immutable document set, renders
its canonical content and byte-identical versioned plain-text link, requires
each contract/privacy/waiver/payment/performance statement separately, and
freezes the server-owned contents, statements, signer role and commercial plan
snapshot on the intent, membership and confirmation outbox. The publication
preflight rejects a draft/pending identifier, a non-matching SHA-256 content
digest, a mutable URL or an incomplete registered-office disclosure. The public
production bytes are not release-proven until this exact approved bundle is
deployed with both environment purchase gates closed and
`npm run verify:published-legal` passes.

## 6. Local verification

Run from the repository root:

```sh
npm run lint
npm run test:ci
npm run test:infrastructure
npm run verify:monitoring
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
19 August 2026. On 20 August the live Stripe objects and deployed webhook
receiver described below were verified while every purchase gate stayed closed.
Deployed staging, Resend and a signed live delivery/payment smoke remain undone.

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

   The local `demo-alphawod-stripe` exercise completed on 19 August 2026 before
   the presale policy was added:
   public catalogue/form -> real hosted Stripe sandbox Checkout -> £24.38 test
   payment -> Stripe-delivered webhook -> fulfilled intent and active local
   membership -> local success redirect. The exact Session and Subscription
   were independently re-read from Stripe; the durable confirmation outbox was
   present and pending. Resend, anonymous account claim and deployed staging
   were not exercised. Treat it as a historical seam baseline; the £0 presale
   and discount journeys must be rerun and recorded before release.
2. **Verify the live catalogue.** The business supplied Dashboard Product and
   Price exports dated 17 August 2026. All five pairs were independently re-read
   from Stripe's live API on 19 August 2026 and were active, live, monthly GBP
   objects with the approved amounts, `per_unit`/`licensed` billing,
   `tax_behavior=unspecified` and Product tax code `txcd_50021001`:

   | Plan | LIVE Product | LIVE Price | Monthly amount |
   | --- | --- | --- | ---: |
   | Adult Unlimited | `prod_V5VhTEmyekcpY4` | `price_1U5KgYFzNDZoGGA0jGftxyZH` | £60 |
   | Adult Ladies Only | `prod_V5VkRs10lzG989` | `price_1U5KjOFzNDZoGGA0j3qcds5p` | £50 |
   | Adult Gym Only | `prod_V5VlQAfdAYSb0G` | `price_1U5Kk9FzNDZoGGA0dQ61G49d` | £45 |
   | HYROX Youngstars (`HYROX Youngstars U11` in Stripe) | `prod_V5Vq0l9VAaPox9` | `price_1U5KoQFzNDZoGGA0s4t806bH` | £35 |
   | HYROX Teenstars (`HYROX Teenstars 12+` in Stripe) | `prod_V5VumrjZl1bWV1` | `price_1U5Kt8FzNDZoGGA0ogq41DEw` | £35 |

   The `price_1U5K...` mapping is live; the `price_1U5P...` mapping in
   `functions/.env.example` is the verified sandbox catalogue. Products,
   prices, the portal configuration, and the webhook endpoint/signing secret
   remain mode-specific and never carry across. The two live youth Products use
   longer provider labels than the customer-facing app catalogue; their exact
   expected names and IDs are deliberately bound in the live source manifest.

   The corrected test IDs in `functions/.env.example` are correct for the dry
   run and a test-mode deployment. The checkout preflight retrieves the configured Price
   and expanded Product and verifies mode, active state, exact frozen live IDs
   and provider names, GBP amount, monthly recurrence and tax shape before
   taking an identity lock. `resolvePriceId` also refuses the known test IDs and
   any unreviewed live Price alongside a live key.

   The source manifest is `functions/src/stripeLiveCatalog.ts`; update it only
   after a deliberate Price/Product rotation and another read-only live API
   verification.
3. **Confirm tax presentation.** The exported prices have
   `tax_behavior: unspecified` and the business is not VAT registered. Automatic
   tax is disabled in code. Confirm this matches the Stripe Dashboard so the
   displayed price is the total customer price.
4. **Create and verify the existing-member offer in each Stripe mode.** Do not
   create a temporary £55 Price; Adult Unlimited remains £60. In the Stripe
   Dashboard's Product catalogue/Coupons area, create a fixed-amount Coupon with
   exactly: £5.00 off, GBP, duration `repeating`, three months, applies only to
   the Adult Unlimited Product, and no `redeem_by` timestamp. Do not set a
   minimum order or first-time-order restriction, and leave the Coupon's global
   maximum redemptions unset. The application—not the Coupon—enforces the local
   presale signup cutoff (`1788217200`).

   Create one privately distributed shared Promotion Code backed by that
   Coupon. It must also have maximum redemptions unset, no `expires_at`
   timestamp, no minimum amount, no first-time-transaction
   restriction, no currency-options
   restriction and no Stripe Customer restriction (Checkout creates the
   Customer in this pay-first journey). Put its `promo_...` id in
   `STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID`. The server resolves that exact
   Code before creating Checkout, and fulfilment binds the same id; it never
   enables Stripe's hosted accept-any-code field.

   A shared code can be forwarded and Stripe cannot infer prior gym membership
   from a new Customer. This small campaign accepts that operational risk.
   Staff must compare redemptions with the eligible signup list during the
   presale and deactivate the Code immediately if unexpected use appears. Do
   not rely on the application or Stripe to prove existing-member eligibility.
   When the campaign is finished, staff deactivate the exact Promotion Code;
   the Coupon remains available for validation of purchases already in flight.
   Leaving the provider objects open does not extend the application's fixed
   presale cutoff (`1788217200`).

   Put the resulting Coupon id—not the customer-facing code—in
   `STRIPE_EXISTING_MEMBER_COUPON_ID`. The checked-in test configuration uses
   Coupon `zaf_existing_member_5off_3mo_2026_test_v2`, restricted to test Product
   `prod_V5ad9hrrvMkdhw`, and shared Promotion Code id
   `promo_1U6ThDFzNDZoGGA0OT0EaV8Z` (customer code `EXISTING5-TEST`). The
   read-only preflight retrieves that exact Code, verifies its campaign
   restrictions and requires it to be the Coupon's only active Code. It accepts
   any non-negative `times_redeemed` count so repeated tests do not need a new
   Code. Test objects do not copy into live mode.

   **Verified live status, 20 August 2026:** Coupon
   `zaf_existing_member_5off_3mo_2026` is restricted to the Adult Unlimited
   Product `prod_V5VhTEmyekcpY4`, is £5 GBP off for three months and has no
   `redeem_by`. Active Promotion Code
   `promo_1U6EsgFzNDZoGGA0DjPqkz08` (`ZALOYALTY`) is backed by that Coupon and
   has no `expires_at`. Record those exact ids in the git-ignored production
   Functions configuration while purchases remain closed.
5. **Create the Customer Portal configuration** (one per mode) and put its
   `bpc_...` ID in `STRIPE_PORTAL_CONFIGURATION_ID`.

   **Verified live status, 20 August 2026:** configuration
   `bpc_1U6SIkFzNDZoGGA0mSE5EepR` is active and locked down. Invoice history and
   payment-method update are enabled; customer update, subscription cancellation
   and subscription update are disabled, and its hosted login page is disabled.

   `subscription_cancel` and `subscription_update` must both be disabled.
   Cancellation runs through the in-app
   request flow so the 14-day notice rule is applied and the receipt time is
   recorded as evidence; Stripe's own cancel button would bypass both. Enable
   only invoice history and payment-method update, which is exactly what the
   Cancellation Policy tells customers the portal is for.

   Pause is no longer a Customer Portal feature in the Stripe API, so the
   no-pause rule needs nothing configured.

   Passing no configuration would make Stripe fall back to the account's default
   portal configuration, whose settings can change independently. That is why
   `createCustomerPortalSession` refuses to open a portal when this is unset or
   when the retrieved configuration enables cancellation/subscription changes,
   rather than quietly using the default.

   Disable every shareable hosted Customer Portal login page for unsafe/default
   configurations too. Runtime validation protects sessions this app creates;
   it cannot stop a customer using a separately enabled Stripe-hosted login URL.
6. **Enable dynamic payment methods** in the Dashboard. The code deliberately
   does not pin `payment_method_types`.
7. **Set the Stripe API and email secrets.**

   ```sh
   firebase functions:secrets:get STRIPE_SECRET_KEY --project alphawod-d1f2f
   firebase functions:secrets:get STRIPE_WEBHOOK_SECRET --project alphawod-d1f2f
   firebase functions:secrets:get RESEND_API_KEY --project alphawod-d1f2f
   firebase functions:secrets:get MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET --project alphawod-d1f2f

   firebase functions:secrets:set STRIPE_SECRET_KEY --project alphawod-d1f2f
   firebase functions:secrets:set RESEND_API_KEY --project alphawod-d1f2f
   firebase functions:secrets:set MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET --project alphawod-d1f2f
   ```

   The `get` commands inspect metadata, not secret values. Set or rotate a
   secret only under the release change authorisation; do not paste values into
   dotenv files, command arguments, tickets or logs.

   **Verified live status, 20 August 2026:** Secret Manager metadata confirms an
   enabled version exists for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
   `MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET`. This proves existence, not the secret
   values or a successful signed delivery. Resend configuration and delivery
   remain unverified.

   The code reuses the `RESEND_API_KEY` secret definition used by member invites,
   but no membership-email live configuration or delivery has been verified.
   Verify the `zeroalphafitness.co.uk` sending domain in Resend so confirmations
   are not rejected or spam-filed.

8. **Create the webhook endpoint before the first webhook deployment.** Use the
   deterministic final `stripeWebhook` Functions URL while purchasing is still
   closed, subscribe it to the events below, copy the endpoint's newly issued
   `whsec_...` value, and only then run
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project alphawod-d1f2f`.
   This avoids the
   impossible ordering of trying to configure a signing secret before Stripe
   has created the endpoint that issues it. Deploy the webhook only after the
   real secret exists. Subscribe to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`,
   `charge.dispute.created`, `charge.dispute.closed`, `charge.refunded`.

   **Verified live status, 20 August 2026:** endpoint
   `we_1U6SObFzNDZoGGA0cw5Yyqth` is active at
   `https://europe-west1-alphawod-d1f2f.cloudfunctions.net/stripeWebhook` with
   exactly those 14 events. The receiver is an active Node.js 24 function in
   `europe-west1`. A public GET returned the expected `405`, and an unsigned POST
   returned the expected `400`. Those checks prove routing and unsigned-request
   rejection only; no signed Stripe delivery, durable event processing or live
   payment has been smoke-tested. All other membership functions and workers
   remain undeployed.
9. **Configure Firebase Auth recovery email routing.** Add the staging and final
   app origins to Firebase Auth's authorised domains/action settings, then prove
   that a buyer can close the Checkout tab, follow the confirmation's sign-up or
   login route, receive and complete email verification, and claim by the billed
   address on `/account/membership`.

## 8. Deployment notes that inherit Phase 0 constraints

**Launch deployment remains closed.** The public `stripeWebhook` prerequisite is
the only new live service; the items below are not authorisation to deploy or
open any other membership surface.

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
- Rules changes are additive: ten new deny-all collection blocks. No existing
  rule was modified.
- Deploy the `memberships` composite index on `state` and
  `nextReconcileAt` before the grace-reconciliation worker is enabled.
- Schema version 1 is acceptable for this first rollout only if all ten billing
  collections are empty. The receiver deployment and unsigned probes do not
  prove that assumption; preflight must prove they are clean. If any
  billing documents exist, stop and design a version bump/migration/backfill;
  this code is not a dual-read migration for unknown data.
- After final rules and backend contracts are ready and the approved documents
  are in the release commit, confirm the external Vercel project, Production
  branch, domain and complete Production environment. Deploy that exact commit
  with `REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`, then verify the published
  document bytes and SPA rewrites before deploying the membership Functions.
  Repository configuration cannot prove the external Vercel linkage. Only after
  the closed frontend and callable batch are live may the exact reviewed
  service-level client-callable transport be restored, following the Phase 0
  restoration manifest; never use a project-level invoker grant. Keep the
  webhook's public HTTP IAM and scheduler identities separate.
- Before maintenance ends, inspect IAM and smoke-test each callable through the
  real Firebase client transport. The public checkout callable must reach its
  handler and fail at the still-closed runtime gate, not at Cloud Run IAM or
  CORS; signed-in, owner-only and admin callables must reach their handlers and
  enforce their respective authentication/authorisation boundaries.

### Exact selective deployment commands

These commands are subordinate to the Phase 0 maintenance, backup and IAM
sequence above. They are exact targets, not authorisation to run them. Deploy
the index before enabling scheduled workers:

```sh
firebase deploy --only firestore:indexes --project alphawod-d1f2f
```

At the Phase 0 final-policy step, deploy only the reviewed rules targets:

```sh
firebase deploy --only firestore:rules,storage --project alphawod-d1f2f
```

Publish the final document registry and byte-identical `.txt` files in the exact
reviewed frontend commit while both deploy-time purchase controls remain closed:
`MEMBERSHIP_PURCHASE_ENABLED=false` in
`functions/.env.alphawod-d1f2f` and
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false` in Vercel Production. Before
triggering Vercel, run the closed-frontend check with the exact reviewed
Production environment:

```sh
npm run verify:frontend-production-closed
```

There is deliberately no guessed Vercel CLI command in this repository. Confirm
the connected Vercel project, Production branch, canonical domain and environment
outside the repository, deploy this exact commit through that confirmed workflow,
and record the deployed commit SHA. Stop if any of those bindings is unknown.
After the deployment is live, prove its legal bytes and the still-closed backend
configuration:

```sh
npm run verify:published-legal
npm run verify:production-armed-config --prefix functions
```

Only after those checks pass and every required secret exists, deploy exactly
the twelve membership services in two batches. Keeping each batch at ten or
fewer follows Firebase's deployment quota guidance. Deploy the signed public
webhook and four non-callable workers first:

```sh
firebase deploy --only functions:stripeWebhook,functions:recoverStripeEvents,functions:recoverMembershipCancellations,functions:reconcilePastDueMemberships,functions:retryMembershipConfirmations --project alphawod-d1f2f
```

Verify that the webhook is public, each worker has only its expected scheduler
invocation path and all five schedules/triggers are correct. Then deploy the
seven client callables as the second batch:

```sh
firebase deploy --only functions:createMembershipCheckoutSession,functions:createCustomerPortalSession,functions:getMyMemberships,functions:requestMembershipCancellation,functions:claimMembership,functions:listMemberships,functions:linkMembershipParticipant --project alphawod-d1f2f
```

Immediately inventory and re-block those seven callable services using the
Phase 0 service-level IAM procedure before any other rollout step. Do not apply
that callable IAM block to `stripeWebhook` or the scheduled workers. Once the
closed frontend is confirmed, restore only the reviewed service-level callable
transport and smoke-test every handler. Checkout must reach its handler but fail
at the still-closed runtime gate; it must not create a Stripe Session. The final
backend-then-frontend opening and backend-first rollback are in
`production-operations.md`.

Do not replace any of these with a blanket Functions deployment. Opening and
rollback each redeploy only `createMembershipCheckoutSession`; the exact
commands and required config preflights are in `production-operations.md`.

## 9. Launch blockers still open

These are the remaining release blockers, not optional future enhancements:

- Deploy the approved 20 August document bundle in the exact closed Vercel
  release, record the deployed commit SHA and pass
  `npm run verify:published-legal` against production before the backend Phase 1
  deployment. Approval, final DOCX generation, canonical public text, registry
  synchronization and the checked-in source gate are complete; deployed-byte
  verification is still outstanding.
- Establish the staffed human cooling-off refund operation before purchase
  opens. The member callable now freezes an immutable receipt before Stripe,
  immediately stops
  provider billing, preserves receipt time separately from provider completion,
  queues crash/provider recovery, flags the proportionate-service/refund review
  and sends a durable acknowledgement. The business must still define and staff
  the lawful refund calculation, decision, execution and audit SLA.
- Finish the production setup for the anonymous-checkout abuse controls. The
  callable now requires a limited-use App Check token from the exact configured
  web app, consumes it with replay protection, applies privacy-safe HMAC source
  throttles plus stable-attempt admission before Stripe, and emits monitored
  abuse markers. Operators must still create the production reCAPTCHA
  Enterprise/App Check registration and IAM grant, install the 32-byte-or-longer
  rate-limit secret access, attach real alert channels/budgets and record an approved
  human-challenge/incident response. App Check alone is not proof of a human.
- Build and verify the isolated deployed staging Firebase/Stripe test-mode
  boundary described in section 7. The explicit project/key/object-mode guard
  is implemented and locally covered, but the emulator-only `demo-*` journey is
  not evidence of a deployed staging boundary. Do not point a test key at
  production Firebase data or infer safety from price-id prefixes.
- Add an audited staff intake path for cancellation requests received by email.
  It must freeze the actual receipt time and policy outcome, write immutable
  audit evidence, and enter the same durable recovery state machine as the
  member callable. Until that exists, customer copy requires written staff
  confirmation and does not claim that inbound email is automatically applied.
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
- Run both real isolated Stripe test-mode presale journeys (without a code and
  with the shared Adult Unlimited code) through hosted Checkout and
  Stripe-delivered webhooks. Use a Test Clock to prove the three discounted
  invoices and December return to £60, then exercise Events recovery and a real
  Resend test delivery before considering either purchase gate. Nothing in the
  emulator suite substitutes for this.

## 9a. Durable confirmation email

Fulfilment queues a durable confirmation for scheduled delivery via Resend. Its
frozen body currently includes the plan, participant and guardian summary,
monthly price, the amount actually charged today (including £0 presale evidence,
taken from Stripe's `amount_total` and never recalculated), the service start,
first payment and first full billing date, any approved discount schedule, the
cancellation rule and how to exercise it, the refund and no-pause statements,
the cooling-off end date and service-start performance choice, every exact
separately accepted statement, document title/version/hash/content, signer role,
and typed signature. The complete canonical document text appears inline and is
also attached as one base64-encoded UTF-8 plain-text file per accepted document.
Those copies now contain the complete approved canonical text. They must not be
described as the production-published contract until the exact closed frontend
release is live and `npm run verify:published-legal` proves the deployed bytes.

For an unclaimed purchase it also carries the claim link, which is the only
thing that brings back a buyer who completed Checkout and closed the tab.

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

Email availability never controls whether a paid or £0 scheduled membership
fulfils, and an email failure never rolls back its state. Recovery is driven by the durable outbox
and its scheduled worker; it does not wait for another Stripe webhook retry.

Requires `RESEND_API_KEY` (already used for invites) and the
`MEMBERSHIP_FROM_EMAIL` param, which defaults to
`hello@zeroalphafitness.co.uk`. That domain must be verified in Resend.

## 9b. Known product gaps, deliberately not built

- **Automated cooling-off refund calculation.** Online cooling-off notice,
  immediate provider cancellation, immutable receipt, recovery and durable
  acknowledgement are implemented. The proportionate-service/refund amount is
  deliberately left `null` for a documented human decision and execution; the
  staffed refund operation remains a launch blocker in section 9.
- **Automated Test Clock journey.** The local hosted Checkout verifier proves
  the frozen September-to-December schedule but does not yet advance a Stripe
  Test Clock through all four invoices. Run and record that separately in
  isolated staging before treating the three-payment discount schedule as
  provider-proven.
- **Price-change notice flow.** Terms 6 requires advance notice; not built.
- **Youth onboarding workflow.** Payment deliberately does not book a first
  session; the approved message tells the guardian they will be contacted.

## 10. Open items for the business

1. Staff and document the human late-notice and cooling-off refund operation
   required by the approved Cancellation, Refund and Cooling-off Policy,
   including decision, execution and audit ownership.
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
  before an elapsed reservation can be reclaimed, source-document approval
  validation and closed-runtime rejection at the exported handler boundary;
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
  evidence, while an inside-window cooling-off request atomically records its
  receipt and acknowledgement, stops provider billing and enters durable
  recovery/refund review without receiving the ordinary renewal-notice outcome;
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
or production. The approved source-document gate is now `true`, while both
production environment purchase gates remain `false`. The emulator-bound test
journey used its explicit isolated test-mode path and did not open production.

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
