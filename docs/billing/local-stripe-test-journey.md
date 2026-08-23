# Local Stripe test payment journey

This journey uses Stripe's real **test-mode** Checkout and webhooks while all
Firebase state stays inside local emulators under `demo-alphawod-stripe`. It
does not deploy anything, touch production Firebase data, take real money or
open the normal purchase gates.

The five-document approval recorded on 20 August is historical. The business
owner separately approved the revised youth-family bundle dated 23 August 2026.
The local UI must render those exact approved bytes, but this journey does not
prove production publication or provider configuration. Both production
environment purchase gates remain `false` until the approved legal bytes and
Stripe youth configuration are independently verified. The narrow test-mode
path works only when every frontend and backend local-test condition matches;
production project
`alphawod-d1f2f` is explicitly forbidden from using Stripe test mode.

## One-time local setup

From the repository root:

```sh
cp .env.local.example .env.local
cp functions/.env.local.example functions/.env.local
```

Authenticate the Stripe CLI once:

```sh
stripe login
stripe whoami
```

Do not create `functions/.secret.local`, and do not put a Stripe key or webhook
secret in any dotenv file. The runner reads the authenticated CLI's short-lived
restricted test key and the listener's temporary signing secret into process
memory without creating another secret file. (`stripe login` maintains its own
permission-restricted CLI profile.) It refuses live keys, real Firebase
projects, occupied local ports, credential-bearing dotenv files and mixed
Stripe accounts.

## Run the journey

Start the complete stack from the repository root:

```sh
npm run stripe:test
```

That single command builds Functions, starts a real Stripe test-mode listener,
runs the read-only catalogue/Portal preflight, starts Auth, Firestore and
Functions emulators in `demo-alphawod-stripe`, and finally starts the frontend
on the fixed test port. Provider credentials are redacted from output, are never
passed to the browser process and are not written by the runner. Press Ctrl-C
once to stop the whole stack.

The preflight retrieves every configured Price and expanded Product from Stripe
and checks test mode, active state, Product name, GBP amount and monthly
recurrence. It also verifies the test Portal keeps cancellation and subscription
updates disabled and the youth-family Coupon is exactly 15% off forever, has no
redemption deadline or cap, and applies to exactly the Youngstars and Teenstars
Products. It prints object IDs but makes no Stripe changes.

Open `http://localhost:3002/memberships`, choose a plan and complete hosted
Checkout with a Stripe test card such as `4242 4242 4242 4242`, any future
expiry and any CVC/postcode. During the founding presale Stripe saves the test
payment method but charges **£0 today**. The subscription is scheduled for
service from 1 September and its first payment anchor is 1 September. The app
shows a prominent test-only notice and presents the same approved, versioned
legal documents used by the release.

The current frontend calls only `createMembershipCheckoutSessionV2` and sends
`checkoutSchemaVersion: 2`. For Youngstars, each child must be 6–11 and costs
£30 per month; for Teenstars, each child must be 12–16 and costs £35 per month.
Use “Add another child” to register 1–10 children on the selected same plan.
One child pays the standard price. From two children, the family Coupon applies
15% off the whole monthly subtotal forever: two Youngstars are £60 less £9 =
£51 per month, and two Teenstars are £70 less £10.50 = £59.50 per month. Hosted
Checkout should show one subscription item whose quantity equals the number of
children. A mixed Youngstars/Teenstars subscription is not supported.

`STRIPE_YOUTH_FAMILY_COUPON_ID` is the exact provider-side allowlist. The test
configuration uses `zaf_youth_family_15pct_2026_test`. It is applied
automatically only at quantity 2–10; there is no family Promotion Code and no
customer-entered code field for this offer.

For Adult Unlimited, enter the explicitly test-only shared code
`EXISTING5-TEST` in the AlphaWOD registration form before opening Stripe.
The hosted Stripe promotion-code box is deliberately disabled because it
cannot be restricted to this campaign. The app stops accepting the shared code
for new registrations at the local opening cutoff. The provider-side Promotion
Code has no `expires_at`, and its underlying Coupon deliberately has no
`redeem_by` timestamp. Staff deactivate the shared Code manually when the
campaign is finished; this does not alter the application's fixed cutoff and
keeps an already-open presale Session valid. The test code must never be
presented as a live customer code. A successful application freezes a
schedule of £55 on 1 September, 1 October and 1 November, followed by the base
£60 price from 1 December.

`STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID` is the exact provider-side allowlist;
the test value is `promo_1U6ThDFzNDZoGGA0OT0EaV8Z`, and the preflight requires
it to be the Coupon's only active Promotion Code. The shared Code and Coupon
have no redemption cap. The verifier accepts any non-negative current redemption
count, so repeat test journeys do not require a fresh Code. Live use is manually
moderated against the small eligible-member list rather than through individual
codes.

After Stripe returns to the success page, keep the runner open and run the
read-only post-payment check in a second terminal. With no explicit Session id,
it finds the newest unambiguous local journey and waits briefly for its webhook:

```sh
npm run verify:stripe-test-journey --prefix functions
```

You can instead pass an exact id as
`-- --session=cs_test_...` when troubleshooting.

