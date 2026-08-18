# Phase 1: public membership purchase and Stripe Billing

Status: implemented locally on 18 August 2026. Frontend and Functions build,
lint, unit, rules, and emulator suites pass. **Nothing has been deployed and no
live Stripe configuration has been created.** The purchase flow is closed by two
independent gates and cannot be opened by configuration alone.

## 1. What was built

| Area | Location |
| --- | --- |
| Canonical catalogue, policy and billing maths | `functions/src/membershipPlans.ts` |
| Frontend mirror (held identical by a parity test) | `src/lib/membershipPlans.ts` |
| Checkout, portal, cancellation, webhook, admin callables | `functions/src/membership.ts` |
| Deployed function manifest | `functions/src/index.ts` |
| Public catalogue and checkout | `src/features/memberships/pages/` |
| Member billing management | `src/features/memberships/pages/MembershipManage.tsx` |
| Admin inspection and participant linking | `src/features/admin/pages/AdminMemberships.tsx` |
| Server-only billing collections | `firestore.rules` |
| Runtime configuration template | `functions/.env.example` |

New deployed functions: `createMembershipCheckoutSession`,
`createCustomerPortalSession`, `getMyMemberships`,
`requestMembershipCancellation`, `claimMembership`, `stripeWebhook`,
`listMemberships`, `linkMembershipParticipant`.

New Firestore collections, all denied to every client: `memberships`,
`membershipIntents`, `stripeEvents`, `membershipAudit`.

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
  anchor has passed and be rejected by Stripe.
- **Cancellation.** `resolveCancellationOutcome` implements the 14 calendar day
  renewal rule and both worked examples in the Cancellation Policy, including
  the late case that carries the membership through one further paid month. The
  outcome is computed server-side, shown to the member before submission, and
  applied as a Stripe `cancel_at`.
- **Past due.** Three calendar days of grace from the failed invoice due date,
  counted on London calendar dates.
- **Disputes and refunds.** Open dispute suspends, dispute won restores, dispute
  lost or full refund revokes. Revocation outranks every other signal.
- **Cooling-off.** The express immediate-performance request is a separate,
  unticked control, recorded with the acceptance evidence and the calculated
  cooling-off end.
- **Grandfathering.** The entitlement a member held before a purchase is stored
  on the membership. If a paid membership later ends, a previous `legacy` or
  `manual` active entitlement is restored rather than removed, so a
  grandfathered member is never demoted by cancelling a later purchase.
- **Staff independence.** Admin and SGPT profiles are never touched by
  membership fulfilment; their access stays role-based with a `staff` source.
- **Duplicates.** Blocked both for the same participant identity (a salted hash
  of name and date of birth) and for a second AlphaWOD-granting membership on
  the same payer account.

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
| Checkout session id | Possession of the id, which is only ever shown to the buyer on the success page | 24 hour window, single use |
| Billing email | The account's email matches the address Stripe billed | Email must be **verified** |

The session-id route exists because a brand new sign-up has not verified its
email yet, and the buyer should not be stuck. The email route has no time limit
but requires verification, because without it anyone could register a victim's
address and take their membership. The attach runs in a transaction that
asserts the membership is still unclaimed, so two accounts racing on the same
purchase cannot both succeed. A claim also cannot give one account a second
AlphaWOD-granting membership.

The claim is attempted automatically on the success page once the buyer signs
in, and again on `/account/membership` from a locally held session id. An
account with no membership is also offered a manual "claim a purchase I already
made", which uses the verified-email route.

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
`linkMembershipParticipant`.

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

**Do not flip gate 1 without replacing the draft document IDs with approved,
published, versioned documents.** Phase 0 recorded the same blocker for the
waiver identifier `2026-30-05`, which is still an unapproved legacy value.

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

State at implementation:

- Frontend: 16 suites, 114 tests passed.
- Functions: build, lint, and 54 pure tests passed.
- Firestore/Storage rules: 21 tests passed, including 5 new billing-collection
  tests.
- Temporary-lockdown compatibility rules: 6 tests passed.
- Functions callable boundary and billing flows (emulator): 18 tests passed.

These emulator suites were the ones Phase 0 left unverified; they now pass in
this environment.

## 7. Stripe configuration required before any deployment

Nothing below has been done. Each step needs the Stripe account owner.

1. **Create the live catalogue.** The 17 August 2026 export is **test mode**,
   confirmed by the account owner on 18 August 2026. Products, prices, the
   portal configuration, and the webhook endpoint and its signing secret are all
   mode-specific and none of them carry across, so the five products and prices
   must be recreated in live mode, producing a different set of price IDs.

   The test IDs in `functions/.env.example` are correct for the dry run and a
   test-mode deployment. `resolvePriceId` refuses to use any of them alongside
   an `sk_live_` key, so a live deployment that still carries them fails with a
   clear message rather than in front of a paying customer.

   Check the live prices against the approved catalogue: £60, £50, £45, £35,
   £35, all GBP, monthly, and confirm the tax behaviour matches the test
   products.
