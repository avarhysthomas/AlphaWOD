/**
 * Frontend mirror of the canonical membership catalogue and billing policy.
 *
 * The authoritative copy is `functions/src/membershipPlans.ts`.
 * `membershipPlans.parity.test.ts` parses that file and fails this build if
 * the two ever drift, so plan pricing, ages, access rules, and customer-facing
 * policy text can only be changed in one place.
 *
 * Deliberately constants-only: every billing date, proration amount, and
 * cancellation deadline shown to a customer is computed server-side and
 * returned by a callable. The browser never calculates a chargeable amount.
 */

export const BILLING_TIMEZONE = "Europe/London";
export const BILLING_CURRENCY = "gbp";

/** Stripe's recurring anchor; customer copy presents the calendar date only. */
export const PRESALE_BILLING_ANCHOR_AT_ISO = "2026-09-01T00:00:00.000Z";
export const PRESALE_BILLING_ANCHOR_UNIX_SECONDS = 1788220800;

/** New presale intents stop at midnight London on opening day. */
export const PRESALE_SIGNUP_CUTOFF_AT_ISO = "2026-08-31T23:00:00.000Z";
export const PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS = 1788217200;

export const EXISTING_MEMBER_OFFER = {
  planKey: "adult_unlimited",
  amountOffPence: 500,
  currency: BILLING_CURRENCY,
  durationMonths: 3,
  redemptionClosesAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  promotionCodeExpiresAtUnixSeconds: null,
} as const;

/** Catalogue schema version frozen into every checkout commercial snapshot. */
export const MEMBERSHIP_SCHEMA_VERSION = 1;

export const COMPANY = {
  legalName: "ZERO ALPHA FITNESS LTD",
  tradingName: "Zero Alpha Fitness",
  companyNumber: "15978998",
  address: "Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE",
  registeredOffice: "18 Bryngwyn Bach, Llanelli, United Kingdom, SA14 8SH",
  registrationJurisdiction: "England and Wales",
  supportEmail: "support@zeroalphafitness.co.uk",
  confirmationSender: "hello@zeroalphafitness.co.uk",
} as const;

export const PLAN_KEYS = [
  "adult_unlimited",
  "adult_ladies",
  "adult_gym",
  "youth_youngstars",
  "youth_teenstars",
] as const;

export type PlanKey = typeof PLAN_KEYS[number];
export type PlanAudience = "adult" | "youth";

export type MembershipPlan = {
  key: PlanKey;
  audience: PlanAudience;
  name: string;
  amountPence: number;
  currency: typeof BILLING_CURRENCY;
  minAge: number;
  maxAge: number | null;
  grantsAlphaWodAccess: boolean;
  stripePriceEnvKey: string;
  cardGroup: "adult" | "youth";
  summary: string;
};

export const MEMBERSHIP_PLANS: Record<PlanKey, MembershipPlan> = {
  adult_unlimited: {
    key: "adult_unlimited",
    audience: "adult",
    name: "Adult Unlimited Membership",
    amountPence: 6000,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: true,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_UNLIMITED",
    cardGroup: "adult",
    summary: "Full access to sessions and the gym floor. The only membership that automatically includes eligible AlphaWOD access.",
  },
  adult_ladies: {
    key: "adult_ladies",
    audience: "adult",
    name: "Adult Ladies Only Membership",
    amountPence: 5000,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_LADIES",
    cardGroup: "adult",
    summary: "Ladies only sessions and gym access. Does not include AlphaWOD access.",
  },
  adult_gym: {
    key: "adult_gym",
    audience: "adult",
    name: "Adult Gym Only",
    amountPence: 4500,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_GYM",
    cardGroup: "adult",
    summary: "Gym floor access only. Does not include coached sessions or AlphaWOD access.",
  },
  youth_youngstars: {
    key: "youth_youngstars",
    audience: "youth",
    name: "HYROX Youngstars",
    amountPence: 3500,
    currency: BILLING_CURRENCY,
    minAge: 4,
    maxAge: 11,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_YOUTH_YOUNGSTARS",
    cardGroup: "youth",
    summary: "Coached HYROX training for ages 4 to 11. Does not include AlphaWOD access.",
  },
  youth_teenstars: {
    key: "youth_teenstars",
    audience: "youth",
    name: "HYROX Teenstars",
    amountPence: 3500,
    currency: BILLING_CURRENCY,
    minAge: 12,
    maxAge: 16,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_YOUTH_TEENSTARS",
    cardGroup: "youth",
    summary: "Coached HYROX training for ages 12 to 16. Does not include AlphaWOD access.",
  },
};

export const BILLING_POLICY = {
  monthlyAnchorDayOfMonth: 1,
  cancellationNoticeDays: 14,
  pastDueGraceDays: 3,
  coolingOffDays: 14,
  joiningFeePence: 0,
  minimumTermMonths: 0,
  trialDays: 0,
  pauseAllowed: false,
  portalCancellationEnabled: false,
  portalPauseEnabled: false,
  vatRegistered: false,
  automaticTaxEnabled: false,
  collectBillingAddress: false,
  collectPhoneNumber: false,
  blockDuplicateActiveSubscriptions: true,
  guardianMustBePayerForYouth: true,
  adultPayerMustBeParticipant: true,
} as const;

export const POLICY_TEXT = {
  refund: "Payments are non-refundable except where required by law.",
  rollingTerm: "There is no joining fee, free trial or minimum term. Each membership is a rolling monthly contract until cancelled.",
  cancellationRule: "To avoid the next first-of-month payment, your cancellation request must reach us at least 14 calendar days before that billing date. If it reaches us less than 14 days before the next first, that payment remains due and your membership ends at the end of the additional paid month.",
  presaleRule: "Join before opening and nothing is charged today. Stripe securely saves your payment method, your membership starts on 1 September 2026, and the first monthly payment is taken then.",
  existingMemberOffer: "Eligible existing members can use the discount code for £5 off each of the first three monthly payments on Adult Unlimited Membership. The standard £60 monthly price applies after that.",
  prorationRule: "After opening, all memberships bill on the first of each calendar month. If your membership starts after the first, Stripe calculates and displays an initial prorated charge for the period until the next first of the month, payable immediately.",
  prorationAuthority: "The amount Stripe displays before confirmation is authoritative for that checkout. A presale checkout must show £0 due today and a first payment date of 1 September 2026. We do not calculate a separate charge in the browser. If the displayed amount or billing date appears wrong, do not confirm; contact us first.",
  pastDue: "After a membership has started, a failed payment enters a three-calendar-day past-due grace period and existing access continues temporarily. If the first scheduled payment fails, the membership and AlphaWOD access do not start.",
  dispute: "An open payment dispute suspends related access. A dispute resolved in our favour restores eligible access promptly. A lost dispute or full refund revokes related access.",
  noPause: "Membership cannot be paused, frozen or placed on holiday hold.",
  coolingOffConsent: "I expressly request that the membership and any eligible AlphaWOD access begin on the service start date shown, even if that is before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.",
  scheduledYouthSuccess: "You're signed up. Nothing has been charged today. This membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact you by email to arrange onboarding and the first session.",
  scheduledAdultUnlimitedSuccess: "You're signed up. Nothing has been charged today. Your Adult Unlimited membership starts, the first monthly payment is taken, and eligible AlphaWOD access can begin on 1 September 2026.",
  scheduledAdultOtherSuccess: "You're signed up. Nothing has been charged today. This membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact you by email to arrange onboarding and the first session.",
  youthSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  adultUnlimitedSuccess: "Payment confirmed. Your Adult Unlimited membership is active and eligible AlphaWOD access has been unlocked.",
  adultOtherSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  duplicateBlocked: "This account already has an active or scheduled membership. Manage or cancel the existing membership before buying another one.",
  portalScope: "The secure Customer Portal is for updating your payment method and viewing invoices. Cancellation is handled by the request flow on this page.",
  guardianRequirement: "For a participant under 18, the payer must be their parent or legal guardian, or another adult with lawful authority to enter this arrangement for them.",
} as const;

export type CheckoutDocumentKey =
  | "membershipTerms"
  | "cancellationPolicy"
  | "privacyNotice"
  | "adultWaiver"
  | "guardianAddendum";

