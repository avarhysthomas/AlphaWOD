# Production billing operations

This is a preparation runbook, not deployment authorisation. The checked-in
production examples keep both `MEMBERSHIP_PURCHASE_ENABLED=false` and
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`. The business owner explicitly
approved the current mixed publication bundle: revised Membership Terms and
Guardian Addendum dated 27 August 2026, the Privacy Notice dated 25 August,
and the unchanged Cancellation Policy and Adult Waiver dated 23 August. Both source registries
must remain synchronized with their publication gate `true`.
The exact production bytes must still pass their checks in a closed Vercel
deployment, including `npm run verify:published-legal`, before either
environment gate can open.
`ops/monitoring/billing-alerts.json` is deliberately a template. No alert,
notification channel, budget, Stripe object, Firebase resource or Vercel
deployment is created by this repository change.

Verified live prerequisite state as of 20 August 2026: Coupon
`zaf_existing_member_5off_3mo_2026` and Promotion Code
`promo_1U6EsgFzNDZoGGA0DjPqkz08` (`ZALOYALTY`) are active, restricted through
the Adult Unlimited Product and have no automatic expiry; Portal configuration
`bpc_1U6SIkFzNDZoGGA0mSE5EepR` is locked down; and webhook endpoint
`we_1U6SObFzNDZoGGA0cw5Yyqth` is active with the exact 14-event allowlist.
Enabled Secret Manager versions exist for the Stripe API, webhook-signing and
checkout-rate-limit secrets. The public `stripeWebhook` receiver is active on
Node.js 24 in `europe-west1`; GET `405` and unsigned POST `400` probes passed.
These probes do not prove a signed delivery or payment journey. On 25 August,
the closed-gate rollout deployed all fourteen membership services and Firebase
reported every service `ACTIVE` on Node.js 24. Both selective Functions batches
succeeded with `MEMBERSHIP_PURCHASE_ENABLED=false` and
`STRIPE_YOUTH_FAMILY_COUPON_ID=zaf_youth_family_10pct_2026`. Post-deployment IAM
inspection preserved the reviewed boundaries: the webhook is public, scheduled
workers retain only their scheduler paths, legacy V1 checkout remains blocked,
and V2 plus the seven non-checkout callables have only the reviewed
service-level client transport. The Stripe event ledger was healthy. Five
existing family memberships remain frozen on their original 15% terms; no old
Checkout Session or Stripe event was in flight at cutover.

Vercel Production deployment `Hizg4XZi7Fhft77QPEvSrE5s9aLu` is `Ready`, owns
`alpha-wod.vercel.app`, and has made
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false` effective. Public DOM verification
showed “Not open yet” and “Online purchase closed”, with every purchase control
disabled. That deployment used the prior `main` SHA and therefore serves the old
legal bundle: it proves the customer-visible gate is closed, but it is not the
final youth release frontend or evidence for the new release's legal bytes. The
live youth Price/Product bindings were read back
successfully on 23 August 2026 under their former provider names. On 25 August,
the two existing live Products were deliberately renamed to
MINI ALPHAS - 10 & Under and TEEN ALPHAS - 11 & UP and read back through the
live API; their Product IDs, Price IDs and £30/£35 monthly prices were left
unchanged. Live Coupon
`zaf_youth_family_15pct_2026` was created and verified in Stripe Dashboard on
23 August as valid, 15% off forever, without an expiry, redemption cap or
Promotion Code, and restricted exactly to those two youth Products. It is the
current Coupon again from the 27 August release. The intervening Coupon
`zaf_youth_family_10pct_2026` was created and read-only API-verified on 25 August
as 10% off forever and restricted to the same two Products. A 27 August cutover
audit found it had never been redeemed, with no open Checkout Session or
in-flight membership intent. Both Coupons must be retained so frozen provider
contracts and recovery checks remain backward compatible.

The operational commercial contract for this release is:

