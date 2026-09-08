# Local Stripe test payment journey

This journey uses Stripe's real **test-mode** Checkout and webhooks while all
Firebase state stays inside local emulators under `demo-alphawod-stripe`. It
does not deploy anything, touch production Firebase data, take real money or
open the normal purchase gates.

The five-document approvals recorded on 20 and 23 August are historical. The
current mixed publication bundle retains the 23 August Cancellation Policy and
Adult Waiver, uses the 25 August Privacy Notice, and uses the revised 27 August
Membership Terms and Guardian Addendum. The local UI must render those exact approved bytes, but this journey does not
prove production publication or provider configuration. Both production
environment purchase gates remain `false` until the approved legal bytes and
Stripe youth configuration are independently verified. The narrow test-mode
path works only when every frontend and backend local-test condition matches;
production project
`alphawod-d1f2f` is explicitly forbidden from using Stripe test mode.

## One-time local setup

The browser harness requires macOS or Linux because its complete child-tree
cleanup relies on POSIX process groups. It fails closed on Windows instead of
risking leaving Firebase emulator descendants running.

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

The new Conditioning Product and Price can be verified independently before
starting any Checkout or creating a subscription:

```sh
npm run stripe:test:conditioning-preflight
```

This read-only scope retrieves only Adult Conditioning and the locked-down
Customer Portal. It deliberately excludes unrelated coupons, youth products
and PAYG, and cannot be widened to another plan through its scope input. The
default full-catalogue preflight remains unchanged and must still fail if any
existing plan has provider drift.

The one-time PAYG Product and Price have their own equally narrow read-only
preflight:

```sh
npm run stripe:test:payg-preflight
```

That scope retrieves no recurring membership Price, includes only the exact
`adult_payg_class` Product/Price pair, and skips both the existing-member and
youth-family offers. It may also read the optional locked-down Customer Portal
configuration; it creates or changes no Stripe object. Run the separate full
catalogue preflight when evidence for the whole provider catalogue is required.

Start the complete stack from the repository root:

```sh
npm run stripe:test
```

To exercise only the new Adult Conditioning provider journey while retaining
the full catalogue verifier as the default, run:

```bash
npm run stripe:test:conditioning
```

That scoped runner verifies only the exact Adult Conditioning Product and
Price before starting. It cannot select PAYG or silently widen to another
membership plan; `npm run stripe:test` continues to require the complete test
catalogue and all shared offers.

The Conditioning scope also seeds four visibly labelled, non-PAYG classes into
the currently visible London week in the demo emulator only: Thursday A and B
at 18:00, then Friday A and B at 05:30. The seed is hard-bound to
`demo-alphawod-stripe`, loopback Firestore and the loopback browser origin. It
refuses to start after Thursday 15:00 London time when the visible week no
longer contains three open candidates; after Schedule's Saturday 10:00 cutover
it uses the following visible week. Capacity starts at 10 for every fixture,
and every title and location says that it is a local browser test.

Complete Adult Conditioning Checkout in Stripe test mode. Stripe should show
the current prorated amount due and the continuing £30 monthly price. On the
success page choose **Create Zero Alpha App account**, use the same email as
Checkout, and finish account creation. `/account/membership` automatically
consumes the browser-held Checkout verifier and claims that exact membership.
Choose **Continue to my schedule**, type the member name into the current Adult
Waiver, tick its one acknowledgement and choose **I agree**.

Exercise the exact Schedule sequence:

1. Book **Conditioning Browser Thursday A**.
2. Book **Conditioning Browser Friday A**.
3. Try to book **Conditioning Browser Thursday B**. It must remain enabled long
   enough to reach the server, then show: “You’ve used both Conditioning
   bookings for this Monday–Sunday week. Cancel an eligible booking before its
   cutoff to choose another class.”
4. Cancel **Conditioning Browser Friday A**.
5. Book **Conditioning Browser Friday B** as the replacement.

While the stack remains open, first run the provider verifier. If the browser
has already removed the Session id from its URL, omit `--session` and copy the
exact Session id printed by the successful newest-session verification:

```bash
npm run verify:stripe-test-journey --prefix functions
```

Then pass that exact id to the separate full-app verifier:

```bash
npm run verify:stripe-test-conditioning-app-journey --prefix functions -- \
  --session=cs_test_...
```

