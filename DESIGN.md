---
name: "AlphaWOD Adult Purchase and Limited Access"
description: "A carbon-black, amber-led system for named-class checkout and least-privilege membership access."
colors:
  carbon: "#050505"
  panel: "#151311"
  row: "#11100f"
  bone: "#f4f0ea"
  white: "#ffffff"
  amber: "#f4b16d"
  amber-hover: "#ffc485"
  amber-soft: "#fef3c7"
  emerald-soft: "#a7f3d0"
  red-soft: "#fecaca"
typography:
  display:
    fontFamily: "Anton, sans-serif"
    fontSize: "3.15rem"
    fontWeight: 400
    lineHeight: 0.92
    letterSpacing: "normal"
  headline:
    fontFamily: "Anton, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  body-public:
    fontFamily: "Barlow, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
    letterSpacing: "normal"
  body-membership:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.75rem"
    letterSpacing: "normal"
  label:
    fontFamily: "Barlow, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  nav-item: "14px"
  nav-shell: "22px"
  membership-card: "28px"
  pill: "9999px"
spacing:
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "12": "48px"
components:
  payg-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.carbon}"
    typography: "{typography.body-public}"
    rounded: "{rounded.xl}"
    padding: "14px 20px"
  payg-primary-hover:
    backgroundColor: "{colors.amber-hover}"
    textColor: "{colors.carbon}"
    typography: "{typography.body-public}"
    rounded: "{rounded.xl}"
    padding: "14px 20px"
  payg-field:
    backgroundColor: "rgba(0,0,0,0.35)"
    textColor: "{colors.white}"
    typography: "{typography.body-public}"
    rounded: "{rounded.xl}"
    padding: "14px 16px"
  transaction-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bone}"
    rounded: "{rounded.2xl}"
    padding: "20px"
  conditioning-slot-selected:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.xl}"
    padding: "16px 20px"
  bottom-nav:
    backgroundColor: "rgba(255,255,255,0.90)"
    textColor: "{colors.carbon}"
    rounded: "{rounded.nav-shell}"
    padding: "6px 8px"
---

# Design System: AlphaWOD Adult Purchase and Limited Access

## Overview

**Creative North Star: "The Timetable Is the Offer"**

The public Pay As You Go journey is an operational departure board that becomes a class ticket. Real session rows lead; selecting a row visibly binds it to the amber ticket rail and its checkout form. It must never read as a generic membership landing page or as the purchase of a transferable credit.

The wider world is matte, direct and gym-floor practical: carbon-black page framing, warm near-black panels, warm-white type, oversized condensed headings and a small amount of amber reserved for selection, price and primary action. Adult Conditioning extends the same decisive selected/unselected/disabled grammar into recurring-slot choice, while retaining the established recurring-membership checkout treatment.

**Key Characteristics:**

- Live operational information is the primary visual proof.
- Amber means selected, actionable or financially important; it is not decoration.
- Ticket perforations, clipped row stacks and strong time numerals create the signature.
- Restricted access is clear and quiet: show only the capabilities the plan includes, then explain exclusions where the purchase decision is made.

## Colors

The palette is predominantly neutral and dark, with warm amber acting as a high-contrast transaction signal.

### Primary

- **Ticket Amber** (`colors.amber`): PAYG price, selected rows, ticket headers, icons, links, form focus and primary actions.
- **Ticket Amber Hover** (`colors.amber-hover`): PAYG hover only; do not make it a second resting accent.
- **Membership Amber Soft** (`colors.amber-soft`): enabled recurring-membership actions and selected Conditioning slots. The closed Conditioning preview uses Ticket Amber instead. Preserve this surface distinction unless it is deliberately unified across the whole membership flow.

### Neutral

- **Carbon** (`colors.carbon`): page and safe-area background, and ink on amber/white controls.
- **Warm Panel** (`colors.panel`): transaction cards, forms, notices and limited-access explanatory surfaces.
- **Departure Row** (`colors.row`): PAYG row stack and the mobile selection bar.
- **Bone** (`colors.bone`): warm base text. Full white is reserved for headings and the strongest values.
- White-alpha borders and fills form the hierarchy: roughly 10–15% for structure, 3–8% for resting/hover surfaces and 15–40% for stronger separators or disabled contrast.

### Semantic states

- **Emerald Soft** (`colors.emerald-soft`): available capacity only.
- **Amber tints:** release gates, processing and recoverable attention states.
- **Red Soft** (`colors.red-soft`): destructive cancellation and errors. Never use amber for destructive confirmation.

**The Essential-Copy Rule.** Required policy, legal, availability and error text stays at a readable white/amber/red opacity. White below about 55% is metadata only; the faint 34–45% treatment is never the sole presentation of essential information.

## Typography

**Display Font:** Anton with sans-serif fallback

**Public Operational Font:** Barlow with sans-serif fallback
**Membership Body Font:** Inter with sans-serif fallback

Anton supplies compressed, uppercase impact without decorative effects. PAYG deliberately switches the whole journey to Barlow for a timetable/transport character; recurring membership checkout inherits Inter and should keep doing so until that flow is intentionally rethemed.