| Plan | Age guidance | Per-child monthly price | Family offer |
| --- | --- | ---: | --- |
| MINI ALPHAS - 10 & Under | Designed for ages 10 and under | £30 | 15% off the whole subtotal forever at 2–10 children |
| TEEN ALPHAS - 11 & UP | Designed for ages 11 and up | £35 | 15% off the whole subtotal forever at 2–10 children |

Age guidance does not block checkout. Every child must still have a valid,
non-future date of birth, and staff manage programme placement internally. Each
checkout covers 1–10 children in the same selected programme; one subscription
cannot mix programmes. One child pays full price. Two MINI ALPHAS - 10 & Under recur at £51
and two TEEN ALPHAS - 11 & UP at £59.50.

## Release preflights

For the Conditioning/PAYG release, begin with the offline, mutation-free gate:

```sh
npm run verify:release-candidate
```

This keeps every purchase gate closed and validates the authoritative release
manifests at `ops/deployment/conditioning-payg-functions.json`,
`ops/stripe/billing-webhook-events.json` and
`ops/monitoring/billing-alerts.json`. A `BLOCKED_BY_OWNER` or
`BLOCKED_BY_OPERATIONS` result is a stop condition, not permission to deploy.
The older fourteen-service counts below are historical evidence for the prior
membership-only rollout; they are not the target manifest for Conditioning or
PAYG.

Whole-class cancellation is currently an ordered staff operation, not one
atomic product workflow. Before changing an occurrence to cancelled, stop new
bookings, release each affected member booking through the supported
authorised-absence action, identify every paid PAYG guest, and complete the
approved Stripe refund/reconciliation path. Verify quota release, class
capacity, confirmation suppression and the audit trail. Never cancel the
occurrence first or repair the result with direct Firestore edits. The release
candidate must remain
`BLOCKED_BY_OPERATIONS class-cancellation-quota-and-payg-refund-drill` until a
full drill is attached as durable evidence.

The saved production parameter file and live Stripe catalogue must also pass
their read-only closed-gate checks before any deployment. Record both under
`live-product-catalogue-and-closed-config-readback`; missing new variables,
sandbox objects, placeholders or a source-only assertion all leave that blocker
open.

The live Stripe unsuccessful-delivery backlog must also be empty. Record every
readback under `live-stripe-delivery-backlog-cleared`; an exact webhook event
allowlist does not close this separate delivery-health gate. The 1 September
2026 readback from 25 August onward found one pending `invoice.paid` event that
the application ledger had dead-lettered after repeated incompatible
first-payment validation. Keep the release blocked until compatible reviewed
code is deployed to both `stripeWebhook` and `reconcilePastDueMemberships`, the
scheduled reconciliation records the exact paid Invoice and the deterministic
`legacy_presale_discount_recovered` audit, and the authoritative membership is
verified. The terminal event ledger remains an immutable `dead_letter` history;
do not relabel or delete it. Only after that reconciliation may Stripe redeliver
the known event and receive the reviewed manual-review acknowledgement. Repeat
the unsuccessful-delivery query against the exact live account from 25 August
through the readback completion time, exhaust every result page, and require
zero events. Clearance evidence must bind the deployed function revisions and
current compatibility-source SHA-256 to the exact event, Invoice, hashed
Subscription identity, recovery audit and ordered timestamps. Never acknowledge
the provider event merely to make the query empty.

Run these from a reviewed release commit:

```sh
npm ci
npm run lint
npm run test:ci
npm run test:infrastructure
npm run verify:monitoring
npm run build:production
npm run verify:frontend-production-closed

npm ci --prefix functions
npm run lint --prefix functions
npm test --prefix functions
npm run verify:production-armed-config --prefix functions
```

Run the frontend production build with the exact reviewed Vercel Production
environment. For Functions, create the project-specific, git-ignored deployment
parameter file once and fill only its non-secret values:

```sh
cp functions/.env.production.example functions/.env.alphawod-d1f2f
```

