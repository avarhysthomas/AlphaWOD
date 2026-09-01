# Conditioning membership and Pay As You Go rollout

This runbook records the commercial and safety boundary for the two products
added on 30 August 2026. It is preparation, not deployment authorisation. The
checked-in production examples keep every new purchase gate closed, and neither
product may be opened until its dedicated legal copy has been deployed and
verified and its end-to-end evidence is complete. On 1 September 2026 the
business owner approved the exact frozen Conditioning and PAYG terms review
set. Separate immutable final IDs preserve that approval without changing or
reusing any draft ID. Purchase remains closed.

## Frozen catalogue

| Offer | Stripe mode | Product | Price | Terms |
| --- | --- | --- | --- | --- |
| Adult Conditioning Only Membership | Live | `prod_VAOFQB36XfKixX` | `price_1UA3T0FzNDZoGGA0RJg5qEHe` | £30 GBP monthly |
| Adult Conditioning Only Membership | Test | `prod_VAOvaoryJOeb04` | `price_1UA47fFzNDZoGGA0lgyZPUZ9` | £30 GBP monthly |
| Adult Pay as You Go Class | Live | `prod_VAOGG2ZsBQ65Qt` | `price_1UAmoCFzNDZoGGA0lKDwjbBU` | £7 GBP one time |
| Adult Pay as You Go Class | Test | `prod_VAOxXxpax1MuRt` | `price_1UAmVVFzNDZoGGA04z8hX10N` | £7 GBP one time |

The superseded live £7.50 Price `price_1UA3TdFzNDZoGGA0dCgYfU2h` is archived.
The £7 Price above is the Product's live default and was read back before its
identifier was frozen in the catalogue and production configuration example.

All four Products use tax code `txcd_50021001`, matching the existing adult
catalogue. Stripe tax treatment remains subject to the business owner's tax
review. The implementation verifies the exact mode, Product, Price, amount,
currency and recurring shape before accepting money.

## Commercial contract

### Adult Conditioning Only Membership

- The member may book any two eligible Conditioning classes in each
  Europe/London Monday-to-Sunday week while the entitlement is active. The
  eligible timetable is Monday 06:00, Tuesday 18:00, Thursday 18:00 and Friday
  05:30 in Europe/London.
- Choices are made from the live schedule and may change from week to week;
  checkout does not freeze recurring class slots on the intent or entitlement.
- Each booking consumes one place from the allowance for the London-local week
  containing that class start. Cancelling the booking releases that place back
  to the same week's allowance so the member may choose another eligible class.
- Class eligibility, week boundaries, booking state and the two-class quota are
  enforced by the server independently of the interface.
- App access is limited to Schedule, Profile and membership management. It does
  not include Dashboard/WOD, Training, Leaderboards, or the attendance tier and
  lifetime performance totals on Profile.
- It remains a membership subscription and follows the existing first-of-month
  billing, cancellation, webhook, recovery and account-claiming machinery.

### Adult Pay as You Go Class

- A guest may purchase any scheduled class unless staff explicitly mark that
  class ineligible. No AlphaWOD account is required.
- Checkout requires the adult attendee's full name, date of birth and email
  address. A mobile number is optional and, when supplied, is used only for
  urgent contact about that class. The approved PAYG Privacy Notice is linked
  before these fields and its presented version is recorded without a consent
  checkbox. Checkout separately requires the approved waiver, terms and
  cancellation-policy acceptances.
- One successful £7 payment creates one guest booking for the selected class.
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

The PAYG waiver, terms and Privacy Notice versions, public URLs and SHA-256
digests must also be real approved values. Missing or stale Privacy Notice
evidence fails closed. PAYG intentionally has no browser-side opening gate:
the public timetable can remain visible while the callable refuses to create a
purchase. Opening one product must not open the other.