### Hierarchy

- **Display:** Anton, uppercase, tightly led. PAYG starts at the `display` token and reaches 4.5rem from the small breakpoint; success and Conditioning pages use 3–3.75rem.
- **Headline:** Anton at about 1.875rem for day groups, ticket details, slot sections and status headings.
- **Body:** Barlow at 1rem/1.75rem for primary PAYG explanation; compact 0.875rem copy is common in forms and operational details. Membership checkout uses Inter at 0.875rem with generous 1.5–1.75rem leading.
- **Label:** 0.6875–0.75rem, bold to black, often uppercase with 0.12–0.28em tracking for eyebrows, availability, receipt terms and navigation metadata.
- **Values:** Times, prices and class names may use Anton; legal copy, attendee data and state explanations never do.

**The Condensed-For-Decisions Rule.** Anton names the decision or value; Barlow/Inter explains its consequences.

## Layout

PAYG uses a 7xl container with 20px mobile and 32px larger-screen gutters. At the large breakpoint it becomes `minmax(0, 1fr) / 390px` with a 48px gap. The schedule remains fluid; the purchase rail is sticky 24px from the viewport top, independently scrollable, and capped to the viewport height.

The schedule is grouped by day. Each clipped group contains full-width row buttons with a 76px time column on mobile and 96px from the small breakpoint, followed by flexible class detail and a state/action column. Desktop availability sits at the row edge; mobile moves it beneath the class metadata.

On screens below the large breakpoint, the schedule stays primary. A fixed, blurred selection bar shows the chosen class and price above the safe-area inset; Continue scrolls to and focuses the full ticket/form. Extra page-bottom space prevents the bar covering content. Success and cancellation pages collapse to centered single cards (`max-w-2xl` and `max-w-xl`).

Conditioning checkout is a single `max-w-2xl` column. Its four slot controls stack on narrow screens and become a two-column grid from the small breakpoint. The count remains adjacent to the section heading and uses a polite live region.

Shared navigation is horizontally scrollable rather than wrapping. The top navigation is a sticky black, blurred strip with pill links and top safe-area padding. The bottom navigation is a fixed frosted-white shell capped at 27rem by default and 36rem from the small breakpoint, with 44px minimum item height and bottom safe-area positioning.

## Elevation & Depth

The system is flat by default and establishes depth through tonal layering and translucent borders. Large diffuse shadows are reserved for transaction objects: the ticket rail uses `0 30px 90px rgba(0,0,0,0.50)`, result/cancellation cards use approximately `0 28px 90px rgba(0,0,0,0.48–0.50)`, and recurring-membership cards use `0 26px 80px rgba(0,0,0,0.42)`. The bottom navigation uses the shallower structural shadow `0 12px 34px rgba(0,0,0,0.28)`; the mobile PAYG bar casts upward with `0 -20px 50px rgba(0,0,0,0.45)`.

Blur belongs to sticky navigation and the mobile selection bar, where it preserves context while separating controls. Mobile globally reduces these blur utilities to 8px.

**The Transaction-Object Rule.** Apply a large shadow only to an object that represents an active purchase, receipt or destructive decision; ordinary schedule rows and slot cards remain tonal and bordered.

## Shapes

PAYG cards, notices, fields and primary controls use gently rounded 12–16px corners. The ticket header and body are clipped by one 16px outer card, and dashed separators provide the perforated receipt language. Rows are not individually rounded inside their clipped day container.

Recurring-membership cards retain their roomier 28px corners and 16px fields. Conditioning slot controls use 12px corners inside a 16px section. Navigation has a separate geometry: fully pill-shaped top links, a 22px bottom shell and 14px bottom items.

**The Nested-Radius Rule.** Outer shells own the largest curve; inner controls step down. Do not give every nested element the same oversized radius.

## Components

### Public header and logo

- Use the existing Zero Alpha image with descriptive alt text and a home-link label.
- Keep the header low and functional: logo at left, Memberships and Member sign-in at right, a subtle bottom border and dark translucent backdrop.
- The logo link receives a 2px amber focus ring.

### Schedule row

- The entire row is a button with `aria-pressed`; unavailable rows are disabled, visibly muted and show a lock.
- Available rows are dark with a restrained hover/focus fill. Selected rows invert to amber with carbon text, replace the arrow with a dark circular check, and repeat the availability as selected.
- The accessible name must include time, title, availability and selected state. Capacity text comes from the public schedule response, never from a client estimate.

### Ticket rail and receipt

- The amber header binds the ticket label and fixed offer price. Dashed separators divide identity, conditions and receipt facts.
- Before selection, prompt for one session. After selection, pin class, date, time, location and availability above attendee fields.
- Success reuses the ticket shell for processing, confirmed, refund, cancellation, no-show and dispute states. Preserve the order reference and recorded cancellation cutoff.

### Conditioning slot selector