export type CheckoutDocument = {
  key: CheckoutDocumentKey;
  title: string;
  version: string;
  effectiveDate: string;
  publicUrl: string;
  contentType: "text/plain; charset=utf-8";
  hashCovers: "UTF-8 bytes of content";
  sha256: string;
  content: string;
};

/**
 * Aggregate canonical UTF-8 copy budget for every checkout document. The
 * checkout outbox also stores rendered HTML and base64 attachments, so this
 * deliberately leaves ample headroom below Firestore's document-size limit.
 */
export const CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES = 96 * 1024;

/**
 * Immutable legal-copy registry used by checkout, acceptance evidence and the
 * confirmation email. `scripts/syncPublishedLegalDocuments.js` generates this
 * block from the exact public UTF-8 files and records each SHA-256 digest.
 */
export const CHECKOUT_DOCUMENTS = {
  membershipTerms: {
    key: "membershipTerms",
    title: "Membership Terms",
    version: "ZAF-TERMS-2026-08-20-01",
    effectiveDate: "2026-08-20",
    publicUrl: "/legal/memberships/ZAF-TERMS-2026-08-20-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "436efc32dcf1914c94a7357cb8938e294e818dbeda50eba9600b00a16edd6c6e",
    content: "Membership Terms\n\nPublic membership purchase and ongoing membership\n\nVERSION DATE\n20 August 2026\n\nDOCUMENT ID\nZAF-TERMS-2026-08-20-01\n\nCONTRACTING ENTITY\nZERO ALPHA FITNESS LTD · 15978998\n\nTRADING NAME\nZero Alpha Fitness\n\nPUBLIC CONTACT\nsupport@zeroalphafitness.co.uk\n\nWEBSITE\nhttps://alpha-wod.vercel.app/\n\n1. About these Terms\n\nThese Membership Terms form the contract for a Zero Alpha Fitness membership purchased online from ZERO ALPHA FITNESS LTD, a company registered in England and Wales under company number 15978998, trading as Zero Alpha Fitness (we, us or our). Our registered office is 18 Bryngwyn Bach, Llanelli, United Kingdom, SA14 8SH. Our public trading and contact address is Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE. Contact us at support@zeroalphafitness.co.uk.\n\nFor an adult membership, the named participant must buy the membership for themselves and is also the payer and signer. For a participant under 18, the payer and signer must be the child’s parent or legal guardian, or another adult with lawful authority to enrol them.\n\nThese Terms should be read with the Cancellation, Refund and Cooling-off Policy, the Privacy Notice, and the applicable Adult Participant Waiver or Parent/Guardian Consent and Youth Membership Addendum. Those documents are presented before purchase and form part of the membership arrangement where stated.\n\n2. Eligibility and who must accept what\n\n• An adult participant must be aged 18 or over and must personally accept the Adult Participant Waiver and Risk Acknowledgement before taking part.\n\n• A Youngstars participant must be aged 4 to 11 inclusive. A Teenstars participant must be aged 12 to 16 inclusive.\n\n• A youth participant’s guardian must be the payer, confirm their relationship and authority, and accept the Parent/Guardian Consent and Youth Membership Addendum.\n\n• An adult participant accepts these Terms, the payment obligation and the Adult Participant Waiver for their own membership. Third-party purchase of an adult membership is not supported.\n\n• You must give accurate, complete and current information. You must not buy a youth membership for a child outside the stated age range or misrepresent authority to act for another person.\n\n3. Membership options and prices\n\nThe initial public catalogue is:\n\n• Adult Unlimited Membership — £60 per month. This is the only paid membership that grants eligible AlphaWOD access after the first required payment succeeds.\n\n• Adult Ladies Only Membership — £50 per month.\n\n• Adult Gym Only — £45 per month.\n\n• Youth Membership — one catalogue card with Youngstars (ages 4–11) or Teenstars (ages 12–16), each £35 per month.\n\nThere is no joining fee, free trial or minimum term. Each membership is a rolling monthly contract until cancelled under section 9. We are not currently VAT registered. The price displayed at checkout is the total customer price; no VAT invoice or VAT breakdown is offered. If our tax status changes, we will update the presentation and notices before applying any change.\n\nWe may offer promotion codes subject to their stated eligibility, duration and limits. A promotion does not change the underlying rolling nature of the contract unless its terms expressly say so. A code has no cash value and cannot be applied retrospectively unless required by law or expressly agreed.\n\n4. How the contract is made\n\n1. Choose the membership and, for youth membership, the correct age option.\n\n2. Provide the required participant and payer or guardian details, review the documents, and complete each required acceptance or signature.\n\n3. Review the amount due today, the full monthly price and the first payment or billing date shown by Stripe. During the founding presale, Checkout must show £0 due today and the first monthly payment on 1 September 2026; after opening, Stripe may show an immediate prorated charge to the next first of the month.\n\n4. Complete Stripe Checkout. Available payment methods are those Stripe displays for that transaction and may vary by device, location, currency and eligibility.\n\n5. The contract is formed when Stripe confirms completion of Checkout and we issue an on-screen or email confirmation, unless we promptly tell you that a clear pricing, eligibility or technical error prevented acceptance and refund any amount taken.\n\nStripe will present an unambiguous final confirmation control and summary. Before service begins, we will email a durable confirmation containing the agreed plan, amounts, next payment date, accepted document versions, cancellation information and signed acceptance evidence; a changeable website link alone is not the durable copy. During the founding presale, nothing is charged today; membership starts and the first monthly payment is taken on 1 September 2026. For a youth membership, Checkout completion does not itself book a first session. We will contact the guardian by email to arrange onboarding and the first session.\n\nFounding presale youth confirmation: You’re signed up. Nothing has been charged today. This membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact you by email to arrange onboarding and the first session.\n\n5. Presale, billing date, proration and recurring authority\n\nAll memberships use the first day of each calendar month as the regular billing date, interpreted in Europe/London time. During the founding presale, nothing is charged today. Stripe securely saves the payment method; membership starts and the first monthly payment is taken on 1 September 2026. After opening, memberships start immediately and, if Checkout occurs after the first, Stripe calculates and displays an immediate prorated charge until the next first. The full monthly price is then charged on each first while membership continues.\n\nThe amount Stripe displays before confirmation is authoritative for that Checkout. A presale Checkout must show £0 due today and a first payment date of 1 September 2026. We do not calculate a separate charge in the browser. If the displayed amount or billing date appears wrong, do not confirm; contact us first.\n\nBy completing Checkout, the payer authorises Stripe and us to store the selected payment method as permitted by that payment method and to collect the amount shown today, which is £0 during the founding presale, and future recurring amounts without the payer being present. The payer must keep the payment method valid and may update it through the secure Customer Portal.\n\n6. Price changes\n\nWe may change a recurring price only prospectively. We will give clear advance notice of the new amount and the date it would first apply, using the payer’s recorded email and any legally required method. The payer may cancel before the change takes effect. A price change will not alter amounts already paid or due for a completed billing event. Any legally required notice or cancellation right overrides this paragraph.\n\n7. What the membership provides\n\nThe selected membership provides access to the facilities, sessions or services described for that plan at the time of purchase, subject to opening hours, capacity, timetables, coaching instructions, reasonable safety rules and temporary closures. Membership is personal to the named participant and cannot be sold, shared or transferred without our written agreement.\n\nWe may make reasonable operational changes to timetables, instructors, equipment, class formats or facilities. We will not use this clause to remove the essential benefit of the membership without a fair remedy. If a change is material and adverse, we will give reasonable notice where practicable and any cancellation or refund rights required by law.\n\n8. AlphaWOD access\n\n• Adult Unlimited Membership qualifies the participant for AlphaWOD access only after the first required payment succeeds and while the subscription and payment status remain eligible.\n\n• An existing AlphaWOD account holder should sign in and claim the purchase. Creating or paying for a duplicate active subscription may be blocked.\n\n• Existing users whose AlphaWOD access was already approved before this purchase flow launches remain grandfathered unless their independent eligibility is later removed under a lawful policy.\n\n• Administrators and SGPT staff may retain access through their role independently of a consumer membership.\n\n• Youth memberships, Adult Ladies Only and Adult Gym Only do not automatically include AlphaWOD access.\n\nAlphaWOD access may be suspended or removed when the related entitlement is past due beyond the grace period, unpaid, fully refunded, subject to a lost payment dispute, cancelled or otherwise ineligible. A scheduled cancellation continues only through the paid access period. App availability also depends on compatible technology, internet service, security and maintenance.\n\n9. Ordinary cancellation of the rolling membership\n\nPROMINENT RENEWAL RULE\n\nTo avoid the next first-of-month payment, a cancellation request must reach us at least 14 calendar days before that billing date. If it reaches us less than 14 days before the next first, that next monthly payment remains due and the membership ends at the end of the additional paid month.\n\nA payer may request cancellation through the signed-in cancellation-request flow or by emailing support@zeroalphafitness.co.uk. The online flow records and acknowledges the outcome automatically. Email requests are handled manually using the time the message reaches the support inbox. The request should identify the payer, participant and membership. We will send an acknowledgement showing the effective end date and any remaining scheduled charge.\n\n• If the request is received at least 14 calendar days before the next first, no payment is taken on that first and access ends at the end of the preceding day.\n\n• If the request is received less than 14 calendar days before the next first, the payment on that first remains due; access continues for that paid month and ends at the end of the day before the following first.\n\n• A cancellation request stops later renewals; it does not create a refund for time already supplied or an amount already due, except where the law requires one.\n\n• Membership cannot be paused. A request to pause will not be treated as a cancellation unless the payer clearly asks to cancel.\n\nThe statutory cooling-off right for a newly formed distance contract is separate and is explained in section 10 and the Cancellation, Refund and Cooling-off Policy. It is not restricted by the ordinary renewal-notice rule above.\n\n10. Cooling-off and refunds\n\nWhere the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 apply, a consumer generally may cancel until the end of 14 days after the day the online service contract is made. If the payer expressly requests that service begin on the service start date shown, even if that is before the cooling-off period ends, and then cancels within that period, we may deduct only a proportionate amount for services actually supplied, where the law allows. If that express request was not made, different refund consequences may apply. Any statutory refund will be made within 14 days where that is the legal deadline, to the original payment method unless the consumer expressly agrees otherwise, and without a refund fee.\n\nOutside a statutory or other mandatory right, payments are non-refundable. Nothing in these Terms excludes remedies for services not provided with reasonable care and skill, misdescription, breach of contract, or any other right that cannot lawfully be excluded.\n\n11. Failed payments, grace period and disputes\n\nAfter a membership has started, if a recurring payment fails, Stripe may retry it and we may ask the payer to update the payment method. We allow a three-calendar-day past-due grace period from the failed due date, during which existing related access continues while payment is recovered. If the subscription remains past due after the grace period, access may be suspended until payment succeeds or the membership ends. If the first scheduled payment fails, the membership and AlphaWOD access do not start. We do not add an undisclosed late fee or accelerate future monthly payments.\n\nWhen a payment dispute is opened, related access is suspended while the dispute is investigated. If the dispute is resolved in our favour, access may be restored promptly, subject to current membership status, and we will fairly assess any credit or extension needed for paid access that was unavailable. If the dispute is lost or the payment is fully refunded, related access is revoked. This does not remove the payer’s right to raise a genuine complaint, use an applicable chargeback right, or exercise a statutory remedy. Contacting us first may allow a billing error to be resolved more quickly.\n\n12. Conduct, safety and use of facilities\n\n• Participants must follow staff instructions, posted rules, equipment guidance and reasonable safeguarding measures.\n\n• Participants must use equipment only as instructed, wear suitable clothing and footwear, and behave safely and respectfully.\n\n• A participant should stop immediately and tell a member of staff if they feel unwell, unsafe or unable to continue.\n\n• Violence, harassment, deliberate damage, dangerous conduct, unauthorised commercial activity or misuse of another person’s membership may result in proportionate restriction or termination after fair consideration of the circumstances.\n\n• A guardian must comply with youth arrival, handover, collection and supervision arrangements communicated during onboarding.\n\nWe may take immediate, proportionate action where reasonably necessary to protect a person, property, safeguarding or service security. Where appropriate, we will explain the decision and offer a review route.\n\n13. Health and participation\n\nPhysical training carries inherent risks. The participant or guardian is responsible for deciding whether to seek medical advice before participation and for following professional advice. The public purchase form does not request medical details. If information is necessary for safe participation, do not place it in a signature or general support field; use the separate secure onboarding route we provide. The applicable waiver or guardian addendum contains the detailed participation acknowledgement.\n\n14. Our responsibility\n\nWe must provide services with reasonable care and skill. Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, or any liability that cannot lawfully be excluded or limited.\n\nSubject to that protection, we are not responsible for loss caused by the participant’s deliberate or unsafe misuse of facilities, breach of clear safety instructions, or an event outside our reasonable control where we took reasonable steps to reduce the effect. We are not responsible for business losses arising from a consumer membership. Any limitation will apply only so far as fair and lawful in the circumstances.\n\n15. Customer Portal and account security\n\nThe Stripe Customer Portal may allow the payer to update a payment method and view invoices. Pause and Stripe’s standard cancellation control are disabled because cancellation uses the notice process in section 9. The payer may open the Customer Portal only from the signed-in account that owns the membership. A purchaser who checked out while signed out must first claim the purchase from the Checkout return flow or from a signed-in account whose verified email matches the payer email. The recipient must keep account credentials secure and tell us promptly about suspected unauthorised use.\n\n16. Ending or restricting a membership by us\n\nWe may suspend or end a membership for non-payment, serious or repeated breach, fraud, misuse, safety or safeguarding risk, or where continuing the service is unlawful or no longer reasonably possible. Except where immediate action is reasonably necessary, we will give notice, explain the reason and allow a reasonable opportunity to put a remediable breach right. Any refund or continuing charge will be assessed fairly and in accordance with the law.\n\n17. Changes to these Terms\n\nWe may update these Terms for legal, regulatory, security or reasonable service reasons. We will not impose a material adverse change retrospectively. Where a change materially affects an active membership, we will give clear advance notice and any fair cancellation right required by law. The version accepted at checkout and any later version lawfully notified will be retained with the acceptance evidence.\n\n18. Communications, complaints and governing law\n\nWe send service, billing and legal communications to the payer’s recorded email. The payer must keep it current. Complaints should be sent to support@zeroalphafitness.co.uk or by post to Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE. We will investigate and respond within a reasonable time.\n\nThese Terms are governed by the law of England and Wales. A consumer living elsewhere in the UK retains any mandatory protection of the part of the UK where they live and may bring proceedings in any court available under applicable consumer law. Nothing in these Terms prevents either party from using another lawful dispute-resolution route.\n\nCheckout acceptance text\n\nThe checkout should show each required statement beside its own unticked control. Acceptance must be affirmative; do not pre-tick, infer or bundle optional marketing consent.\n\n☐ I have read and agree to the Membership Terms and the Cancellation, Refund and Cooling-off Policy. I confirm that the participant and payer or guardian details I supplied are accurate.\n\n☐ I acknowledge that I have received and read the Privacy Notice explaining how personal information is used.\n\n☐ I authorise the amount Stripe shows today and future recurring monthly payments for the selected membership on the billing schedule shown at Checkout. Stripe will show the standard monthly price, any verified promotion and when the standard price resumes. This authority is subject to my cancellation and statutory rights.\n\n☐ I expressly request that the membership and any eligible AlphaWOD access begin on the service start date shown, even if that is before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.\n\nEvidence to retain: payer name and verified payer email; the exact document version(s); the exact statement(s) displayed; typed name where required; UTC timestamp plus Europe/London display time; authenticated account or verified-email context; Stripe Checkout/subscription identifiers where relevant; and only the technical audit data disclosed in the Privacy Notice.\n",
  },
  cancellationPolicy: {
    key: "cancellationPolicy",
    title: "Cancellation, Refund and Cooling-off Policy",
    version: "ZAF-CANCEL-2026-08-20-01",
    effectiveDate: "2026-08-20",
    publicUrl: "/legal/memberships/ZAF-CANCEL-2026-08-20-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "983c1e883887d5b44da3170a2df4a474c5e41e7df2a0988e3ee6606e29356402",
    content: "Cancellation, Refund and Cooling-off Policy\n\nPlain-English rules for rolling monthly memberships\n\nVERSION DATE\n20 August 2026\n\nDOCUMENT ID\nZAF-CANCEL-2026-08-20-01\n\nCONTRACTING ENTITY\nZERO ALPHA FITNESS LTD · 15978998\n\nTRADING NAME\nZero Alpha Fitness\n\nPUBLIC CONTACT\nsupport@zeroalphafitness.co.uk\n\nWEBSITE\nhttps://alpha-wod.vercel.app/\n\nAt a glance\n\n• Memberships are rolling monthly, with no joining fee, free trial, minimum term or pause option.\n\n• During the founding presale, £0 is charged today; membership starts and the first monthly payment is taken on 1 September 2026. After opening, a person joining after the first pays the Stripe-displayed prorated amount immediately.\n\n• To avoid the next first-of-month payment, the cancellation request must reach us at least 14 calendar days before that billing date.\n\n• If the request arrives later, the next first-of-month payment remains due and membership continues through that additional paid month.\n\n• Payments are non-refundable except where required by law.\n\n• A statutory 14-day cooling-off right for a new online contract is separate from the ordinary renewal-notice rule.\n\n1. Presale, start date, proration and monthly renewal\n\nDuring the founding presale, membership and service start on 1 September 2026 and the first monthly payment is taken then. A cancellation request received before that service-start date withdraws the presale: no first payment is taken and service does not begin. After opening, membership begins when Checkout is confirmed; Stripe calculates any immediate proration until the next first. The full monthly price is then collected on each following first while the membership continues. Times and deadlines use Europe/London.\n\n2. How to request ordinary cancellation\n\n1. Use the signed-in cancellation-request flow. If you cannot access it, email support@zeroalphafitness.co.uk from the payer’s recorded email.\n\n2. Identify the payer, participant and membership. Do not send card or bank details.\n\n3. The signed-in flow records the server receipt time and freezes the displayed outcome. For email, staff record the time the message reaches the support inbox, not when it was written or sent from a device.\n\n4. The online flow sends an acknowledgement automatically. Staff send the email-channel acknowledgement after intake. It shows the recorded receipt time, the final scheduled payment (if any) and the membership end date. Contact us promptly if it is wrong.\n\nStripe’s Customer Portal allows payment-method updates and invoice viewing. Its built-in pause and cancellation controls are disabled. Opening the portal or removing a payment method is not a cancellation request.\n\n3. The 14-day renewal deadline\n\nIMPORTANT FINANCIAL COMMITMENT\n\nA request must reach us at least 14 calendar days before the next first of the month to stop that payment. If it reaches us less than 14 days before the next first, that payment remains due and cancellation takes effect after the additional paid month.\n\n• On-time request: no payment on the next first; access ends at 23:59 Europe/London on the day before it.\n\n• Late request: the next first-of-month payment is collected; access continues for that full paid month and ends at 23:59 Europe/London on the day before the following first.\n\n• After acknowledgement, no payment should be scheduled beyond the stated final payment. A billing error will be corrected, including any refund required by law or by our confirmation.\n\nWorked examples\n\n• Next billing date 1 June; request received 18 May: this is 14 calendar days before 1 June. No 1 June payment is due and access ends 31 May.\n\n• Next billing date 1 June; request received 19 May: this is less than 14 calendar days before 1 June. The 1 June payment remains due and access ends 30 June.\n\nThe account flow should display the exact deadline and outcome before submission. If the service was unavailable, send the request by email and retain evidence of delivery; we will assess the circumstances fairly.\n\n4. Statutory cooling-off for a new online membership\n\nIf the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 apply, a consumer generally may cancel an online service contract during the 14-day period beginning after the contract is made. This is a separate right. The ordinary renewal deadline in section 3 does not shorten it.\n\nCheckout asks the payer separately to request that membership and eligible AlphaWOD access begin on the service start date shown, even if that is before the cooling-off period ends. If the payer makes that express request and cancels during the cooling-off period, we may keep or charge only the proportionate amount the law permits for services actually supplied before cancellation. A cooling-off request records an immediate cancellation outcome, but any refund or deduction is reviewed manually. The balance will be refunded within 14 days, to the original payment method unless the consumer expressly agrees otherwise, and without a refund fee. If the express service-start request was not made, we will not make a deduction that the Regulations prohibit.\n\nA service consumer loses the cooling-off right because of full performance within the 14 days only where all legal conditions are met, including the required express request and acknowledgement. Nothing in this policy asks a customer to give up a right unlawfully.\n\n☐ I expressly request that the membership and any eligible AlphaWOD access begin on the service start date shown, even if that is before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.\n\n5. How to use the cooling-off right\n\nMake a clear statement that you want to cancel during the cooling-off period through the cancellation flow or by emailing support@zeroalphafitness.co.uk. You may use the model wording below, but you do not have to use it:\n\nTo ZERO ALPHA FITNESS LTD: I give notice that I cancel my membership contract. Payer name: [name]. Participant name: [name]. Contract date: [date]. Payer email: [email]. Date of notice: [date].\n\n6. Refunds\n\nPayments are non-refundable except where required by law. This means we do not ordinarily refund a correctly calculated after-opening proration, a used or unused part of a paid month, a promotion difference, or a payment that remained due because a cancellation request missed the 14-day renewal deadline. A valid pre-start presale withdrawal has no first payment to refund.\n\nWe will provide any remedy required for a valid cooling-off cancellation, duplicate or incorrect charge, failure to provide services with reasonable care and skill, material breach, or other statutory right. A contractual no-refund statement never overrides a mandatory remedy.\n\n7. No pauses\n\nMembership cannot be paused, frozen or placed on holiday hold. A request to pause does not stop billing and is not treated as a cancellation unless it clearly asks us to cancel. If disability, pregnancy, illness or another exceptional circumstance engages a legal duty or makes the standard policy unfair, contact us so we can consider a reasonable and lawful response.\n\n8. Failed payments and disputes\n\nAfter a membership has started, a failed recurring payment enters a three-calendar-day past-due grace period, during which existing related access continues. Stripe may retry payment and we may ask the payer to update the method. If payment is still past due after the grace period, access may be suspended. If the first scheduled payment fails, the membership and AlphaWOD access do not start. An open payment dispute suspends related access; a dispute won by Zero Alpha Fitness restores eligible access promptly and we will fairly assess any credit or extension needed for paid time that was unavailable; a lost dispute or full refund revokes related access. These access rules do not prevent a genuine complaint, statutory cancellation or lawful chargeback.\n\n9. Confirmation and contact\n\nCancellation and refund communications will be sent to the payer’s recorded email. Questions or complaints: support@zeroalphafitness.co.uk. Post: ZERO ALPHA FITNESS LTD, Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE. Keep the acknowledgement and relevant Stripe receipt.\n",
  },
  privacyNotice: {
    key: "privacyNotice",
    title: "Privacy Notice",
    version: "ZAF-PRIVACY-2026-08-20-01",
    effectiveDate: "2026-08-20",
    publicUrl: "/legal/memberships/ZAF-PRIVACY-2026-08-20-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "9ada73108301c20c87a5c9982f0dac258662260da7e5c3d78431287630f41b9b",
    content: "Privacy Notice\n\nMembership, payment, AlphaWOD and participant information\n\nVERSION DATE\n20 August 2026\n\nDOCUMENT ID\nZAF-PRIVACY-2026-08-20-01\n\nCONTRACTING ENTITY\nZERO ALPHA FITNESS LTD · 15978998\n\nTRADING NAME\nZero Alpha Fitness\n\nPUBLIC CONTACT\nsupport@zeroalphafitness.co.uk\n\nWEBSITE\nhttps://alpha-wod.vercel.app/\n\n1. Who we are\n\nZERO ALPHA FITNESS LTD, a company registered in England and Wales under company number 15978998, trading as Zero Alpha Fitness, is the controller of the personal information described in this Notice. Our registered office is 18 Bryngwyn Bach, Llanelli, United Kingdom, SA14 8SH. Our public trading and contact address is Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE. For privacy questions or requests, email support@zeroalphafitness.co.uk.\n\nThis Notice covers membership buyers and payers, adult participants, children in Youngstars or Teenstars, their parents or guardians, AlphaWOD account holders, and people who contact support or exercise a privacy right.\n\nCheckout short-form notice\n\nZERO ALPHA FITNESS LTD uses these details to set up and manage the participant’s membership, verify age and guardian authority, manage payment through Stripe, and provide eligible AlphaWOD access. Required fields are needed to complete the membership. If you provide details about another person, we will give them our Privacy Notice during onboarding. Marketing is not part of this purchase. Read the Privacy Notice.\n\n2. The information we collect\n\nIdentity, eligibility and contact information\n\n• Participant name and date of birth, and the payer email collected through Stripe or the account-claim flow.\n\n• For youth membership, the child’s age band, guardian name, the guardian’s relationship to the child and declaration of authority.\n\n• The Zero Alpha purchase form does not request a phone number or billing address. Stripe may ask the payer directly for information required by a selected payment method or its legal and fraud-prevention checks.\n\nAccount, membership and agreement information\n\n• Firebase account identifier, verified email status, sign-in and security records. Authentication providers handle credentials; we do not need to see the payer’s full password.\n\n• Selected plan, participant, start date, billing anchor, promotion use, subscription and access status, payment-failure grace period, cancellation request and effective end date.\n\n• Typed electronic signature, authority declaration, acceptance statements, accepted document version, timestamp and the audit context actually recorded at acceptance.\n\n• AlphaWOD eligibility, account-claim state, bookings, attendance, workout or training entries and performance records for eligible adult users.\n\nPayment information\n\nStripe collects and processes payment details. We expect to receive identifiers and status information such as Stripe customer, Checkout Session, subscription, invoice, payment, refund and dispute references, and limited payment-method information where Stripe makes it available. We do not store full card or bank credentials in the Zero Alpha application.\n\nTechnical, communications and safety information\n\n• IP address, device/browser information, timestamps, authentication events, security, error and audit logs to the extent the service providers and our implementation record them.\n\n• Transactional email delivery events, support correspondence, complaints and privacy requests.\n\n• The public purchase form does not request health or injury details. If safety information is needed during onboarding, it must be collected through the separate, clearly explained process provided for that purpose.\n\n• Photographs, video or promotional media only through a separate optional consent process; media consent is not a condition of membership.\n\n3. Where the information comes from\n\n• Directly from an adult participant buying for themselves, or from a guardian buying for a child, during purchase, onboarding, account use or support contact.\n\n• From Stripe about checkout, billing, payment, refund and dispute events.\n\n• Automatically from the site, AlphaWOD, authentication service and security or operational logs.\n\n• From authorised staff recording membership, onboarding, attendance, booking or training administration.\n\nAdult participants receive this Notice during their own Checkout. For a child, the guardian receives the full Notice and we will provide age-appropriate information to the child during onboarding.\n\n4. Why we use information and our lawful bases\n\nWe use personal information only where a lawful basis applies:\n\n• Contract — to take the payer’s payment, create and administer their subscription, send essential billing/service messages, process cancellation and deliver services that are objectively necessary under a contract with that person.\n\n• Legitimate interests — to administer a youth membership, confirm guardian authority and age eligibility, prevent duplicate subscriptions and fraud, secure the service, keep proportionate audit evidence, administer ordinary bookings and training, manage claims and improve reliable operations. Our interests are providing the agreed service, protecting users and the business, and demonstrating what was agreed. We must balance those interests against each person’s rights, with extra weight for children.\n\n• Legal obligation — to keep company, accounting and transaction records and make disclosures where a specific law requires it.\n\n• Consent — only where a genuinely optional activity requires it, such as optional marketing, promotional media, or a separately designed optional feature using health information. Consent can be withdrawn without affecting earlier lawful use.\n\n• Vital interests — exceptionally, where processing is necessary to protect someone’s life and they cannot consent, for example in a genuine emergency.\n\nService, security, payment and cancellation messages are not marketing. If we introduce marketing, we will keep it separate from purchase acceptance and use consent or another route only where PECR and data-protection law allow it. Every marketing message will offer the required opt-out.\n\n5. Children and youth membership\n\nYoungstars covers ages 4–11 and Teenstars covers ages 12–16. The guardian is the payer and supplies the child’s details. Children do not receive AlphaWOD access under the initial public youth membership. We use only the information reasonably needed to verify the age option, arrange onboarding, provide the membership, protect the child and maintain appropriate evidence.\n\nA child’s data-protection rights belong to the child. Whether a guardian may exercise a right for them depends on the child’s understanding, authority and best interests. We will explain relevant processing in language and a format appropriate to the child’s age. We do not use a guardian’s acceptance of the membership documents as blanket data-protection consent.\n\n6. Health and other special-category information\n\nDO NOT SUBMIT HEALTH DETAILS AT CHECKOUT\n\nDo not type medical conditions, injuries, medication or other health information into a signature, promotion-code, support or general checkout field. If information is needed for safe participation, use the separate secure onboarding route provided by Zero Alpha Fitness.\n\nInformation about health is special-category data. If we collect it, we need both an Article 6 lawful basis and an Article 9 condition, plus clear information and appropriate safeguards. Some workout or performance entries may reveal health even if they are not labelled medical. Before any such feature is used, we will classify the fields, identify the lawful condition, minimise access and retention, and provide a just-in-time notice. Where explicit consent is the appropriate condition for an optional feature, it will be specific, separate and withdrawable.\n\n7. Automated status changes and human review\n\nStripe events and our rules may automatically update subscription status and related access—for example, allowing Adult Unlimited access after confirmed payment, applying a three-day past-due grace period, blocking a duplicate active subscription, suspending access when a dispute opens, restoring it after a dispute is won, or revoking it after a lost dispute or full refund. These rules use payment and membership status rather than profiling a person’s character. A person may contact us for an explanation, correction and human review of an incorrect or exceptional result.\n\n8. Who receives information\n\nWe share only what is reasonably necessary with:\n\n• Stripe, payment networks, banks and payment-method providers for Checkout, Billing, payment authentication, fraud prevention, refunds, disputes and the Customer Portal. Stripe may act as our service provider and as an independent controller for some legal, network and fraud purposes under its own notice.\n\n• Google Firebase and Google Cloud for authentication, database, server functions and related infrastructure.\n\n• Vercel for website delivery, hosting and operational logs.\n\n• Resend for transactional email delivery.\n\n• Authorised Zero Alpha Fitness staff and contractors who need the information for their role.\n\n• Accountants, insurers, legal advisers, courts, regulators, law-enforcement bodies or a buyer/reorganised business where disclosure is lawful, necessary and appropriately protected.\n\nA supplier is not automatically our processor for every activity. We verify each role, contract and subprocessor and keep access limited to the relevant purpose.\n\n9. International transfers\n\nSome suppliers or their subprocessors may process information outside the UK. Where this involves a restricted transfer, we use an applicable UK adequacy regulation or an approved UK International Data Transfer Agreement or UK Addendum, together with any required risk assessment and supplementary protections. A person may ask us for information about the relevant safeguard.\n\n10. How long we keep information\n\nWe keep information only for as long as needed for the purpose, legal records, security and live disputes, then delete or irreversibly anonymise it. Our retention schedule is:\n\n• Company, accounting, invoice and transaction records — normally six years from the end of the company financial year to which they relate, subject to any longer lawful requirement or live enquiry.\n\n• Membership account, subscription, cancellation and essential support records — while active and normally up to six years after the membership or account relationship ends where needed for contract, complaint or claim records; unnecessary live-profile data should be removed sooner.\n\n• Adult waiver, guardian authority, acceptance version and signature evidence — six years after adult membership ends; for a child, until at least the 21st birthday or resolution of a live claim, whichever is later, subject to any longer lawful, insurance or safeguarding requirement.\n\n• Bookings, attendance and ordinary workout/performance entries — for the operational period communicated in AlphaWOD settings and then deleted or anonymised.\n\n• Authentication, security and technical logs — a short, documented period appropriate to the risk, normally no more than 12 months unless needed for an incident, fraud or claim.\n\n• Optional marketing — until consent is withdrawn or the purpose ends, while retaining only a minimal suppression record where needed to honour an opt-out.\n\nA deletion request does not override a lawful need to retain a limited record. Where possible, financial and claims evidence will be separated from the live app profile so unnecessary operational information can be removed.\n\n11. Cookies, local storage and similar technologies\n\nThe site, Firebase authentication, Stripe and hosting services may use cookies, browser storage, device identifiers or similar storage and access technologies for requested sessions, security, payment authentication, fraud prevention and reliable delivery. Strictly necessary technologies do not require consent but still require clear information. Any non-exempt analytics, advertising or cross-service tracking remains disabled unless and until valid consent is obtained.\n\n12. Security\n\nWe use proportionate technical and organisational measures designed to protect information, including access controls, verified sign-in and one-time purchase-claim verification, separation of payment credentials from the app, audit logging and supplier security terms. No online service is risk-free. If a personal-data breach creates a legally reportable risk, we will notify the ICO and affected people as required.\n\n13. Your rights\n\nDepending on the circumstances, a person may have the right to:\n\n• be informed and obtain access to their personal information;\n\n• correct inaccurate or incomplete information;\n\n• ask for erasure or restriction;\n\n• receive portable information where the legal conditions apply;\n\n• withdraw consent at any time where consent is used;\n\n• object to direct marketing; and\n\n• ask for safeguards and human review concerning qualifying automated decisions.\n\nRIGHT TO OBJECT\n\nYou may object to processing based on our legitimate interests. Tell us what you object to and why by emailing support@zeroalphafitness.co.uk. We will stop unless we demonstrate compelling legitimate grounds that override your interests, rights and freedoms, or the processing is needed for legal claims. Direct marketing stops when you object.\n\nWe may need reasonable information to verify identity and authority before acting. We do not charge for an ordinary request, but the law allows limited exceptions. We will respond within the applicable time and explain any lawful refusal or extension.\n\n14. Complaints\n\nSend a data-protection complaint to support@zeroalphafitness.co.uk or Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE. We will provide a direct route, acknowledge the complaint within 30 days, investigate appropriately, keep the complainant informed and provide the outcome without undue delay. A person may also complain to the UK Information Commissioner’s Office (ICO).\n\nICO complaint information: ico.org.uk/make-a-complaint/data-protection-complaints/\n\n15. Changes to this Notice\n\nWe will version and date this Notice. If a change materially affects how active-member information is used, we will provide a clear notice before the new use where required. Earlier acceptance and transaction records remain linked to the version provided at the relevant time.\n",
  },
  adultWaiver: {
    key: "adultWaiver",
    title: "Adult Participant Waiver and Risk Acknowledgement",
    version: "ZAF-ADULT-WAIVER-2026-08-20-01",
    effectiveDate: "2026-08-20",
    publicUrl: "/legal/memberships/ZAF-ADULT-WAIVER-2026-08-20-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "fff52601536b2cef1a63db3fb05f7101cee407e13eee70fab78f88c8e349ec72",
    content: "Adult Participant Waiver and Risk Acknowledgement\n\nFor every participant aged 18 or over\n\nVERSION DATE\n20 August 2026\n\nDOCUMENT ID\nZAF-ADULT-WAIVER-2026-08-20-01\n\nCONTRACTING ENTITY\nZERO ALPHA FITNESS LTD · 15978998\n\nTRADING NAME\nZero Alpha Fitness\n\nPUBLIC CONTACT\nsupport@zeroalphafitness.co.uk\n\nWEBSITE\nhttps://alpha-wod.vercel.app/\n\nPARTICIPANT MUST ACCEPT PERSONALLY\n\nEvery adult membership must be bought and signed by the named adult participant for themselves. Third-party purchase of an adult membership is not supported.\n\n1. Participant declaration\n\nI confirm that I am the named participant, I am aged 18 or over, and the information I provide is accurate. I understand that this document records informed participation and reasonable allocation of risk; it does not remove duties or rights that the law does not allow either party to exclude.\n\n2. Activities covered\n\nThis acknowledgement applies to the Zero Alpha Fitness activities I choose to undertake under my membership, which may include gym use, resistance and cardiovascular training, functional fitness, coached classes, individual or group workouts, use of free weights and machines, conditioning, mobility work and related warm-up or cool-down activity, whether at the facility or at an organised session.\n\n3. Risks I understand\n\nPhysical training has inherent risks even where reasonable care is taken. Depending on the activity, these may include slips, trips, falls, collisions, equipment movement or failure, overexertion, delayed-onset soreness, strains, sprains, fractures, head or spinal injury, aggravation of an existing condition, heat illness, cardiovascular events and, in rare cases, permanent injury or death. Risks may arise from my own actions, other participants, the environment and the nature of strenuous exercise.\n\nI voluntarily choose to participate with that understanding. I accept inherent risks that cannot be eliminated by reasonable care, but I do not waive liability for negligence or any statutory right that cannot lawfully be excluded.\n\n4. Fitness to participate and medical advice\n\n• I will consider my current fitness, health, experience and the demands of an activity before taking part.\n\n• I will seek medical advice before participation where I have symptoms, concerns, a relevant condition, am pregnant or have been advised to limit exercise.\n\n• I will follow medical advice and will not participate while impaired by alcohol, non-prescribed drugs, unsafe medication effects, acute illness or injury.\n\n• I will tell the appropriate member of staff, through the secure route provided, about information reasonably necessary for safe participation and any change that affects it.\n\nHEALTH-INFORMATION CHANNEL\n\nThe public checkout and typed-signature fields are not designed for medical details. I will not enter health information there. If staff need safety information, I will use the separate onboarding channel and read the just-in-time privacy information.\n\n5. My conduct and safety responsibilities\n\n• I will follow reasonable instructions, posted rules, equipment guidance and any scaling or exclusion communicated for safety.\n\n• I will use equipment only for its intended purpose and only when I know how to do so or have asked for instruction.\n\n• I will wear suitable clothing and footwear, keep the training area reasonably clear and act with care toward others.\n\n• I will stop immediately and tell staff if I feel pain, dizziness, unusual shortness of breath, faintness, loss of control or any other warning sign.\n\n• I will not deliberately conceal a safety issue, attempt a movement beyond my safe capability after being told not to, or disrupt another participant’s safe use of the facility.\n\n6. Coaching and results\n\nCoaching and programming are general fitness services, not medical diagnosis or treatment. Results vary and are not guaranteed. I remain responsible for choosing weights, intensity and participation within my capability while following coaching and safety instructions.\n\n7. Emergency assistance and first aid\n\nIf staff reasonably believe urgent assistance is needed, I authorise them to provide or arrange proportionate first aid, contact emergency services and share the minimum information reasonably necessary for that emergency. This does not guarantee the availability of a particular treatment or professional and does not replace my responsibility to obtain medical advice.\n\n8. Personal property\n\nI remain responsible for personal property I bring to the facility. Zero Alpha Fitness will take reasonable care where it assumes responsibility, but is not responsible for unattended loss or damage caused without its breach of duty. Nothing in this paragraph excludes liability that cannot lawfully be excluded.\n\n9. Liability and statutory rights\n\nZero Alpha Fitness must provide its services with reasonable care and skill. Nothing in this document excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, or another liability that cannot be limited by law.\n\nSo far as fair and lawful, Zero Alpha Fitness is not responsible for harm or loss caused by my deliberate or unsafe misuse, material breach of clear safety instructions, inaccurate information I knowingly provide, or an inherent risk that remained despite reasonable care. Any responsibility will be assessed according to the facts and applicable law, including each party’s contribution.\n\n10. Privacy and media\n\nThe Privacy Notice explains how participant, signature, account, training and incident information is used. This waiver is not consent to marketing, photography, video or promotional use. Any media permission must be optional, specific and separate, and refusing it does not affect membership.\n\n11. Electronic signature and continuing effect\n\nI intend my typed name and affirmative submission to authenticate and sign this document electronically. I will have an opportunity to review the document before signing and receive or access a durable copy afterwards. The acceptance record will include the document version and timestamp.\n\nThis acknowledgement continues while I participate under the membership, but it does not silently authorise a materially different risk or remove the need to notify me of a material document change. If one provision is unenforceable, the remaining provisions continue so far as lawful. The law and jurisdiction wording in the Membership Terms applies, subject to mandatory consumer rights.\n\nElectronic signing arrangement\n\n☐ I confirm that I am the named participant, I am aged 18 or over, and I have read and understood the Adult Participant Waiver and Risk Acknowledgement. I understand the activities and inherent risks and choose to participate, subject to my statutory rights and Zero Alpha Fitness’s duty to take reasonable care.\n\nRequired fields: participant full legal name and date of birth; typed signature name; the exact acceptance statement; signature date/time; membership/order reference; waiver document ID and version. The adult participant is also the payer.\n",
  },
  guardianAddendum: {
    key: "guardianAddendum",
    title: "Parent/Guardian Consent and Youth Membership Addendum",
    version: "ZAF-GUARDIAN-2026-08-20-01",
    effectiveDate: "2026-08-20",
    publicUrl: "/legal/memberships/ZAF-GUARDIAN-2026-08-20-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "8118e51ceb7f66aa3dcf6ee658cc627d469db670e8f2a2a13110aeb4a605cdd7",
    content: "Parent/Guardian Consent and Youth Membership Addendum\n\nFor Youngstars (ages 4–11) and Teenstars (ages 12–16)\n\nVERSION DATE\n20 August 2026\n\nDOCUMENT ID\nZAF-GUARDIAN-2026-08-20-01\n\nCONTRACTING ENTITY\nZERO ALPHA FITNESS LTD · 15978998\n\nTRADING NAME\nZero Alpha Fitness\n\nPUBLIC CONTACT\nsupport@zeroalphafitness.co.uk\n\nWEBSITE\nhttps://alpha-wod.vercel.app/\n\nGUARDIAN IS THE PAYER AND SIGNER\n\nThe adult guardian signs this addendum, accepts the Membership Terms and pays. The child receives an age-appropriate explanation during onboarding. This document does not ask a child to waive rights that cannot lawfully be waived.\n\n1. Youth membership covered\n\nThis addendum applies to one named child enrolled in Youngstars (minimum age 4, maximum age 11) or Teenstars (minimum age 12, maximum age 16). Eligibility is based on age at the relevant date under the published transition policy. A guardian must contact us if the date of birth or selected age option is wrong.\n\nThe initial youth membership does not provide the child with AlphaWOD access. Completing Stripe Checkout forms the membership contract but does not reserve a first session. During the founding presale, nothing is charged today; membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact the guardian by email to arrange onboarding and the first session.\n\n2. Guardian authority and information\n\nI confirm that I am aged 18 or over, I am the child’s parent or legal guardian or otherwise have lawful authority to make the decisions and commitments in this addendum, and I am the payer. If responsibility is shared or restricted by a court order or other arrangement, I confirm that signing and enrolling the child is permitted and I will tell Zero Alpha Fitness promptly about any relevant restriction or change.\n\nI confirm that the child’s name, date of birth, age option, my relationship and contact details are accurate. I understand that Zero Alpha Fitness may pause onboarding or participation while it reasonably verifies eligibility or authority.\n\n3. Activities and risks\n\nYouth activities may include age-appropriate functional fitness, movement skills, bodyweight and resistance exercises, conditioning, games, coached circuits, use of suitable equipment and related warm-up or cool-down activities. The programme should be adapted to age, maturity, experience and the session plan.\n\nPhysical activity has inherent risks even where reasonable care is taken. These may include slips, trips, falls, collisions, overexertion, soreness, strains, sprains, fractures, equipment-related injury, aggravation of an existing condition and, rarely, serious or permanent injury. I understand those risks and consent to the child’s participation subject to Zero Alpha Fitness’s duty to use reasonable care, appropriate safeguarding and age-appropriate supervision.\n\n4. Child’s readiness and safety information\n\n• I will consider whether the child is well enough and ready to participate, seek medical advice where appropriate, and follow professional advice.\n\n• I will not send the child to participate while acutely ill, injured, impaired or subject to advice that makes participation unsafe.\n\n• I will tell Zero Alpha Fitness promptly, through the secure onboarding route, about information reasonably necessary to adapt or safely manage participation.\n\n• I will keep relevant information current and will not ask the child to conceal a material safety concern.\n\nDO NOT ENTER HEALTH DETAILS IN CHECKOUT\n\nThe public purchase, signature and support fields are not the place for a child’s medical information. Use only the separate secure onboarding channel and read its just-in-time privacy information.\n\n5. Safeguarding, supervision and handover\n\n• I and the child will follow reasonable safeguarding, behaviour, clothing, equipment and safety instructions.\n\n• I will comply with the stated arrival, sign-in, handover and collection process and will provide information about any person authorised or prohibited from collecting the child where lawfully required.\n\n• I will arrive and collect on time and will not assume supervision starts before handover or continues after the stated collection point.\n\n• I understand that age-appropriate supervised activity still requires the child to listen, behave safely and tell a coach if they feel pain, unwell, unsafe or unable to continue.\n\n• Zero Alpha Fitness may stop or adapt an activity, contact me, or take proportionate immediate action where reasonably necessary for safety or safeguarding.\n\n6. Emergency assistance\n\nIf staff reasonably believe urgent assistance is needed and cannot contact me in time, I authorise them to provide or arrange proportionate first aid, contact emergency services and share the minimum information reasonably necessary to protect the child. Staff will try to contact me as soon as reasonably practicable. This does not guarantee a particular treatment and does not replace professional medical advice.\n\n7. Membership, payment and cancellation\n\nAs payer, I accept the £35 standard monthly price and recurring authority. During the founding presale, Stripe shows £0 due today and the first payment on 1 September 2026; after opening, Stripe may show immediate proration to the next first. I also accept the three-day past-due rule after service has started, the rule that a failed first scheduled payment means membership and access do not start, the no-pause rule, and the ordinary 14-day pre-renewal cancellation deadline. I understand that statutory cooling-off and refund rights remain separate and cannot be removed. The Membership Terms and Cancellation, Refund and Cooling-off Policy explain the details.\n\n8. Conduct and proportionate restriction\n\nZero Alpha Fitness may adapt, pause or end the child’s participation in a session where reasonably necessary for safety, safeguarding, serious disruption or suitability. Any longer restriction or membership termination will be handled fairly under the Membership Terms, with an explanation and review opportunity where appropriate. Reasonable adjustments and relevant legal duties will be considered.\n\n9. Liability and the child’s rights\n\nZero Alpha Fitness must provide services with reasonable care and skill. Nothing in this addendum excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, safeguarding duties, or any other liability that cannot lawfully be excluded or limited.\n\nI acknowledge inherent risks that remain despite reasonable care. So far as fair and lawful, Zero Alpha Fitness is not responsible for harm caused by deliberate unsafe conduct, material breach of clear instructions, or materially inaccurate information knowingly supplied by the guardian, taking account of the child’s age and all circumstances. The child retains their own rights.\n\n10. Privacy and the child’s voice\n\nThe Privacy Notice explains how child, guardian, signature, membership and incident information is used. I will make the Notice available to the child and support Zero Alpha Fitness in giving an age-appropriate explanation. Data-protection rights belong to the child. My ability to exercise them for the child depends on authority, capacity and the child’s best interests.\n\nThis addendum is not consent to marketing, photography, video or promotional use. Any media permission will be optional, specific and separate, and refusal will not affect membership.\n\n11. Electronic signature and changes\n\nI intend my typed name and affirmative submission to authenticate and sign this addendum electronically. I will be able to review it before signing and receive or access a durable copy afterwards. The record will identify the document version and time of acceptance.\n\nThis addendum continues while the child participates under the youth membership. A material change requires clear notice and any fresh agreement reasonably or legally required. If a provision is unenforceable, the remainder continues so far as lawful. The law and jurisdiction wording in the Membership Terms applies, subject to the child’s and consumer’s mandatory rights.\n\nGuardian electronic signing arrangement\n\n☐ I confirm that I am aged 18 or over, I am the named child’s parent or legal guardian or otherwise have lawful authority to enrol them, and I am the payer.\n\n☐ I have read and agree to the Parent/Guardian Consent and Youth Membership Addendum. I understand the activities and inherent risks and consent to the child’s participation, subject to their statutory rights and Zero Alpha Fitness’s duty to take reasonable care.\n\nRequired fields: child full name and date of birth; selected Youngstars or Teenstars option; guardian full legal name; relationship; payer email collected by Stripe or the account-claim flow; authority declaration; typed signature; the exact acceptance statements; signature date/time; membership/order reference; addendum document ID and version.\n",
  },
} as const;

