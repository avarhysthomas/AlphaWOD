# Conditioning membership and Pay As You Go rollout

This runbook records the commercial and safety boundary for the two products
added on 30 August 2026. It is preparation, not deployment authorisation. The
checked-in production examples keep every new purchase gate closed, and neither
product may be opened until its dedicated legal copy and end-to-end evidence
have been approved.

## Frozen catalogue

| Offer | Stripe mode | Product | Price | Terms |
| --- | --- | --- | --- | --- |
| Adult Conditioning Only Membership | Live | `prod_VAOFQB36XfKixX` | `price_1UA3T0FzNDZoGGA0RJg5qEHe` | £30 GBP monthly |
| Adult Conditioning Only Membership | Test | `prod_VAOvaoryJOeb04` | `price_1UA47fFzNDZoGGA0lgyZPUZ9` | £30 GBP monthly |
| Adult Pay as You Go Class | Live | `prod_VAOGG2ZsBQ65Qt` | `price_1UA3TdFzNDZoGGA0dCgYfU2h` | £7.50 GBP one time |
| Adult Pay as You Go Class | Test | `prod_VAOxXxpax1MuRt` | `price_1UA49JFzNDZoGGA0ciTM2OOQ` | £7.50 GBP one time |

All four Products use tax code `txcd_50021001`, matching the existing adult
catalogue. Stripe tax treatment remains subject to the business owner's tax
review. The implementation verifies the exact mode, Product, Price, amount,
currency and recurring shape before accepting money.

## Commercial contract

### Adult Conditioning Only Membership

- The member chooses exactly two fixed weekly sessions from Monday 06:00,
  Tuesday 18:00, Thursday 18:00 and Friday 05:30.
- Those two choices are frozen on the checkout intent and entitlement.
- The member may book only matching scheduled classes while the entitlement is
  active. The server enforces this independently of the interface.
- App access is limited to Schedule, Profile and membership management. It does
  not include Dashboard/WOD, Training, Leaderboards, or the attendance tier and
  lifetime performance totals on Profile.
- It remains a membership subscription and follows the existing first-of-month
  billing, cancellation, webhook, recovery and account-claiming machinery.

### Adult Pay as You Go Class

- A guest may purchase any scheduled class unless staff explicitly mark that
  class ineligible. No AlphaWOD account is required.
- Checkout requires the adult attendee's full name and date of birth, plus an
  email address and mobile number. It also requires the approved waiver, terms
  and cancellation-policy acceptances.
- One successful £7.50 payment creates one guest booking for the selected class.
  It never creates a class credit, entitlement, transferable balance or
  rescheduling right.
- Cancellation at least 24 hours before the class is refundable. Cancellation
  inside 24 hours and non-attendance are non-refundable.
- Capacity is reserved by a short-lived hold while hosted Checkout is open, then
  converted to the same booking after payment so a place is not counted twice.

## Independent launch gates

The recurring membership path requires all of:

```text
MEMBERSHIP_PURCHASE_ENABLED=true
ADULT_CONDITIONING_PURCHASE_ENABLED=true
ADULT_CONDITIONING_LEGAL_APPROVED=true
REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=true
REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED=true
```

The one-time PAYG path requires both:

```text
PAYG_AVAILABILITY_ENABLED=true
PAYG_LEGAL_APPROVED=true
```

The PAYG legal-document versions, public URLs and SHA-256 digests must also be
real approved values. PAYG intentionally has no browser-side opening gate: the
public timetable can remain visible while the callable refuses to create a
purchase. Opening one product must not open the other.

**PAYG has one additional hard launch blocker in this branch.** Exact retention
and deletion semantics for guest order, booking, waiver and confirmation-email
PII have not been authorised by the owner/legal team. The code records the
versioned proposed policy and redaction deadlines, but deliberately does not
delete those records. `PAYG_PII_REDACTION_IMPLEMENTED=false` is enforced by the
runtime and production preflight, with no accepted `true` path. Do not set the
PAYG availability or legal gates true. A later reviewed change must implement
bounded, resumable redaction, preserve only approved evidence, cover active
email leases, and add emulator/rules/TTL evidence before that blocker can be
removed. Numeric retention days alone are not launch approval.

