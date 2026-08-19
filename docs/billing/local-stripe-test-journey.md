# Local Stripe test payment journey

This journey uses Stripe's real **test-mode** Checkout and webhooks while all
Firebase state stays inside local emulators under `demo-alphawod-stripe`. It
does not deploy anything, touch production Firebase data, take real money or
open the normal purchase gates.

The normal legal publication gate remains `false`. The narrow test bypass works
only when every frontend and backend local-test condition matches; production
project `alphawod-d1f2f` is explicitly forbidden from using Stripe test mode.

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
updates disabled. It prints object IDs but makes no Stripe changes.

Open `http://localhost:3002/memberships`, choose a plan and complete hosted
Checkout with a Stripe test card such as `4242 4242 4242 4242`, any future
expiry and any CVC/postcode. During the founding presale Stripe saves the test
payment method but charges **£0 today**. The subscription is scheduled for
service from 1 September and its first payment anchor is 1 September. The app
shows a prominent test-only notice and continues to label the legal documents
as drafts.

For Adult Unlimited, enter the explicitly test-only shared code
`EXISTING5-TEST` in the AlphaWOD registration form before opening Stripe.
The hosted Stripe promotion-code box is deliberately disabled because it
cannot be restricted to this campaign. The reusable test code expires at
opening and must never be presented as a live customer code. A successful
application freezes a
schedule of £55 on 1 September, 1 October and 1 November, followed by the base
£60 price from 1 December.

`STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID` is the exact provider-side allowlist;
the test value is `promo_1U69iNFzNDZoGGA0C3i8uyAJ`, and the preflight requires
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

- Presale signup and Promotion Code redemption close at **1 September 2026
  00:00 Europe/London** (`2026-08-31T23:00:00Z`, Unix `1788217200`).
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
- a separate live £5/repeating-three-month Adult Unlimited Coupon and one
  allowlisted shared reusable live Promotion Code;
- a locked-down live Customer Portal configuration;
- a live webhook endpoint and its own live signing secret;
- approved immutable checkout documents and the normal purchase switch;
- completion of every remaining launch blocker in the Phase 1 rollout.

Never reuse the CLI listener secret, test Portal configuration, test Prices or
test customers/subscriptions in live mode. Product IDs are not entered in the
app: each configured Price is expanded to its Product and both are validated.