export type CheckoutAcceptanceId =
  | "membership_contract"
  | "privacy_notice"
  | "adult_participant_waiver"
  | "guardian_youth_addendum"
  | "guardian_authority"
  | "recurring_payment_authority"
  | "immediate_performance";

export type CheckoutAcceptanceStatement = {
  id: CheckoutAcceptanceId;
  statement: string;
  documentKeys: readonly CheckoutDocumentKey[];
};

export type CheckoutSignerRole =
  | "adult_participant_and_payer"
  | "youth_guardian_and_payer";

export type CommercialPlanSnapshot = {
  catalogueSchemaVersion: number;
  planKey: PlanKey;
  planName: string;
  audience: PlanAudience;
  summary: string;
  amountPence: number;
  currency: typeof BILLING_CURRENCY;
  billingInterval: "month";
  billingIntervalCount: 1;
  monthlyAnchorDayOfMonth: number;
  joiningFeePence: number;
  minimumTermMonths: number;
  trialDays: number;
  vatRegistered: boolean;
  automaticTaxEnabled: boolean;
  grantsAlphaWodAccess: boolean;
  minAge: number;
  maxAge: number | null;
  cancellationNoticeDays: number;
  pauseAllowed: boolean;
};

export function resolveCheckoutDocuments(planKey: PlanKey): CheckoutDocument[] {
  const plan = getPlan(planKey);
  const keys: CheckoutDocumentKey[] = [
    "membershipTerms",
    "cancellationPolicy",
    "privacyNotice",
    plan.audience === "youth" ? "guardianAddendum" : "adultWaiver",
  ];
  return keys.map((key) => ({...CHECKOUT_DOCUMENTS[key]}));
}

