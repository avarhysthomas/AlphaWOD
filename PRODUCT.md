# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Zero Alpha Fitness adult members who manage their membership and book coached sessions.
- Guests who want to buy a single class without creating an AlphaWOD account.
- Coaches and administrators who manage the timetable, attendance, membership access, and payment exceptions.

## Product Purpose

AlphaWOD is Zero Alpha Fitness's member and operations app. It combines public membership purchase, Stripe billing, authenticated class booking, member account management, training information, and staff administration. Success means each customer receives exactly the access they paid for, while staff can operate the timetable without manual payment reconciliation or overbooking.

## Positioning

The product connects Zero Alpha Fitness's real weekly timetable and membership rules directly to payment-backed access. Access is not a generic login role: it is derived from the customer's current plan or purchase and enforced by the server at the point of booking.

## Operating Context

- Recurring memberships are purchased through Stripe Checkout and managed in AlphaWOD.
- Adult Conditioning Only Membership costs £30 per month and follows the existing first-of-month billing schedule.
- A Conditioning Only member may book any two eligible Conditioning classes in each Europe/London Monday-to-Sunday week: Monday 06:00, Tuesday 18:00, Thursday 18:00, or Friday 05:30. The choices are made from the live schedule and may change from week to week.
- Conditioning Only members can use Schedule, Profile, and Membership management. Dashboard/WOD programming, Training, Leaderboards, and profile performance statistics are not included.
- Pay As You Go costs £7.50 for one named class from the whole public schedule. It is not a reusable credit and cannot be transferred or rescheduled.
- Pay As You Go does not require an account. Checkout collects the adult attendee's name and date of birth, plus an email address and contact number for operational contact about that class.
- A Pay As You Go cancellation made at least 24 hours before the class is refundable. A cancellation made less than 24 hours before the class, or a no-show, is non-refundable.

## Capabilities and Constraints

- Firebase Authentication, Firestore, Cloud Functions, and Stripe are the incumbent stack.
- Stripe live and test catalogues are separate. Provider identifiers are allowlisted and validated server-side before Checkout.
- Membership access, plan capability, class eligibility, capacity, payments, refunds, and bookings are server-authoritative. Hiding UI is never the security boundary.
- Conditioning Only is a weekly booking allowance, not a pair of recurring slot entitlements. Each booked eligible class consumes one of that London-local week's two places; cancelling the booking releases the place back to the same week's allowance so the member can choose another eligible class. Eligibility and quota are enforced from authoritative booking state, not inferred from hidden navigation or attendance alone.
- Pay As You Go uses a separate one-time purchase, hold, order, and fulfilment flow. It must not enter recurring membership, portal, cancellation, MRR, or entitlement processing.
- Public visitors receive only a sanitised PAYG timetable projection. The private classes collection remains access controlled.
- Each purchase flow remains behind its own runtime release gate until Stripe sandbox evidence, legal publication, monitoring, and production verification are complete.
- Current legal documents describe the original five-plan catalogue and recurring memberships. New approved versions are required before either new checkout is opened publicly.
- PAYG additionally remains hard-blocked until the owner/legal team approves exact guest-data retention and deletion semantics and a later reviewed change implements bounded redaction for order, booking, waiver, and email records. Recorded deadlines are preparation, not deletion authority.

## Brand Commitments

- Product and trading name: Zero Alpha Fitness.
- App name: AlphaWOD / Zero Alpha App.
- Preserve the existing Zero Alpha logo assets, direct gym voice, and established product terminology unless the business owner explicitly changes them.

## Evidence on Hand

- Existing public membership catalogue and checkout under `src/features/memberships/`.
- Existing booking and timetable experience under `src/features/bookings/`.
- Canonical recurring catalogue and policy in `functions/src/membershipPlans.ts` with a parity mirror in `src/lib/membershipPlans.ts`.
- Existing Stripe live catalogue allowlist in `functions/src/stripeLiveCatalog.ts`.
- Existing operational and legal rollout documentation under `docs/billing/` and `public/legal/memberships/`.
- Brand logo at `public/ZERO-ALPHA.png`.

## Product Principles

1. Paid access is explicit, least-privilege, and enforced at the server boundary.
2. A customer always sees why a class or app area is unavailable and what their plan includes.
3. One-time class purchases stay simple for guests without weakening capacity or payment integrity.
4. Checkout claims and legal copy must match the exact provider object and policy version being purchased.
5. Failure, retry, refund, cancellation, and delayed-webhook paths are first-class product states.