2. **Confirm tax presentation.** The exported prices have
   `tax_behavior: unspecified` and the business is not VAT registered. Automatic
   tax is disabled in code. Confirm this matches the Stripe Dashboard so the
   displayed price is the total customer price.
3. **Create the Customer Portal configuration** (one per mode) and put its
   `bpc_...` ID in `STRIPE_PORTAL_CONFIGURATION_ID`.

   `subscription_cancel` must be disabled. Cancellation runs through the in-app
   request flow so the 14-day notice rule is applied and the receipt time is
   recorded as evidence; Stripe's own cancel button would bypass both. Enable
   only invoice history and payment-method update, which is exactly what the
   Cancellation Policy tells customers the portal is for.

   Pause is no longer a Customer Portal feature in the Stripe API, so the
   no-pause rule needs nothing configured.

   Passing no configuration would make Stripe fall back to the account's default
   portal configuration, which has cancellation enabled. That is why
   `createCustomerPortalSession` refuses to open a portal when this is unset,
   rather than quietly using the default.
4. **Enable dynamic payment methods** in the Dashboard. The code deliberately
   does not pin `payment_method_types`.
5. **Set the secrets.**

   ```sh
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

   `RESEND_API_KEY` is already set for member invites and is reused by the
   confirmation email. Verify the `zeroalphafitness.co.uk` sending domain in
   Resend so confirmations are not rejected or spam-filed.

6. **Create the webhook endpoint** pointing at the deployed `stripeWebhook` URL,
   subscribed to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`,
   `invoice.paid`, `invoice.payment_failed`, `charge.dispute.created`,
   `charge.dispute.closed`, `charge.refunded`.

## 8. Deployment notes that inherit Phase 0 constraints

The Phase 0 runbook's callable-freeze and identity-admin-freeze rules still
apply to any deployment that touches the existing functions.

- `stripeWebhook` is an `onRequest` function and **must be publicly invokable**.
  It is not a callable and must not be given the callable IAM lockdown. Its
  security is the Stripe signature check, which runs against the raw body before
  anything else, plus the `stripeEvents` idempotency ledger.
- The six new callables must be created and then re-blocked in the same way
  Phase 0 step 7 describes for its four new callables: the Firebase CLI makes
  newly created callables public on creation.
- Deploy selectively. Do not use `--only functions`.
- Rules changes are additive: four new deny-all collection blocks. No existing
  rule was modified.

## 9. Known gaps, deliberately not built

- **Cooling-off refund execution.** The express request and the calculated
  cooling-off end are recorded, and a cancellation inside the window is
  processed, but the proportionate statutory refund is a manual Stripe action.
  No automated refund is issued.
- **Promotion codes.** Terms 3 allows them; `allow_promotion_codes` is not
  enabled.
- **Price-change notice flow.** Terms 6 requires advance notice; not built.
- **Youth onboarding workflow.** Payment deliberately does not book a first
  session; the approved message tells the guardian they will be contacted.

## 9a. Durable confirmation email

Sent from the fulfilment path via Resend, carrying everything Membership Terms 4
requires in the body rather than behind a link: plan, participant and guardian,
monthly price, the amount actually charged today (taken from Stripe's
`amount_total`, never recalculated), the first full billing date, the
cancellation rule and how to exercise it, the refund and no-pause statements,
the cooling-off end date and whether immediate performance was requested, the
accepted document versions, and the typed signature.

For an unclaimed purchase it also carries the claim link, which is the only
thing that brings back a buyer who paid and closed the tab.

Sending is guarded by a transactional `confirmationEmailSentAt` marker rather
than the webhook event ledger, because two different Stripe events can reach
fulfilment for one purchase. A failure clears the marker so a Stripe retry can
resend, and never fails the webhook: the membership is paid and valid, so a lost
email must not roll back fulfilment. Failures are recorded on the membership as
`confirmationEmailError` and in the audit log.

Requires `RESEND_API_KEY` (already used for invites) and the
`MEMBERSHIP_FROM_EMAIL` param, which defaults to
`hello@zeroalphafitness.co.uk`. That domain must be verified in Resend.

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

## 10a. Billing integration tests

`functions/test-emulator/membership.test.js` runs the real handlers against the
Firestore and Auth emulators, with `fakeStripe.js` standing in for the Stripe
API. No Stripe account, key, or network access is needed, so this suite runs in
CI and on any machine.

It covers the paths where money and access change hands:

- claiming by checkout session grants access and approves the account;
- an unverified email cannot claim without the session id;
- a verified matching email can claim without it;
- a different verified account cannot claim someone else's purchase;
- a purchase can only be claimed once, even by two holders of the same link;
- an expired session link is refused;
- youth, Ladies Only and Gym Only never move a member's entitlement;
- staff keep role-based `staff` access when they buy a membership;
- cancellation sends the policy's exact `cancel_at` to Stripe with
  `proration_behavior: none`, and stores the matching outcome;
- only the payer can cancel;
- a member sees only their own memberships;
- a claim cannot give one account a second AlphaWOD membership.

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
