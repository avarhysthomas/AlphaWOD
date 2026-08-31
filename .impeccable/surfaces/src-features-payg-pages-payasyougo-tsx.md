---
version: 1
slug: "src-features-payg-pages-payasyougo-tsx"
primary_target: "src/features/payg/pages/PayAsYouGo.tsx"
related_targets: ["src/features/payg/pages/PayAsYouGoSuccess.tsx","src/features/memberships/pages/Memberships.tsx"]
---

# Pay As You Go surface brief

- Scope: `/pay-as-you-go`, its checkout/success states, and the public entry point from `/memberships`.
- Visitor mode: Persuade for first-time purchase, becoming Operate once a session is selected.
- Audience: an adult who wants one Zero Alpha class without creating an account or committing to membership.
- Job: understand the £7.50 one-class offer, see real eligible sessions and availability, choose one, provide required participant/contact and waiver details, and reach Stripe with confidence.
- Primary action: reserve and pay for one named class.
- Proof/content: the live sanitised timetable, remaining capacity, selected date/time/coach/location, the exact 24-hour cancellation boundary, no-reschedule rule, and secure Stripe hand-off.
- Constraints: public and account-free; adult-only; name, date of birth, email, phone and waiver evidence; no reusable credit; no full private classes collection; responsive and keyboard-accessible; preserve the incumbent carbon-black and warm-white Zero Alpha system, with muted olive as the PAYG transaction accent and amber reserved for warnings and membership states.
- Direction: **The timetable is the offer.** Refuse a generic hero followed by cards. The first viewport is a branded departure-board-like weekly session list paired with a persistent purchase rail: £7.50, the selected session, availability, and the primary action. Rows are the hierarchy; selecting one turns the rail into a ticket-like confirmation without leaving the schedule.
- Memorable moment: the chosen row and ticket rail lock together visibly, making it unmistakable that this payment is for one specific class—not a credit.
- Responsive rule: desktop uses schedule plus sticky purchase rail; mobile keeps the schedule primary and reveals a compact sticky selection bar leading to the full form.
- Seed key: `a3a153cb`, assigned grounded structure 7.
- Unresolved decisions: none for implementation; purchase and legal release gates remain closed until approved publication and Stripe verification.