Firebase CLI 15.5.1 loads `.env.alphawod-d1f2f` for project
`alphawod-d1f2f`; it does not treat `.env.production` as that project's deploy
environment. `verify:production-armed-config` reads the same file and requires
the exact production project, live Stripe mode, a bare HTTPS origin, exact
reviewed Price IDs, the Portal/Coupon/Promotion Code IDs, a real sender, no
provider host override, the revised document source gate `true`, and the
backend runtime purchase gate `false`. It rejects every checked-in sandbox
Stripe object. Keep secrets in Secret Manager, not this file.

The PAYG redaction implementation marker is `true` in the reviewed example,
while `PAYG_AVAILABILITY_ENABLED`, `PAYG_LEGAL_APPROVED` and
`PAYG_PII_RETENTION_APPROVED` remain `false`. This is deliberate: implemented
cleanup is not authority to sell. The hourly `redactPaygPii` worker handles at
most 50 due rows and scans at most 50 discovery rows in each PAYG PII collection
per run. A durable, server-only document-ID cursor and short transaction lease
make that discovery bounded, resumable and safe under overlapping invocations;
the cursor wraps after every full pass so a legacy, malformed or manually
changed row that lacks its query marker is eventually rediscovered. Each valid
row freezes the immutable retention boundary in `piiRetentionCutoffAt`; the
worker queries the independently mutable `piiRedactionRetryAt`, and a failure
moves only that retry schedule. Discovery never reconstructs a missing boundary
from timestamps or legacy fields: missing or malformed cutoff evidence fails
closed into immediate redaction, while a valid future cutoff seeds the retry
marker at that exact boundary. No checkout recovery or email path treats a retry
time as permission to use PII. An outbox retry is deferred only until a
verifiable active ten-minute delivery lease that began before its valid cutoff
ends, without changing its retention boundary. Monitor PAYG privacy-redaction
and discovery-failure signals. Before relying on the worker, apply the reviewed
Firestore indexes configuration that removes the old
`paygIntents.piiDeleteAt` whole-document TTL; the redacted provider/audit record
must remain.

A delayed paid webhook or recovery may promote retained intent evidence into a
paid order only when an authoritative, exactly bound card Charge proves that
successful payment completed strictly before the immutable intent cutoff, and
only while the destination order's class-end-plus-90-day PII boundary is still
strictly in the future. Any non-null scrub marker is authoritative closure even
if malformed or followed by a stale/manual reintroduction of identity fields.
The final Firestore transaction rechecks the marker, immutable boundaries and
current PII so a concurrent redaction cannot be undone. Missing, malformed,
closed, reintroduced or late evidence routes the payment to the no-PII
review/refund path; it must not create an order, waiver, confirmation payload or
guest roster name from stale intent data.

After an authorised operator has created the live Stripe catalogue, expose a
live restricted/read key to one process (not a file or shell history) and run:

```sh
npm run verify:stripe-live-config --prefix functions
```

That command is read-only. It requires the exact reviewed mapping frozen in
`functions/src/stripeLiveCatalog.ts`, retrieves every live Price and Product, the
MINI ALPHAS - 10 & Under Price at £30 and TEEN ALPHAS - 11 & UP Price at £35, the
product-scoped three-month Coupon, the one active shared Promotion Code and the
locked-down Customer Portal configuration. It also retrieves the youth-family
Coupon and requires exactly 15% off forever, no amount/currency, redemption
deadline or cap, and an `applies_to` set containing exactly the two youth
Products named MINI ALPHAS - 10 & Under and TEEN ALPHAS - 11 & UP. Finally it
retrieves the reviewed live webhook endpoint and requires the exact 18 events
in `ops/stripe/billing-webhook-events.json`, including all PAYG refund and
dispute convergence events. It exits
before reporting success
if any object is inactive, in test mode, has the wrong commercial terms or
enables subscription changes. Both campaign objects must have no automatic
expiry; the application cutoff remains fixed and staff deactivate the exact
Promotion Code when the campaign is finished. The purchase gates must still be
closed.

Vercel uses `npm run build:production`. That build refuses placeholders,
emulator flags, the local membership test journey, the wrong Firebase boundary,
and any Vercel Preview wired to production Firebase. Configure the variables in
`.env.production.example` only for Vercel's Production environment. A Preview
build is accepted only when it has its own complete non-production Firebase web
configuration and both local/test switches remain closed.