For the Adult Unlimited discount run, make the verifier require evidence that
the allowlisted shared Promotion Code was applied:

```sh
npm run verify:stripe-test-journey --prefix functions -- \
  --session=cs_test_... --require-discount=true
```

For a presale Session, the check proves `payment_status=no_payment_required`,
`amount_total=0`, payment-method collection, no trial or initial invoice, the
exact fixed Stripe billing anchor, a `scheduled` non-entitled membership, a £0
confirmation record and—when required—the approved Coupon and shared Promotion
Code schedule. For a post-opening run it continues to require a paid
standard subscription. It does not send the confirmation email or advance
Stripe time through future invoices; real Resend delivery and Test Clock
invoice simulation are separate controlled tests.

The existing post-payment verifier's `--require-discount` option proves only
the Adult Unlimited fixed/repeating Promotion Code. It does **not** yet prove
the youth-family Coupon. For each youth plan, retain controlled one-child and
two-child runs and record the exact Session id. Independently re-read the Stripe
Session and Subscription and verify the selected Price, a single item whose
quantity equals the child count, and—for two children—the allowlisted 15%-off
forever family Coupon and expected recurring total. Also inspect the emulator
intent, membership and confirmation outbox for every participant name, the
matching count, frozen discount schedule and accepted statements. Do not cite
the existing verifier alone as evidence of the family offer.

## Historical provider baseline — 19 August 2026

Before the founding-presale policy was implemented, the complete anonymous customer journey was exercised from the public
membership catalogue through the Adult Unlimited form and real Stripe-hosted
sandbox Checkout, then back to the local `/memberships/success` route. Stripe
collected a £24.38 prorated test payment and scheduled the £60 GBP monthly
subscription from 1 September 2026.

The post-payment verifier independently confirmed that the exact test Checkout
Session was paid, the linked test Subscription was active, the Firestore intent
was fulfilled, the provider-bound membership was active, and one immutable
confirmation outbox row existed in `pending` state. Stripe delivered
`invoice.paid` and `customer.subscription.created` before
`checkout.session.completed`; the dependency-aware handlers returned a
retryable failure until Checkout fulfilment existed, while the Checkout event
completed successfully. This is the intended out-of-order-event behaviour.

That historical run proves the local catalogue/form -> hosted Checkout ->
Stripe webhook -> Firestore membership -> success redirect seam for the former
prorated policy. It is not evidence that the new £0 presale, scheduled-access or
discount paths pass. Re-run both the standard presale and Adult Unlimited
shared-code journeys and record their Session ids before release. It did
not send through Resend, claim the anonymous purchase into an account, exercise
a deployed staging environment, or change either normal purchase gate.

## Presale time boundaries

- Presale signup and the app's acceptance of the shared code close at **1
  September 2026 00:00 Europe/London** (`2026-08-31T23:00:00Z`, Unix
  `1788217200`).
- The Coupon has no Stripe `redeem_by`, and its only active shared Promotion
  Code has no `expires_at`. Staff deactivate the Code manually when the
  campaign finishes. The application cutoff remains the customer-facing policy
  boundary regardless of provider object lifetime.
- A buyer who creates their presale intent before that cutoff may finish the
  already-open Stripe Session until five minutes before the billing anchor
  (`1788220500`, 00:55 BST). New intents at or after the cutoff use standard
  immediate billing.
- Service is dated from that local opening boundary.
- Stripe's first recurring billing anchor is **1 September 2026 00:00 UTC**
  (`1788220800`, 01:00 BST). Keeping the provider anchor on UTC day 1 avoids a
  BST London-midnight timestamp becoming UTC day 31 and recurring at month-end.
- Customer-facing screens and email show the date, “1 September 2026”, rather
  than exposing the one-hour implementation distinction.

## What changes for live launch

Live mode is a separate provider environment. Promotion requires more than
changing the Product/Price mapping:

- production Firebase project binding and `STRIPE_EXPECTED_MODE=live`;
- the production app origin;
- a live `sk_live_...` or restricted `rk_live_...` key;
- five live Price ids (each is preflighted with its expanded Product);
- the canonical Youngstars Price at £30 for ages 6–11 and Teenstars Price at £35
  for ages 12–16;
- a separate live £5/repeating-three-month Adult Unlimited Coupon and one
  allowlisted shared reusable live Promotion Code;
- a separate live youth-family Coupon that is exactly 15% off forever, applies
  to exactly both youth Products, has no redemption deadline or cap, and has no
  Promotion Code;
- a locked-down live Customer Portal configuration;
- a live webhook endpoint and its own live signing secret;
- a closed Vercel deployment of the revised immutable checkout documents,
  followed by `npm run verify:published-legal`, plus read-only live Stripe
  verification while both normal purchase switches remain false;
- completion of every remaining launch blocker in the Phase 1 rollout.

Never reuse the CLI listener secret, test Portal configuration, test Prices or
test customers/subscriptions in live mode. Operators configure the five live
Price IDs; the corresponding reviewed live Product IDs are frozen server-side.
Each Price is expanded to its Product and both exact objects are validated.
