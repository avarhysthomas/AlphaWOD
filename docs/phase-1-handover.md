# Phase 1 Handover: Public Membership Purchase & Stripe Billing

Date: 2026-08-18

## 1) What’s done so far

Phase 0 security hardening is complete in the codebase. There is currently **no public stripe/checkout membership selection page yet**.

Relevant completed work to preserve:
- Server-owned auth/profile model in `functions/src/authz.ts`
- Firestore/Storage hardening in `firestore.rules`, `storage.rules`
- Compatibility lock files: `firestore.phase0-compat.rules`, `storage.phase0-compat.rules`, `firebase.phase0-compat.json`
- Frontend auth/route gates in `src/context/AuthContext.tsx` and related route protections
- New callable contracts now exist for non-sensitive bootstrap/waiver operations
  - `bootstrapUserProfile`
  - `acceptCurrentWaiver`
  - `listStaffUsers`
  - entitlement mutation callable(s) already present from Phase 0 (`setMemberEntitlement`)
- Migration and rollout evidence/docs: `functions/scripts/backfillClaims.js`, `docs/security/phase-0-rollout.md`

Important operational caveats from Phase 0: callable freeze and identity-admin freeze need to be honored during any additional rollout/deploy steps. If you are continuing now, follow the runbook order already documented.

## 2) Current business configuration (must be implemented in Phase 1)

The team has approved:

### Plans
- Commercial: no joining fee, no trial, rolling monthly
- Youth:
  - Youngstars: 4–11 inclusive
  - Teenstars: 12–16 inclusive
- Youngstars/Teenstars are separate options within one youth card/catalogue option

### Checkout/funnel rules
- Payment methods: Stripe dynamic methods
- Billing address: no
- Phone collection: no
- Payment capture model: one membership purchase per person when active membership is needed
- Guardian must be payer for youth: yes
- Adult payer must be participant: no

### Membership policy
- Cancellation notice: 2 weeks (user has approved this text/flow)
- No cooling-off exception was already approved in policy setup
- Cancel-at-period-end: no
- Refund policy: “Payments are non-refundable except where required by law”
- Pause allowed: no
- Past-due grace period: 3 days
- Full refund/dispute revokes access: no
- Dispute policy approved:
  - open dispute = suspend access
  - dispute won = restore access
  - dispute lost or payment fully refunded = revoke access

### Existing-member behavior
- Existing approved AlphaWOD users remain grandfathered: yes
- Existing account should log in and claim purchase: yes
- Block duplicate active subscriptions: yes
- Admins and SGPT staff retain access independently: yes
- `alphaWodAccess` independent admin/SGPT behavior should remain intact

### Legal/UX
- Non-adult post-purchase success message approved:
  - “Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.”
- Typed-name electronic signatures: yes
- Customer portal enabled: yes

### Company/legal identity
- Trading/business name: ZERO ALPHA FITNESS LTD
- Company number: 15978998
- Trading/contact address: Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE
- Support email: support@zeroalphafitness.co.uk
- Confirmation sender: hello@zeroalphafitness.co.uk

### Proration (explicit request)
- User can join mid-cycle (e.g. join on 8th), pay a prorated amount for remaining days in current month, then start regular monthly billing on 1st of following month.

## 3) Non-goals for this phase

- Rework core Phase 0 security/auth model
- Rebuild the waiver process
- Change existing admin route protections

Keep this constrained to public membership purchase + Stripe Billing + membership state integration.

## 4) Phase 1 implementation plan

### A. Product and pricing mapping (Stripe)
1. Use sandbox/production CSVs currently in Downloads:
   - `/Users/avarhysthomas/Downloads/prices.csv`
   - `/Users/avarhysthomas/Downloads/products.csv`
2. Normalize and confirm the exact mapping per public plan:
   - commercial
   - youth: youngstars
   - youth: teenstars
3. Store plan-to-price IDs in config/env (env vars or server config), never hardcode IDs in UI.
4. Confirm prices are tax-inclusive and VAT handling disabled as requested.

### B. Membership selection page
1. Create public page route, e.g. `/memberships`.
2. Show plan cards and age-based youth qualification guard:
   - if under 12, route to youngstars
   - 12+ youth route to teenstars
   - Adult route to commercial