export function resolveCheckoutAcceptanceStatements(
  planKey: PlanKey
): CheckoutAcceptanceStatement[] {
  const plan = getPlan(planKey);
  const common: CheckoutAcceptanceStatement[] = [
    {
      id: "membership_contract",
      statement: "I have read and agree to the Membership Terms and the Cancellation, Refund and Cooling-off Policy. I confirm that the participant and payer or guardian details I supplied are accurate.",
      documentKeys: ["membershipTerms", "cancellationPolicy"],
    },
    {
      id: "privacy_notice",
      statement: "I acknowledge that I have received and read the Privacy Notice explaining how personal information is used.",
      documentKeys: ["privacyNotice"],
    },
    ...(plan.audience === "youth" ? [
      {
        id: "guardian_authority" as const,
        statement: "I confirm that I am aged 18 or over, I am the named child's parent or legal guardian or otherwise have lawful authority to enrol them, and I am the payer.",
        documentKeys: [] as CheckoutDocumentKey[],
      },
      {
        id: "guardian_youth_addendum" as const,
        statement: "I have read and agree to the Parent/Guardian Consent and Youth Membership Addendum. I understand the activities and inherent risks and consent to the child's participation, subject to their statutory rights and Zero Alpha Fitness's duty to take reasonable care.",
        documentKeys: ["guardianAddendum"] as CheckoutDocumentKey[],
      },
    ] : [
      {
        id: "adult_participant_waiver" as const,
        statement: "I confirm that I am the named participant, I am aged 18 or over, and I have read and understood the Adult Participant Waiver and Risk Acknowledgement. I understand the activities and inherent risks and choose to participate, subject to my statutory rights and Zero Alpha Fitness's duty to take reasonable care.",
        documentKeys: ["adultWaiver"] as CheckoutDocumentKey[],
      },
    ]),
    {
      id: "recurring_payment_authority",
      statement: `I authorise the amount Stripe shows today and future recurring monthly payments for ${plan.name} on the billing schedule shown at checkout. The standard monthly price is ${formatPence(plan.amountPence)}; Stripe will show any verified promotion and when the standard price resumes. This authority is subject to my cancellation and statutory rights.`,
      documentKeys: [],
    },
    {
      id: "immediate_performance",
      statement: POLICY_TEXT.coolingOffConsent,
      documentKeys: [],
    },
  ];
  return common;
}