The repository does not contain the Vercel project link or control its external
Production-branch and environment settings. Before any production deployment,
record and independently verify the connected project, Production branch,
canonical domain, complete Production variables and commit SHA being deployed.
Treat any unknown binding as a blocker. The staging publication uses
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`; use
`npm run verify:frontend-production-closed` in that exact environment before the
deployment.

Before deploying checkout, register the production web app with Firebase App
Check using a reCAPTCHA Enterprise key restricted to the production domain.
Set `MEMBERSHIP_CHECKOUT_APP_ID` to that exact Firebase web app ID. An enabled
`MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET` version exists; verify the deployed
checkout identity can access it without reading or logging its value.
Grant the deployed checkout service account the Firebase App Check token
verifier role. Do not register localhost on the production key; local emulator
testing bypasses enforcement.

Deploy the reviewed Firestore indexes/field overrides before checkout. They
enable TTL cleanup for the pseudonymous checkout admission and fixed-window
rate-limit records. TTL deletion is asynchronous and is used only for data
minimisation; deterministic window IDs enforce limits even before cleanup.

## Alerts that must exist before purchase opens

`ops/monitoring/billing-alerts.json` is the reviewed source of alert intent and
Cloud Logging filters. `npm run verify:monitoring` fails when a new
`CRITICAL_BILLING_*` marker is added without monitoring coverage. An operator
must still create real log-based alerts in project `alphawod-d1f2f`, attach at
least two staffed notification routes, and fire a synthetic matching log to
prove delivery.

A staffed notification route is a real notification channel watched by a named
responder whenever purchase is enabled, with a named backup or escalation path
if the first responder cannot act. Use at least two independent routes for each
policy so one delivery failure does not make the alert silent. The repository
does not prescribe a provider, address or individual: operators must record the
chosen channels and coverage roster in the release evidence without committing
personal contact details here.

The dedicated `billing-payment-failed` policy uses the externally configured
`business-owner-email` route so the business owner receives each missed-payment
signal. Its recipient address remains in Google Cloud rather than source code.
This single email route does not satisfy the separate two-route resilience
requirement for the complete billing alert set.

The required policies are:

| Policy | Trigger | First response |
| --- | --- | --- |
| `billing-critical-runtime` | Any `CRITICAL_BILLING_*` log | Keep/close purchase, capture IDs, inspect Stripe authoritatively and assign an incident owner. |
| `billing-payment-failed` | One `BILLING_PAYMENT_FAILED` warning | Open the referenced Invoice in Stripe, confirm the current payment and Subscription state, and follow the failed-payment grace procedure. |
| `billing-recovery-worker-errors` | Two worker errors in 15 minutes | Check Scheduler invocation, Function errors, leases and the due/dead-letter queues. |
| `billing-webhook-processing-errors` | Two handler errors in five minutes | Check Stripe endpoint health and event deliveries; rely on the recovery worker, not blind state edits. |
| `billing-checkout-provider-rejections` | Five provider rejections in five minutes | Close purchase if systemic; verify the live catalogue and billing anchor before retrying. |
| `billing-checkout-abuse-signals` | Ten rate-limit or consumed-token events in five minutes | Inspect App Check metrics and checkout velocity without logging source addresses; close purchase if the pattern is sustained or distributed. |
| `payg-recovery-errors` | Two PAYG recovery, refund, privacy or attendance-convergence errors in 15 minutes | Inspect the affected intent/order warning, worker lease, due state and Stripe source; assign an incident owner and use only the reviewed recovery path. |
| `payg-confirmation-delivery-errors` | Two PAYG confirmation-delivery or provider-acceptance persistence errors in 15 minutes | Preserve the frozen outbox and idempotency evidence; check Resend and retry through the scheduled worker only after correcting the cause. |
| `payg-provider-preflight-and-checkout-errors` | One PAYG catalogue-preflight or Stripe Checkout-creation error in five minutes | Keep or close PAYG purchase and verify the live Product, Price, mode and immutable provider contract before retrying. |

Also configure outside Cloud Logging:

- Cloud Billing budgets with owner notifications at conservative thresholds;
- Stripe webhook endpoint-health and payment/dispute notifications;
- a reviewed baseline and alert for abnormal Checkout Session creation volume;
- Resend domain/authentication and delivery-health notifications;
- uptime checks for the membership page and authenticated management route.

Do not open purchase while any policy has no staffed notification channel or
while a scheduled worker is unhealthy.

## Incident and dead-letter handling

1. If money, duplicate sales, wrong pricing, mode mismatch or contract drift is
   plausible, set/keep the runtime purchase gate false using the selective
   deployment sequence in `phase-1-rollout.md`. Do not disable the webhook or
   recovery workers; they are needed to converge already-created purchases.
2. Record the first observed time, affected membership/intent/event IDs and the
   Stripe Dashboard object URLs. Never paste payment data or secrets into logs
   or tickets.
3. Treat Stripe as authoritative. Retrieve the current Subscription, Checkout
   Session and Event before changing application state.
4. For `CRITICAL_BILLING_STRIPE_EVENT_DEAD_LETTER`, inspect the ledger attempt
   and last error, retrieve the original event in Stripe, correct the cause,
   then use only a reviewed recovery path. Do not delete the ledger or replay a
   webhook blindly.
5. For confirmation `manual_review` or Resend configuration alerts, preserve
   the frozen outbox/idempotency key and contractual evidence. Correct delivery
   configuration before an audited retry; do not compose a replacement message
   from mutable current plan data.
6. For checkout-recovery email `manual_review`, first confirm the intent has the
   staff-release marker, the exact Checkout Session is expired and unpaid, and
   the projected outbox/recipient hash agrees. A missing recipient is not a
   failed release: contact the customer out of band only if staff already hold a
   lawful address. Never paste an address into the outbox or reuse an expired
   Checkout URL.
7. For `PAYG intent privacy state requires manual review`, use the logged intent
   ID to inspect the durable `piiRedactionOperationalWarning`; confirm the five
   approved intent PII fields are absent before resolving the operational state.
   For `PAYG order booking privacy binding requires manual review`, inspect the
   durable `piiRedactionBookingWarning`, the order's `bookingId`, and the linked
   booking. Never delete a booking name unless `bookingKind=payg_guest` and
   `paygOrderId` exactly matches the order. If the booking is unrelated, preserve
   it and document the bad order binding; if it is a PAYG guest, use a reviewed,
   audited server-side repair to remove `userName`. Keep the alert open until a
   second reviewer confirms no overdue PAYG booking PII remains.
8. For orphan locks, duplicate sessions, customer conflicts, cancellation drift
   or entitlement-projection review, keep the record for audit and escalate to
   the billing owner. Direct Firestore edits are not a recovery procedure.
9. Close the incident only after Stripe, Firestore entitlement, email/outbox,
   webhook ledger and audit evidence agree, alerts have recovered, and a second
   reviewer signs off.

## Staff recovery for an interrupted Checkout

Use Admin → Memberships → Interrupted checkouts only after the customer is no
longer using the original Checkout page and the ten-minute guard has elapsed.
The action re-reads Stripe before changing anything. If Stripe reports a
completed, paid or uncertain Session, stop: the reservation stays locked and no
email is queued.

For a verified unpaid release, check the result banner:

- `queued`: the frozen restart email is awaiting or retrying through the
  scheduled worker; this does not claim delivery;
- `already_queued`: the durable row was queued by an earlier invocation; this
  deliberately makes no claim about its current delivery state;
- `manual_review`: the place was released, but either no Stripe-verified email
  address was available or the frozen delivery evidence could not be created
  safely, so no send will be attempted;
- `not_applicable`: the attempt was already terminal without this staff recovery
  email workflow, and must not be emailed retroactively.

The email worker may be retried only through its reviewed outbox path. Never
send the expired Session URL manually, create a fake membership, or rebuild the
message from current mutable plan data.

For a recovery-email rollout, deploy and verify the scheduled
`retryMembershipConfirmations` worker first, then deploy and verify
`listMemberships`, and only then deploy and verify
`releaseAbandonedMembershipCheckout`; publish the admin frontend last. Never
reverse or combine the worker and release steps, because an older worker can
quarantine the new outbox kind before the next five-minute run. The list
revision must already expose an interrupted release as retryable. If the release
callable stops after its durable claim or an expiry webhook wins the race, rerun
the same admin action: it resumes the claimed operation and preserves the one
frozen outbox/audit identity.

## Opening and rollback boundary

Monitoring, live-object verification and a deployed staging run are necessary
but not sufficient. Production deployed-byte verification for the revised
legal bundle, a fresh read-only pre-opening revalidation of the corrected youth
Prices and family Coupon, the staffed cooling-off refund and inbound-email
cancellation operations, and every open launch blocker in
`phase-1-rollout.md` remain mandatory. Deploy the final release's revised
document registry and compatible frontend while
`MEMBERSHIP_PURCHASE_ENABLED=false` and
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`, then run:

```sh
npm run verify:published-legal
npm run verify:production-armed-config --prefix functions
npm run verify:stripe-live-config --prefix functions
```

The earlier membership-only closed-state Functions deployment completed: the webhook, four workers
and nine callables, including both checkout exports, are active on Node.js 24.
The nine callables were re-blocked after creation, then only
`createMembershipCheckoutSessionV2` and the seven non-checkout callables regained
the reviewed service-level transport; legacy
`createMembershipCheckoutSession` remains blocked. Preserve those IAM boundaries
on every future selective redeployment.
The compatible frontend calls V2 with `checkoutSchemaVersion: 6`, so a frontend
deployed before V2 fails safely and a cached V1 client cannot cross the new
schema boundary. Complete the closed-state smoke tests: V2 must reach its handler
and fail at the runtime gate without creating a Stripe Session. Only after every
remaining blocker passes and an authorised operator approves the release, set
`MEMBERSHIP_PURCHASE_ENABLED=true` in the git-ignored
`functions/.env.alphawod-d1f2f`, run the final configuration check and deploy
only the V2 intake function:

```sh
npm run verify:production-open-config --prefix functions
firebase deploy --only functions:createMembershipCheckoutSessionV2 --project alphawod-d1f2f
```

Editing the dotenv file alone changes nothing. Firebase applies the parameter
only when the function is redeployed. Verify the backend opening before exposing
the public purchase controls. Then set
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=true` in the confirmed Vercel Production
environment, run the open-frontend check there and deploy the same reviewed
commit through the confirmed Production workflow:

```sh
npm run verify:frontend-production-open
```

Record the resulting production deployment and smoke-test the public catalogue,
checkout transport and one deliberately controlled live purchase. Changing a
Vercel environment variable without a new production deployment does not change
the already-built frontend.

To rollback, close the backend first: set `MEMBERSHIP_PURCHASE_ENABLED=false`,
verify the armed state and redeploy that same intake function:

```sh
npm run verify:production-armed-config --prefix functions
firebase deploy --only functions:createMembershipCheckoutSessionV2 --project alphawod-d1f2f
```

Confirm that new checkout intake now fails closed. Then set
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false` in Vercel Production, run the
closed-frontend check and redeploy the same reviewed commit so the public UI also
closes:

```sh
npm run verify:frontend-production-closed
```

If discount abuse is in scope, deactivate the shared live Promotion Code too.
At the planned campaign end, deactivate that exact Code manually even if no
abuse occurred. Do not delete the Coupon while an already-created Checkout or
delayed webhook may still require its immutable terms for validation.
The youth-family offer is automatic and forever, not a shareable campaign code.
If its pricing or application is suspect, close V2 intake; do not deactivate or
delete its Coupon while active subscriptions or delayed events still depend on
those immutable terms.
Keep webhooks, scheduled recovery and confirmation delivery active for
purchases already in flight.