- Render the canonical slot options as pressed-state buttons with day over an Anton time value.
- Exactly two selections are allowed. Once two are selected, remaining choices become disabled but selected choices remain removable.
- Changing slots clears prior legal acceptances and checkout-attempt state. The selection count is announced with `aria-live="polite"`.
- The closed preview ends in an amber Coming soon notice and enquiry action; it must not expose a payment control.

### Inputs and acceptances

- PAYG inputs use 16px text, 12px corners, translucent black fill and a 2px amber focus halo. Keep explicit labels, required state, autocomplete hints, appropriate input type and the E.164 phone example.
- Acceptance controls are full-row labels with a visible native checkbox, amber accent and `focus-within` treatment. Each legal proposition remains separately accepted.
- Membership inputs use the established 16px recurring-checkout shape and border-shift focus. Typed signatures must continue to match the named adult and expose mismatch with `aria-invalid` plus linked hint text.

### Actions and status panels

- PAYG primary actions are amber on carbon, at least 48–52px high, heavy weight and sentence case. Membership purchase actions remain white or soft amber according to their existing flow.
- Secondary actions are low-opacity dark/transparent with a light border. Destructive cancellation uses red-on-red-soft treatment and explicit confirmation copy.
- Loading uses a spinner plus text. Errors use `role="alert"`; processing and completed non-error outcomes use `role="status"`. Never communicate state by color alone.

### Navigation and limited access

- `getUserNavItems` is the single shared projection used by top and bottom navigation. Limited Adult Conditioning members receive only Schedule, Profile and Membership.
- Top nav uses dark translucent pills with white active state; admin and danger items have amber/red variants. Bottom nav deliberately inverts to a frosted-white shell with black icons and labels.
- Keep touch targets at least 44px and horizontal scrolling available. The current shared NavLinks do not declare an explicit `focus-visible` style; add a 2px high-contrast outline when these components are next extracted or changed.

### Focus, accessibility and motion

- Use the established 2px amber, white or semantic focus ring; add a 2px offset when the control sits on the same color as its ring.
- Preserve section labelling, fieldsets/legends, pressed and disabled semantics, live regions and alert/status roles. Moving focus to the ticket after mobile Continue is part of the interaction contract.
- The current Continue action scrolls smoothly without checking reduced-motion preference. New motion and any refactor of this behavior must honor `prefers-reduced-motion`.

### Copy and contract rules

- PAYG is **£7.50 for one named class and one adult attendee**. It requires no account or membership and is never described as a credit, pass or reschedulable booking.
- State plainly that the class cannot be transferred or rescheduled; cancellations made at least 24 hours before class are refundable, while later cancellations and no-shows are non-refundable. For eligible cancellations say the refund is being processed, not that it is already complete.
- Show exact London-local date/time, coach/location when supplied, remaining capacity, Stripe hand-off and the recorded cancellation cutoff. Processing retries must say they do not create another charge.
- Adult Conditioning is **£30 per month** and requires exactly two of Monday 06:00, Tuesday 18:00, Thursday 18:00 and Friday 05:30. It includes Schedule, Profile and Membership only; Dashboard/WOD, Training, Leaderboards and performance statistics are explicitly excluded.
- Legal and availability language is state-bound. Checkout opens only when the runtime gate and approved legal payload allow it; otherwise show the timetable/slot preview with a clear closed state. Never make a release-gated flow look purchasable.
- Access, eligibility, capacity, price, payment, cancellation and refunds are server-authoritative. UI visibility explains the contract but is not the security boundary.

### Reuse guidance

- Reuse the local visual roles above, but source product facts from `MEMBERSHIP_PLANS`, `CONDITIONING_SLOT_OPTIONS`, `POLICY_TEXT`, versioned checkout-document resolvers and the sanitised PAYG schedule response.
- Reuse `getUserNavItems` rather than copying route lists. Pair any hidden limited-access feature with the existing route/capability guard and explanatory unavailable state.
- The implemented patterns are currently page-local Tailwind compositions, not a shared component library. Extract only when reuse is real, and preserve each component's full selected, disabled, loading, error and focus state matrix.

## Do's and Don'ts

### Do

- **Do** let real schedule rows or canonical recurring slots lead the decision.
- **Do** use amber to connect a selected source row/slot to its purchase summary and action.
- **Do** repeat the exact selected class, price and policy boundary at checkout and confirmation.
- **Do** preserve separate PAYG and recurring-membership typography/action treatments while sharing interaction semantics.
- **Do** keep faint text to secondary metadata and use readable contrast for every condition of purchase.
- **Do** represent delayed payment, closed checkout, refund-pending, cancellation, no-show and dispute as first-class states.

### Don't

- **Don't** replace the PAYG timetable with a generic hero followed by offer cards.
- **Don't** imply that £7.50 buys a reusable credit, transferable place or rescheduling right.
- **Don't** show restricted Conditioning members Dashboard/WOD, Training, Leaderboards or performance navigation.
- **Don't** treat hidden navigation as authorization; server and route guards remain mandatory.
- **Don't** silently change selected Conditioning slots or preserve acceptances after slot/participant details change.
- **Don't** add decorative shadows, extra accent colors or ambient animation to ordinary operational rows.