Secret Manager must contain distinct random 32+ byte values for:

- `PAYG_CANCELLATION_TOKEN_SECRET` (signed cancellation links),
- `PAYG_CHECKOUT_RATE_LIMIT_SECRET` (anonymous source admission), and
- `PAYG_DUPLICATE_LOCK_SECRET` (stable attendee/class duplicate protection).

Each token/lock domain has its own current key ID. During a reviewed rotation,
bind the matching `*_PREVIOUS_SECRET`, set a distinct `*_PREVIOUS_KEY_ID`, and
set `*_PREVIOUS_VALID_UNTIL` to an ISO-8601 horizon long enough to cover every
outstanding booking/link or duplicate-lock lifetime. New values sign/hash only
with the current key; previous values are verification/migration inputs. Never
reuse these secrets or place them in dotenv files or a client bundle.

## Required preflight evidence

Before either gate is opened:

1. Review and publish product-specific legal wording. The current membership
   bundle predates both offers and must not be treated as approval for them.
   Separately approve the PAYG PII retention/redaction policy and implement the
   hard-blocked redaction workflow described above; approval of terms or a
   number of retention days does not authorise deletion by itself.
2. Run the production configuration verifier and read-only Stripe live catalogue
   verifier against the exact environment that will be deployed. With gates
   closed, use `npm run verify:production-config --prefix functions`. Once the
   updated recurring documents are published and approved, Conditioning has an
   independent opening check:

   ```text
   npm run verify:production-open-conditioning-config --prefix functions
   npm run verify:frontend-conditioning-production-open
   ```

   A PAYG `--open-payg` preflight intentionally fails on the PII-redaction
   blocker in this branch.
3. Before PAYG is opened, expand the existing shared Stripe endpoint's event
   selection to include `refund.created`, `refund.updated`, and `refund.failed`;
   verify the endpoint still retains every existing membership event and its
   current signing secret. This document does not claim that live Dashboard
   change has already been made.
4. Deploy the access-aware Functions with gates closed, run the reviewed claims
   backfill so every existing entitled account has an explicit tier, verify a
   sample of staff/member claims, and only then deploy the stricter Firestore
   and Storage rules. Include the `reconcileMembershipBookings` scheduled
   worker so ended memberships release future class capacity in bounded,
   resumable pages. Deploy PAYG recovery/email workers before its schedule,
   checkout, status, cancellation-preview and cancellation callables; deploy
   the public interface last. Keep the relevant runtime gate closed throughout.
5. In Stripe test mode, prove a successful purchase, per-source admission
   limiting, duplicate attendee/class lock safety, abandoned Checkout PII
   scrubbing/expiry, webhook replay and capacity convergence.
6. For Conditioning, prove an exact two-slot checkout, allowed-slot booking,
   rejected third-slot booking, restricted app navigation and membership
   cancellation/claim flows.
7. For PAYG, prove full and nearly-full classes, concurrent holds, guest roster
   check-in, cancellation on both sides of exactly 24 hours, refund success and
   failure recovery, `refund.created`/`refund.updated`/`refund.failed` webhook
   convergence, no-show handling, dispute handling and confirmation-email retry.
8. Verify production alerts, Stripe webhook delivery, Resend authentication and
   the scheduled recovery/email workers with staffed notification routes.
9. Open only one product at a time, perform a reviewed low-risk smoke test, and
   retain its rollback owner and evidence before considering the second.

## Rollback boundary

If pricing, capacity, entitlement, legal evidence, confirmation delivery or
provider identity is uncertain, close only the affected product's purchase gate.
Do not disable the shared Stripe webhook or recovery workers: already-created
intents and payments still need to converge. Treat Stripe as authoritative,
preserve the Firestore ledgers/outboxes for audit, and do not manufacture a
booking, refund or membership by direct database editing.