export function resolveCheckoutSignerRole(planKey: PlanKey): CheckoutSignerRole {
  return getPlan(planKey).audience === "youth" ?
    "youth_guardian_and_payer" : "adult_participant_and_payer";
}

export function createCommercialPlanSnapshot(planKey: PlanKey): CommercialPlanSnapshot {
  const plan = getPlan(planKey);
  return {
    catalogueSchemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    planKey: plan.key,
    planName: plan.name,
    audience: plan.audience,
    summary: plan.summary,
    amountPence: plan.amountPence,
    currency: plan.currency,
    billingInterval: "month",
    billingIntervalCount: 1,
    monthlyAnchorDayOfMonth: BILLING_POLICY.monthlyAnchorDayOfMonth,
    joiningFeePence: BILLING_POLICY.joiningFeePence,
    minimumTermMonths: BILLING_POLICY.minimumTermMonths,
    trialDays: BILLING_POLICY.trialDays,
    vatRegistered: BILLING_POLICY.vatRegistered,
    automaticTaxEnabled: BILLING_POLICY.automaticTaxEnabled,
    grantsAlphaWodAccess: plan.grantsAlphaWodAccess,
    minAge: plan.minAge,
    maxAge: plan.maxAge,
    cancellationNoticeDays: BILLING_POLICY.cancellationNoticeDays,
    pauseAllowed: BILLING_POLICY.pauseAllowed,
  };
}

