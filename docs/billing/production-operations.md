# Production billing operations

This is a preparation runbook, not deployment authorisation. The checked-in
production examples keep `MEMBERSHIP_PURCHASE_ENABLED=false`, the legal source
gate remains closed, and `ops/monitoring/billing-alerts.json` is deliberately a
template. No alert, notification channel, budget, Stripe object, Firebase
resource or Vercel deployment is created by this repository change.

## Release preflights

Run these from a reviewed release commit:

```sh
npm ci
npm run lint
npm run test:ci
npm run test:infrastructure
npm run verify:monitoring
npm run build

npm ci --prefix functions
npm run lint --prefix functions
npm test --prefix functions
npm run verify:production-config --prefix functions
```

`verify:production-config` reads `functions/.env.production` when it exists. It
requires the exact production Firebase project, live Stripe mode, a bare HTTPS
origin, distinct non-placeholder Price IDs, the Portal/Coupon/Promotion Code
IDs, a real sender, no provider host override and both purchase gates closed.
It rejects every checked-in sandbox Stripe object. Keep the populated file out
of Git and prefer the deployed Functions environment/secret store.

After an authorised operator has created the live Stripe catalogue, expose a
live restricted/read key to one process (not a file or shell history) and run:

```sh
npm run verify:stripe-live-config --prefix functions
```

That command is read-only. It retrieves every live Price and Product, the
product-scoped three-month Coupon, the one active shared Promotion Code and the
locked-down Customer Portal configuration. It exits before reporting success
if any object is inactive, in test mode, has the wrong commercial terms or
enables subscription changes. The purchase gates must still be closed.

Vercel uses `npm run build:production`. That build refuses placeholders,
emulator flags, the local membership test journey, the wrong Firebase project,
and any Vercel Preview wired to production Firebase. Configure the variables in
`.env.production.example` only for Vercel's Production environment. Configure a
separate Firebase project before enabling preview deployments.

Before deploying checkout, register the production web app with Firebase App
Check using a reCAPTCHA Enterprise key restricted to the production domain.
Set `MEMBERSHIP_CHECKOUT_APP_ID` to that exact Firebase web app ID and create a
32-byte-or-longer `MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET` in Secret Manager.
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
`phase-1-rollout.md` remain mandatory. Open the source document gate and runtime
purchase gate only in the final ordered rollout after explicit approval.

Rollback means closing the runtime purchase gate and, if discount abuse is in
scope, deactivating the shared live Promotion Code. Keep webhooks, scheduled
recovery and confirmation delivery active for purchases already in flight.