The second verifier reads only the local emulator. It binds the real fulfilled
membership to its consumed account claim, active entitlement owner, limited
profile projection, canonical current waiver, exact final booking rows, weekly
quota and all four class counts. Its successful output contains no member name,
email, user id, Checkout id or Subscription id. It also states explicitly that
Resend remains disabled and makes no email-delivery claim.

## Explicit one-shot test email delivery

The local runner never enables its scheduled email workers. A release operator
may deliver one already-created test outbox only after receiving explicit
approval for the selected Stripe TEST purchase, its frozen rendered content and
the fixed recipient `hello@zeroalphafitness.co.uk`. The tooling has no latest,
list, batch or recipient-override mode and rejects production Firebase.

Store the existing Resend key only in an owner-readable temporary file outside
the repository. Never print it or place it in a dotenv file. With the local
journey still running, first run the mutation-free preflight using the exact
Checkout Session and exact outbox document ID:

```bash
GCLOUD_PROJECT=demo-alphawod-stripe \
GOOGLE_CLOUD_PROJECT=demo-alphawod-stripe \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
npm --prefix functions run preflight:stripe-test-email -- \
  --session=cs_test_... \
  --outbox-id=sub_... \
  --resend-key-file=/absolute/protected/resend.key
```

Only a `STRIPE_TEST_EMAIL_PREFLIGHT` result with `status=ready`,
`recipientVerified=true`, `senderVerified=true`, `resendNetworkCalled=false`
and `outboxMutated=false` may proceed. Then use the same three exact inputs:

```bash
GCLOUD_PROJECT=demo-alphawod-stripe \
GOOGLE_CLOUD_PROJECT=demo-alphawod-stripe \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
npm --prefix functions run deliver:stripe-test-email-once -- \
  --session=cs_test_... \
  --outbox-id=sub_... \
  --resend-key-file=/absolute/protected/resend.key
```

The sender repeats every preflight, calls the existing leased/idempotent outbox
state machine once, requires its application projection to persist `sent`, and
polls only the returned Resend message ID until `last_event` proves delivery
(`delivered`, `opened` or `clicked`). Its
output contains provider/application identifiers and state only, never the
customer name, address or message body. If provider acceptance is ambiguous,
the exact outbox is quarantined for manual review with no scheduled retry; do
not reset or run it again automatically.

If Resend accepted the POST and the application projection is already `sent`,
but the final delivery readback timed out or had a transient failure, repeat
the same command with `--mode=readback`. This mode revalidates the exact Stripe
Session, outbox, provider ID, sender, recipient, reply-to and subject, performs
GET-only Resend polling and makes no Firebase write or second email POST:

```bash
GCLOUD_PROJECT=demo-alphawod-stripe \
GOOGLE_CLOUD_PROJECT=demo-alphawod-stripe \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
npm --prefix functions run deliver:stripe-test-email-once -- \
  --session=cs_test_... \
  --outbox-id=sub_... \
  --resend-key-file=/absolute/protected/resend.key \
  --mode=readback
```

Remove the protected temporary key file as soon as the selected deliveries
finish.

To exercise the anonymous PAYG browser journey against the exact £7 Stripe
sandbox Product and Price, start the stack in **Terminal 1**:

```bash
npm run stripe:test:payg
```

That command builds Functions, starts a real Stripe test-mode listener, runs
the read-only PAYG catalogue preflight, starts Auth, Firestore and Functions
emulators in `demo-alphawod-stripe`, and finally starts the frontend on the
fixed test port. Keep Terminal 1 and the stack running throughout Checkout and
verification.

This scope loads only the owner-approved immutable PAYG documents into the
isolated emulator process, creates three random in-memory abuse/cancellation
secrets, and seeds one future class into local Firestore. It opens only the
local PAYG gate; production gates and production Firebase data are untouched.
Because Firebase's emulator gives `.env.local` precedence for non-secret
parameters, the runner installs an exclusively locked, journalled, non-secret
PAYG overlay there for the life of the process. It recovers an interrupted
prior overlay and restores the original file byte-for-byte when it stops,
provided no operator has edited the active overlay. Provider and abuse-control
secrets remain process-memory-only.
The frontend is available at `http://localhost:3002/pay-as-you-go`. The Stripe
CLI forwards the real test-mode webhook back to the local Function. Email
delivery stays disabled: fulfilment may create a local confirmation outbox row,
but the runner cannot send it to Resend. Firebase and child-process debug logs
are confined to a private temporary runtime directory and removed on shutdown.