PAYG PII redaction is implemented behind the still-closed purchase and legal
gates. The owner-approved engineering schedule removes the five named Checkout
intent fields after 30 days, order/contact/acceptance, confirmation payload and
guest-booking name fields 90 days after class end, and waiver identity fields
2,190 days after class end. The hourly `redactPaygPii` worker processes at most
50 due records and scans at most 50 discovery records per collection per run. A
durable server-only cursor and short transaction lease make discovery bounded
and resumable, and the cursor wraps after each pass so markerless legacy or
malformed PII is not permanently invisible to Firestore's due-field query.
Every valid row freezes its legal/privacy boundary in
`piiRetentionCutoffAt`; cleanup uses a separate `piiRedactionRetryAt` marker,
and a failure can move only that retry schedule. Discovery never invents a
cutoff from a legacy timestamp: a missing or malformed immutable cutoff fails
closed into immediate redaction, while a valid future cutoff seeds the retry
marker at that exact boundary. The worker removes the retry marker only after a
successful transaction, defers confirmation-outbox redaction only for a
verifiable active lease that began before a valid cutoff and expires no more
than ten minutes after it began, and keeps provider, financial, class, legal
digest and refund/dispute audit evidence. Delayed fulfillment may promote
still-current intent evidence only when an exactly bound Stripe paid-Checkout
event proves successful payment strictly before the immutable intent cutoff,
the destination order's class-end-plus-90-day PII boundary is still strictly
in the future, and the final transaction still finds that evidence intact. Any
non-null scrub marker is authoritative closure even if malformed or followed
by a stale/manual
reintroduction of identity fields. Missing, malformed, closed, reintroduced or
late timing evidence enters the no-PII payment-review/refund path rather than
creating fresh order, waiver, email or roster PII. For an exact Checkout
Session and PaymentIntent binding, the first durable payment review or
canonical order remains authoritative across delayed events and recovery, so
the other path cannot create a second service record or refund owner.
Whole-document TTL for `paygIntents` is removed;
the non-PII audit record remains. `PAYG_PII_REDACTION_IMPLEMENTED=true` records
that tested code state, but it is not legal approval and does not open PAYG.
Keep `PAYG_AVAILABILITY_ENABLED`, `PAYG_LEGAL_APPROVED` and
`PAYG_PII_RETENTION_APPROVED` false until the final legal decision and evidence
in `ops/release/conditioning-payg-readiness.json` are complete.

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

The exact source review set remains frozen in
`public/legal/product-drafts/manifest.json`. It contains the Conditioning
product addendum, PAYG terms, PAYG adult waiver, PAYG privacy/retention decision
record, their byte counts and SHA-256 digests, and the review-time owner
decisions. Verify that the review bytes are intact and no runtime references a
draft with:

```text
npm run verify:product-legal-drafts
```

That command must continue to report the historical draft bytes as unapproved
and runtime-ineligible; later approval evidence never rewrites a draft. The
approved final candidates and their source-draft lineage are recorded in
`public/legal/products/manifest.json` and verified with:

```text
npm run verify:approved-product-legal
```

The Adult Conditioning addendum is bound into the immutable membership
checkout/confirmation registry. The approved PAYG terms and waiver have final
same-origin URLs and digests in the closed production configuration. PAYG
remains runtime-ineligible until an approved customer-facing PAYG Privacy
Notice exists and the complete final bundle is deployed and read back
byte-for-byte. Legal approval does not itself open a purchase gate.

Run the offline release-candidate gate first:

```text
npm run verify:release-candidate
```

It is deliberately read-only: it makes no Firebase, Stripe, Vercel or email
API calls and cannot deploy. It verifies the checked-in monitoring, webhook and
selective-Functions manifests, current schema references and closed production
gates. Exit code `2` means the engineering files agree but one or more explicit
owner decisions or external operational proofs in
`ops/release/conditioning-payg-readiness.json` are still pending. Do not replace
evidence with an unsupported `true` value.

Before either gate is opened:

The Stripe test catalogue can be checked without opening Checkout or creating
any provider object. `npm run stripe:test:conditioning-preflight` reads only
the recurring Conditioning entry; `npm run stripe:test:payg-preflight` reads
only the one-time PAYG entry. Both skip the unrelated promotion offers, while
the default full-catalogue preflight remains the release-wide drift check.

1. Publish and verify the approved product-specific legal wording. The owner
   approval is recorded in
   `ops/release/evidence/product-terms-owner-approval-2026-09-01.json`. The
   Conditioning addendum and PAYG terms/waiver have separate final IDs, but the
   PAYG customer-facing Privacy Notice is still awaiting approved final bytes.
   Deploy the completed bundle with purchase closed, read every immutable URL
   back byte-for-byte, then attach durable publication evidence. Approval of
   product terms does not by itself set any runtime gate.
2. Run the production configuration verifier and read-only Stripe live catalogue
   verifier against the exact environment that will be deployed. With gates
   closed, use `npm run verify:production-config --prefix functions`. Once the
   updated recurring documents are published and approved, Conditioning has an
   independent opening check:

   ```text
   npm run verify:production-open-conditioning-config --prefix functions
   npm run verify:frontend-conditioning-production-open
   ```

   A PAYG `--open-payg` preflight succeeds only when the exact 90/2,190-day
   values, an immutable policy version and both legal/privacy approvals are
   present. Do not run it as authority to open the current closed environment.
   Attach the successful closed configuration and live Product/Price readback
   to `live-product-catalogue-and-closed-config-readback`; a passing source or
   sandbox check is not equivalent evidence.