export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = true;

export const PLAN_LIST: MembershipPlan[] = PLAN_KEYS.map((key) => MEMBERSHIP_PLANS[key]);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function getPlan(key: PlanKey): MembershipPlan {
  return MEMBERSHIP_PLANS[key];
}

/** One-off founding presale boundary used only to choose truthful UI copy. */
export function isFoundingPresale(nowMillis: number = Date.now()): boolean {
  return nowMillis < PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
}

/** Mirrors the server funnel rule: under 12 is Youngstars, 12+ is Teenstars. */
export function resolveYouthPlanForAge(age: number): PlanKey | null {
  if (!Number.isInteger(age)) return null;
  if (age >= 4 && age < 12) return "youth_youngstars";
  if (age >= 12 && age <= 16) return "youth_teenstars";
  return null;
}

export function isAgeEligibleForPlan(plan: MembershipPlan, age: number): boolean {
  if (!Number.isInteger(age) || age < 0) return false;
  if (age < plan.minAge) return false;
  if (plan.maxAge !== null && age > plan.maxAge) return false;
  return true;
}

/**
 * Age used only to steer the form and show an early warning. The callable
 * recomputes it from the same date of birth and is the authority for
 * eligibility.
 */
export function resolveDisplayAge(dateOfBirthIso: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirthIso)) return null;

  const [year, month, day] = dateOfBirthIso.split("-").map(Number);
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return null;
  }

  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (dob > today) return null;

  let age = today.getUTCFullYear() - year;
  const hadBirthday =
    today.getUTCMonth() > dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthday) age -= 1;

  return age >= 0 && age <= 120 ? age : null;
}

export function formatPlanPrice(plan: MembershipPlan): string {
  const pounds = plan.amountPence / 100;
  const formatted = Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2);
  return `£${formatted}`;
}

/** Formats pence exactly as the server does in stored acceptance statements. */
export function formatPence(amountPence: number): string {
  return `£${(amountPence / 100).toFixed(2)}`;
}
