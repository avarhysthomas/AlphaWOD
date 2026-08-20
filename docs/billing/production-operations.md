# Production billing operations

This is a preparation runbook, not deployment authorisation. The checked-in
production examples keep both `MEMBERSHIP_PURCHASE_ENABLED=false` and
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`, the legal source gate remains
closed, and `ops/monitoring/billing-alerts.json` is deliberately a template. No
alert, notification channel, budget, Stripe object, Firebase resource or Vercel
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
These probes do not prove a signed delivery or payment journey. The legal and
purchase gates remain closed, and all membership callables and workers remain
undeployed.

## Release preflights

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
npm run verify:production-config --prefix functions
```

Run the frontend production build with the exact reviewed Vercel Production
environment. For Functions, create the project-specific, git-ignored deployment
parameter file once and fill only its non-secret values:

```sh
cp functions/.env.production.example functions/.env.alphawod-d1f2f
```

Firebase CLI 15.5.1 loads `.env.alphawod-d1f2f` for project
`alphawod-d1f2f`; it does not treat `.env.production` as that project's deploy
environment. `verify:production-config` reads the same file and requires the
exact production project, live Stripe mode, a bare HTTPS origin, exact approved
Price IDs, the Portal/Coupon/Promotion Code IDs, a real sender, no provider host
override and both purchase gates closed. It rejects every checked-in sandbox
Stripe object. Keep secrets in Secret Manager, not this file.

After an authorised operator has created the live Stripe catalogue, expose a
live restricted/read key to one process (not a file or shell history) and run:

```sh
npm run verify:stripe-live-config --prefix functions
```

That command is read-only. It requires the exact reviewed mapping frozen in
`functions/src/stripeLiveCatalog.ts`, retrieves every live Price and Product, the
product-scoped three-month Coupon, the one active shared Promotion Code and the
locked-down Customer Portal configuration. It exits before reporting success
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

The required policies are:

| Policy | Trigger | First response |
| --- | --- | --- |
| `billing-critical-runtime` | Any `CRITICAL_BILLING_*` log | Keep/close purchase, capture IDs, inspect Stripe authoritatively and assign an incident owner. |
| `billing-recovery-worker-errors` | Two worker errors in 15 minutes | Check Scheduler invocation, Function errors, leases and the due/dead-letter queues. |
| `billing-webhook-processing-errors` | Two handler errors in five minutes | Check Stripe endpoint health and event deliveries; rely on the recovery worker, not blind state edits. |
| `billing-checkout-provider-rejections` | Five provider rejections in five minutes | Close purchase if systemic; verify the live catalogue and billing anchor before retrying. |
| `billing-checkout-abuse-signals` | Ten rate-limit or consumed-token events in five minutes | Inspect App Check metrics and checkout velocity without logging source addresses; close purchase if the pattern is sustained or distributed. |

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
6. For orphan locks, duplicate sessions, customer conflicts, cancellation drift
   or entitlement-projection review, keep the record for audit and escalate to
   the billing owner. Direct Firestore edits are not a recovery procedure.
7. Close the incident only after Stripe, Firestore entitlement, email/outbox,
   webhook ledger and audit evidence agree, alerts have recovered, and a second
   reviewer signs off.

## Opening and rollback boundary

Monitoring, live-object verification and a deployed staging run are necessary
but not sufficient. Legal publication, the staffed cooling-off refund and
inbound-email cancellation operations, and every open launch blocker in
`phase-1-rollout.md` remain mandatory. Publish and deploy the approved document
registry and compatible frontend first while
`MEMBERSHIP_PURCHASE_ENABLED=false` and
`REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false`, then run:

```sh
npm run verify:published-legal
npm run verify:production-armed-config --prefix functions
```

Deploy the webhook, workers and callables in the rollout guide's closed-state
batches, re-block then deliberately restore only the reviewed callable services,
and complete the closed-state smoke tests. Only after every blocker and explicit
approval, set
`MEMBERSHIP_PURCHASE_ENABLED=true` in the git-ignored
`functions/.env.alphawod-d1f2f`, run the final configuration check and deploy
only the intake function:

```sh
npm run verify:production-open-config --prefix functions
firebase deploy --only functions:createMembershipCheckoutSession --project alphawod-d1f2f
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
firebase deploy --only functions:createMembershipCheckoutSession --project alphawod-d1f2f
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
Keep webhooks, scheduled recovery and confirmation delivery active for
purchases already in flight.