3. Enforce “guardian pays” for youth before checkout creation.
4. Add post-checkout success path for non-adults with the approved message.

### C. Checkout/session creation (backend)
1. Add/extend callable (Cloud Function callable) for checkout session creation:
   - Inputs: authenticated user id, selected plan key, requested age, guardian details, maybe source tag
   - Validate auth + account state + policy eligibility + duplicate active-subscription block
2. Create Stripe Checkout Session for subscription or payment + subscription schedule strategy that supports the requested proration:
   - immediate prorata charge for remainder of month
   - transition to recurring cycle on next 1st
3. Return `sessionUrl` to UI and redirect.

### D. Proration model detail (recommendation)
Preferred minimal-risk approach:
1. Compute `trial_end` = first of next month
2. Add immediate one-time proration invoice item for remaining-days cost
3. Start recurring phase at first-of-month boundary

Alternatives are possible but ensure:
- user charged now for partial period
- first recurring charge aligns to 1st-of-month, not signup day

### E. Subscription lifecycle webhooks
1. Handle these events:
   - `checkout.session.completed`
   - `customer.subscription.created` / `updated` / `deleted`
   - `invoice.paid` / `payment_failed`
   - `customer.subscription.trial_will_end` (if using trial anchor approach)
2. On successful payment:
   - set user entitlement state to active/stripe and record source
   - store Stripe IDs and renewal metadata on user doc (server-owned)
3. On failed payment/cancel/dispute states:
   - apply restricted/disabled outcomes per policy
   - preserve audit logs for admin review

### F. Cancellation and user self-service
1. Implement cancellation endpoint/flow with 14-day effective notice semantics (exactly as approved), including edge behavior for mid-month cutovers.
2. Add Customer Portal links for payment method updates and subscription actions (as approved).
3. Enforce “cancel-at-period-end: no” behavior if that means immediate request handling vs delayed effective date per policy.

### G. Duplicate and entitlement safeguards
1. Before creating Checkout session or portal session, re-check current user entitlement and active subscriptions.
2. If active duplicate detected, block with approved messaging.
3. Continue using server-owned `users` profile fields only; do not trust client writes.

### H. Admin/operations controls
1. Add minimal admin UI to inspect active/past subscriptions and override entitlement if needed.
2. Keep claim/profile updates centralized through callable(s), aligned with existing authz checks.
3. Add admin view for disputed/failures if not already available.

## 5) Phase 1 acceptance criteria

- Public page exists and shows available plans
- User can complete checkout from each approved plan path
- Mid-cycle membership charges prorated correctly and switches to first-of-month recurring billing
- Refund/dispute and past-due behavior follows approved policy
- Cancellation respects 14-day notice and 2-week window handling
- Duplicate active memberships are blocked
- Youth rules enforce ages + guardian payer requirement
- Entitlement unlock/lock updates reliably from Stripe state changes
- Customer Portal available and works for authenticated members
- No auth-sensitive writes are client-trusted

## 6) Useful files to reference first

- Frontend: [src/context/AuthContext.tsx](/Users/avarhysthomas/Desktop/Zero Alpha Fitness/AlphaFIT/AlphaWOD/src/context/AuthContext.tsx)
- Functions auth/claims: [functions/src/authz.ts](/Users/avarhysthomas/Desktop/Zero Alpha Fitness/AlphaFIT/AlphaWOD/functions/src/authz.ts)
- Stripe/Callable layer: [functions/src/index.ts](/Users/avarhysthomas/Desktop/Zero Alpha Fitness/AlphaFIT/AlphaWOD/functions/src/index.ts)
- Rules: [firestore.rules](/Users/avarhysthomas/Desktop/Zero Alpha Fitness/AlphaFIT/AlphaWOD/firestore.rules)
- Migration runbook: [docs/security/phase-0-rollout.md](/Users/avarhysthomas/Desktop/Zero Alpha Fitness/AlphaFIT/AlphaWOD/docs/security/phase-0-rollout.md)

## 7) Notes for the next model

You can start Phase 1 assuming this is accepted business data and policy setup. Focus strictly on public purchase/checkout and entitlement effects.

If anything changes (for example, if legal wants the cancellation wording or proration model adjusted), keep policy text and Stripe configuration in one central constants file so both UI and backend share it.