3. Before PAYG is opened, update the existing shared Stripe endpoint to the
   exact 18-event allowlist in `ops/stripe/billing-webhook-events.json`. That
   manifest retains every membership event and adds `refund.created`,
   `refund.updated`, `refund.failed`, and `charge.dispute.updated` alongside
   dispute create/close events. Read the live endpoint back and attach durable
   evidence to the readiness manifest; a checked-in template does not prove the
   Stripe Dashboard was changed or that the existing signing secret still
   verifies deliveries.
4. Verify the complete selective deployment plan with
   `npm run verify:deployment-manifest`. The authoritative target list is
   `ops/deployment/conditioning-payg-functions.json`; it contains every shared
   billing worker, PAYG Function, and modified booking/access Function in
   batches of ten or fewer. Deploy the access-aware Functions only under a
   separately authorised maintenance change with gates closed, run the reviewed claims
   backfill so every existing entitled account has an explicit tier, verify a
   sample of staff/member claims, and only then deploy the stricter Firestore
   and Storage rules. Include the `reconcileMembershipBookings` scheduled
   worker so ended memberships release future class capacity in bounded,
   resumable pages. Deploy PAYG recovery/email workers before its schedule,
   checkout, status, cancellation-preview and cancellation callables. Include
   `redactPaygPii`, and apply the reviewed `firestore.indexes.json` change that
   removes the obsolete `paygIntents.piiDeleteAt` whole-document TTL before the
   worker is relied upon. Deploy the public interface last. Keep the relevant
   runtime gate closed throughout.
5. In Stripe test mode, prove a successful purchase, per-source admission
   limiting, duplicate attendee/class lock safety, abandoned Checkout PII
   redaction, 90-day order/outbox/booking redaction, 2,190-day waiver redaction,
   active email-lease deferral, markerless legacy discovery with cursor wrap,
   immutable-cutoff failure retry, late-payment no-PII review, webhook replay
   and capacity convergence.
6. For Conditioning, prove checkout without fixed-slot selection; any two
   eligible bookings in one Europe/London Monday-to-Sunday week; rejection of a
   third concurrent booking in that week; cancellation restoring one place;
   different class choices in the following week; restricted app navigation;
   and membership cancellation/claim flows. Before cancelling a whole class
   occurrence, stop new bookings and mark each affected member booking as an
   authorised absence through the supported staff action, then verify both the
   class capacity and that week's Conditioning allowance were released. Do not
   mark the occurrence cancelled first and do not repair quota rows with direct
   Firestore edits.
7. For PAYG, prove full and nearly-full classes, concurrent holds, guest roster
   check-in, cancellation on both sides of exactly 24 hours, refund success and
   failure recovery, `refund.created`/`refund.updated`/`refund.failed` webhook
   convergence, no-show handling, dispute handling and confirmation-email retry.
   The class-cancellation drill must also identify every paid guest before the
   occurrence is closed, run the approved provider refund/reconciliation path,
   verify released capacity and suppressed customer confirmations, and retain an
   audit record. Keep `class-cancellation-quota-and-payg-refund-drill` false in
   the readiness manifest until that entire ordered procedure has durable
   evidence.
8. Verify production alerts against `ops/monitoring/billing-alerts.json`, Stripe
   webhook delivery against the exact event manifest, Resend authentication and
   the scheduled recovery/email workers with staffed notification routes. The
   monitoring verifier requires every explicit PAYG critical, recovery,
   provider, privacy manual-review and confirmation-email error signal to have a
   policy. Fire synthetic discovery-failure, unknown-intent-state and conflicting
   booking-binding signals, then query `paygIntents` and `paygOrders` for
   unresolved `piiRedactionOperationalWarning` and
   `piiRedactionBookingWarning` values. Do not open PAYG until the query is empty
   or every row has an incident owner and reviewed resolution.
9. Open only one product at a time, perform a reviewed low-risk smoke test, and
   retain its rollback owner and evidence before considering the second.

## Rollback boundary

If pricing, capacity, entitlement, legal evidence, confirmation delivery or
provider identity is uncertain, close only the affected product's purchase gate.
Do not disable the shared Stripe webhook or recovery workers: already-created
intents and payments still need to converge. Treat Stripe as authoritative,
preserve the Firestore ledgers/outboxes for audit, and do not manufacture a
booking, refund or membership by direct database editing.