After Stripe returns to the local success page, verify the exact Session,
PaymentIntent, one-time Product and Price, £7 total, seeded class and capacity
counts, webhook-created guest booking, approved legal receipt, zero Auth
accounts and disabled-email outbox. While Terminal 1 is still running, use
**Terminal 2**:

```bash
npm run verify:stripe-test-payg-journey --prefix functions -- \
  --session=cs_test_...
```

Only after the verifier passes should you return to Terminal 1 and press Ctrl-C
once to stop the whole stack. Provider credentials are redacted from output,
are never passed to the browser process and are not written by the runner.

The preflight retrieves every configured Price and expanded Product from Stripe
and checks test mode, active state, Product name, GBP amount and monthly
recurrence. It also verifies the test Portal keeps cancellation and subscription
updates disabled and the youth-family Coupon is exactly 15% off forever, has no
redemption deadline or cap, and applies to exactly the two youth Products
backing MINI ALPHAS - 10 & Under and TEEN ALPHAS - 11 & UP. It prints object IDs but makes no Stripe
changes.

Open `http://localhost:3002/memberships`, choose a plan and complete hosted
Checkout with a Stripe test card such as `4242 4242 4242 4242`, any future
expiry and any CVC/postcode. During the founding presale Stripe saves the test
payment method but charges **£0 today**. The subscription is scheduled for
service from 1 September and its first payment anchor is 1 September. The app
shows a prominent test-only notice and presents the same approved, versioned
legal documents used by the release.

The current frontend calls only `createMembershipCheckoutSessionV2` and sends
`checkoutSchemaVersion: 6`. MINI ALPHAS - 10 & Under costs £30 per child per month and is
designed for ages 10 and under; TEEN ALPHAS - 11 & UP costs £35 per child per month and is
designed for ages 11 and up. These age descriptions are non-blocking guidance:
checkout still requires a valid, non-future date of birth, but staff manage
programme placement internally. Use “Add another child” to register 1–10
children in the same selected programme.
One child pays the standard price. From two children, the family Coupon applies
15% off the whole monthly subtotal forever: two MINI ALPHAS - 10 & Under are £60 less £9 =
£51 per month, and two TEEN ALPHAS - 11 & UP are £70 less £10.50 = £59.50 per month. Hosted
Checkout should show one subscription item whose quantity equals the number of
children. A single subscription cannot mix the two selected programmes.

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

## Recorded partial browser evidence — 2 September 2026

The exact Conditioning test Session
`cs_test_a1keBmeAxXZAYTeeyxRhRsBvjNFFgtMW46K6sULUSzTnc2xjE9ONq0UnoD`
and Subscription `sub_1UB1yPFzNDZoGGA0w7j4zdXC` were read back as a paid,
active £30 `adult_conditioning` membership with limited app access and the
flexible two-class weekly allowance. That exact anonymous purchase was claimed
into a fresh emulator account. The browser accepted the current adult waiver,
kept only Schedule, Profile and Membership available, booked two eligible
classes in one Europe/London week, rejected a third without changing capacity,
cancelled one booking with quota and capacity restored, and booked a different
replacement. Its exact confirmation outbox remains pending; delivery has not
been claimed.

The current PAYG evidence binds one genuine £7 no-account test purchase to a
`payg_guest` booking and a successful full test-mode provider refund with
capacity released. It binds a separate genuine £7 payment to a test dispute,
cancelled booking, released capacity and suspended refund automation. The
refund and dispute use different provider and application records. Email
delivery remained disabled, so confirmation, refund and dispute delivery are
still outstanding.

The PII-free durable records are
`ops/release/evidence/conditioning-stripe-test-full-app-2026-09-02.json` and
`ops/release/evidence/payg-stripe-test-purchase-refund-dispute-2026-09-02.json`.
They are partial evidence only. Neither clears its end-to-end email gate or the
two-phase whole-class cancellation drill. No production write, deployment, or
purchase-gate change occurred.

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
- the canonical MINI ALPHAS - 10 & Under Price at £30 and TEEN ALPHAS - 11 & UP Price at £35, with
  non-blocking age guidance and the valid-date-of-birth requirement;
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
