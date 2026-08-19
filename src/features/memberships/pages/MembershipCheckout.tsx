import React, { useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import {
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  COMPANY,
  EXISTING_MEMBER_OFFER,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  formatPlanPrice,
  isFoundingPresale,
  isAgeEligibleForPlan,
  isPlanKey,
  resolveDisplayAge,
  resolveYouthPlanForAge,
  type CheckoutAcceptanceId,
} from "../../../lib/membershipPlans";
import {
  clearCheckoutAttempt,
  createMembershipCheckoutSession,
  resolveCheckoutAttempt,
  type CheckoutAttempt,
  type CheckoutDetails,
} from "../services/membership";
import { LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED } from "../localTestJourney";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";
const FIELD =
  "mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45";

function isBillingPolicyChanged(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    details?: {reason?: unknown} | null;
  } | null;

  return typeof candidate?.code === "string" &&
    candidate.code.includes("failed-precondition") &&
    candidate.details?.reason === "billing_policy_changed";
}

export default function MembershipCheckout() {
  const { planKey } = useParams<{ planKey: string }>();
  const { user, appUser, loading: authLoading } = useAuth();

  const [participantFullName, setParticipantFullName] = useState("");
  const [participantDateOfBirth, setParticipantDateOfBirth] = useState("");
  const [guardianFullName, setGuardianFullName] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [acceptedStatements, setAcceptedStatements] = useState<
    Partial<Record<CheckoutAcceptanceId, boolean>>
  >({});
  const [signedName, setSignedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [billingPolicyChanged, setBillingPolicyChanged] = useState(false);
  const checkoutAttempt = useRef<CheckoutAttempt | null>(null);

  const plan = isPlanKey(planKey) ? MEMBERSHIP_PLANS[planKey] : null;
  const isYouth = plan?.audience === "youth";
  const presale = isFoundingPresale();
  const promotionCodeAvailable =
    presale && plan?.key === EXISTING_MEMBER_OFFER.planKey;
  const checkoutDocuments = useMemo(
    () => plan ? resolveCheckoutDocuments(plan.key) : [],
    [plan]
  );
  const checkoutStatements = useMemo(
    () => plan ? resolveCheckoutAcceptanceStatements(plan.key) : [],
    [plan]
  );

  const age = useMemo(
    () => resolveDisplayAge(participantDateOfBirth),
    [participantDateOfBirth]
  );

  // The server re-derives the age and rejects a mismatch. This only steers the
  // form so a guardian is not sent to Stripe with the wrong youth band.
  const suggestedYouthPlan = age === null ? null : resolveYouthPlanForAge(age);
  const ageMismatch =
    plan !== null && age !== null && !isAgeEligibleForPlan(plan, age);

  const setStatementAccepted = (id: CheckoutAcceptanceId, checked: boolean) => {
    setAcceptedStatements((current) => ({...current, [id]: checked}));
  };

  if (!plan) return <Navigate to="/memberships" replace />;

  const payerName = appUser?.name?.trim() || user?.displayName?.trim() || "";
  const typedSignature = signedName.trim();
  const expectedSignature = (isYouth ? guardianFullName : participantFullName).trim();
  const comparableName = (value: string) => value.normalize("NFKC")
    .trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
  const signatureMatches = typedSignature.length >= 2 &&
    comparableName(typedSignature) === comparableName(expectedSignature);
  const guardianReady = !isYouth || (
    guardianFullName.trim().length >= 2 &&
    guardianRelationship.trim().length >= 2
  );
  const allStatementsAccepted = checkoutStatements.every(({id}) =>
    acceptedStatements[id] === true
  );
  const canSubmit =
    (CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION ||
      LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED) &&
    participantFullName.trim().length >= 2 &&
    age !== null &&
    !ageMismatch &&
    guardianReady &&
    allStatementsAccepted &&
    signatureMatches &&
    !authLoading &&
    !billingPolicyChanged &&
    !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    let submittedAttemptId: string | undefined;

    try {
      setSubmitting(true);
      setError("");
      setBillingPolicyChanged(false);

      const checkoutDetails: CheckoutDetails = {
        // This is deliberately the same snapshot that chose every price/date
        // shown on this render. The callable fails closed if the cutoff moved.
        expectedBillingMode: presale ? "presale_deferred" : "standard",
        planKey: plan.key,
        participantFullName: participantFullName.trim(),
        participantDateOfBirth,
        // Adult memberships are self-purchase only. Youth memberships attach
        // the child as participant and collect the paying adult separately.
        participantIsPayer: !isYouth,
        signedName: typedSignature,
        acceptedStatementIds: checkoutStatements.map(({id}) => id),
        ...(promotionCodeAvailable && promotionCode.trim()
          ? {promotionCode: promotionCode.trim()}
          : {}),
        ...(isYouth
          ? {
              guardianFullName: guardianFullName.trim(),
              guardianRelationship: guardianRelationship.trim(),
            }
          : {}),
      };
      const attempt = await resolveCheckoutAttempt(
        checkoutDetails,
        checkoutAttempt.current,
        { payerUid: user?.uid ?? null }
      );
      checkoutAttempt.current = attempt;
      submittedAttemptId = attempt.id;

      const result = await createMembershipCheckoutSession({
        checkoutAttemptId: attempt.id,
        ...checkoutDetails,
      });

      if (!result.sessionUrl) {
        throw new Error("Stripe did not return a checkout URL.");
      }
      window.location.assign(result.sessionUrl);
    } catch (submitError: unknown) {
      const code = (submitError as {code?: unknown} | null)?.code;
      const policyChanged = isBillingPolicyChanged(submitError);
      if (typeof code === "string" &&
        !policyChanged &&
        (code.includes("deadline-exceeded") || code.includes("failed-precondition"))) {
        clearCheckoutAttempt(submittedAttemptId);
        checkoutAttempt.current = null;
      }
      if (policyChanged) {
        // Keep the original attempt bound to the policy the customer reviewed.
        // A refresh renders the new policy, whose fingerprint creates a new one.
        setBillingPolicyChanged(true);
        setError("");
        setSubmitting(false);
        return;
      }
      const message =
        submitError instanceof Error ? submitError.message : "Could not start checkout.";
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-10 sm:px-8">
        <Link to="/memberships" className="text-sm text-white/45 underline underline-offset-4">
          Back to memberships
        </Link>

        <p className={`mt-7 ${EYEBROW}`}>Join</p>
        <h1 className="mt-3 font-heading text-[2.5rem] uppercase leading-[1] tracking-[0.02em] text-white sm:text-[3rem]">
          {plan.name}
        </h1>
        <p className="mt-4 text-sm leading-7 text-white/70">
          {formatPlanPrice(plan)} per month. {presale
            ? POLICY_TEXT.presaleRule
            : POLICY_TEXT.prorationRule}
        </p>

        {presale && (
          <dl className="mt-7 grid gap-5 border-y border-white/10 py-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">Today</dt>
              <dd className="mt-1 font-semibold text-white">£0 charged</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">Starts</dt>
              <dd className="mt-1 font-semibold text-white">1 September 2026</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">First payment</dt>
              <dd className="mt-1 font-semibold text-white">1 September 2026</dd>
            </div>
          </dl>
        )}

        {!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION &&
          LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED && (
          <div className="mt-7 rounded-[28px] border border-sky-400/30 bg-sky-400/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
              Local Stripe test journey
            </p>
            <p className="mt-3 text-sm leading-7 text-sky-50/85">
              Test mode only: use a Stripe test card. No real payment or live membership
              will be created. The documents shown below are still drafts.
            </p>
          </div>
        )}

        {!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION &&
          !LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED && (
          <div className="mt-7 rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
              Checkout closed
            </p>
            <p className="mt-3 text-sm leading-7 text-amber-50/85">
              The membership documents are still in legal review, so online purchase is not
              open. Contact{" "}
              <a
                className="underline decoration-amber-400/40 underline-offset-4"
                href={`mailto:${COMPANY.supportEmail}`}
              >
                {COMPANY.supportEmail}
              </a>{" "}
              to join.
            </p>
          </div>
        )}

        {!user && (
          <div className="mt-7 rounded-[28px] border border-white/10 bg-[#151311] p-6">
            <p className="text-sm leading-7 text-white/70">
              {plan.grantsAlphaWodAccess
                ? "Complete registration and Stripe checkout first. Afterwards, you can create a new AlphaWOD account or log in to an existing one, and we’ll securely link this membership."
                : "You do not need an AlphaWOD account to buy this membership. Complete registration and Stripe checkout below, then you’ll return to a simple confirmation page."}
            </p>
          </div>
        )}

        {user && (
          <div className="mt-7 rounded-[28px] border border-white/10 bg-[#151311] p-6">
            <p className="text-sm leading-7 text-white/70">
              You&rsquo;re signed in{payerName ? ` as ${payerName}` : ""}. Complete the
              same registration and Stripe checkout journey below; afterwards, this
              membership will be linked to your existing AlphaWOD account automatically.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {promotionCodeAvailable && (
            <div className="rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
                Existing-member offer
              </p>
              <p id="promotion-code-hint" className="mt-3 text-sm leading-7 text-amber-50/85">
                Enter the existing-member discount code to get £5 off each of your
                first three monthly payments: £55 in September, October and November,
                then £60 from December. Leave this blank if you do not have the code.
              </p>
              <label className="mt-5 block">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100/65">
                  Discount code <span className="normal-case tracking-normal">(optional)</span>
                </span>
                <input
                  className={`${FIELD} border-amber-200/20 bg-black/30 focus:border-amber-100/55`}
                  value={promotionCode}
                  onChange={(event) => setPromotionCode(event.target.value)}
                  aria-describedby="promotion-code-hint"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={64}
                />
              </label>
              <p className="mt-3 text-xs leading-6 text-amber-100/60">
                We&rsquo;ll verify and apply your code before opening Stripe.
              </p>
            </div>
          )}

          {isYouth && (
            <div className={CARD}>
              <p className={EYEBROW}>Paying adult</p>
              <p className="mt-4 text-sm leading-7 text-white/70">
                Enter the details of the adult who will pay for this child&rsquo;s
                membership. {POLICY_TEXT.guardianRequirement}
              </p>

              <label className="mt-5 block">
                <span className={LABEL}>Paying adult&rsquo;s full name</span>
                <input
                  className={FIELD}
                  value={guardianFullName}
                  onChange={(event) => setGuardianFullName(event.target.value)}
                  autoComplete="name"
                  maxLength={160}
                  required
                />
              </label>

              <label className="mt-5 block">
                <span className={LABEL}>Relationship to child</span>
                <input
                  className={FIELD}
                  value={guardianRelationship}
                  onChange={(event) => setGuardianRelationship(event.target.value)}
                  placeholder="Parent, legal guardian"
                  maxLength={80}
                  required
                />
              </label>

              <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-white/70">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={acceptedStatements.guardian_authority === true}
                  onChange={(event) => setStatementAccepted(
                    "guardian_authority",
                    event.target.checked
                  )}
                />
                <span>{checkoutStatements.find(
                  ({id}) => id === "guardian_authority"
                )?.statement}</span>
              </label>
            </div>
          )}

          <div className={CARD}>
            <p className={EYEBROW}>{isYouth ? "Child details" : "Your details"}</p>

            <label className="mt-5 block">
              <span className={LABEL}>
                {isYouth ? "Child’s full name" : "Your full name"}
              </span>
              <input
                className={FIELD}
                value={participantFullName}
                onChange={(event) => setParticipantFullName(event.target.value)}
                autoComplete={isYouth ? "off" : "name"}
                maxLength={160}
                required
              />
            </label>

            <label className="mt-5 block">
              <span className={LABEL}>
                {isYouth ? "Child’s date of birth" : "Your date of birth"}
              </span>
              <input
                type="date"
                className={FIELD}
                value={participantDateOfBirth}
                onChange={(event) => setParticipantDateOfBirth(event.target.value)}
                required
              />
            </label>

            {age !== null && (
              <p className="mt-3 text-xs text-white/45">
                {isYouth ? "Child age" : "Age"} {age}
              </p>
            )}

            {ageMismatch && (
              <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                {plan.name} is for ages {plan.minAge}
                {plan.maxAge ? ` to ${plan.maxAge}` : " and over"}, and this date of birth
                gives age {age}.
                {suggestedYouthPlan && suggestedYouthPlan !== plan.key && (
                  <>
                    {" "}
                    <Link
                      to={`/memberships/checkout/${suggestedYouthPlan}`}
                      className="underline underline-offset-4"
                    >
                      Switch to {MEMBERSHIP_PLANS[suggestedYouthPlan].name}
                    </Link>
                    .
                  </>
                )}
              </div>
            )}
            {!isYouth && (
              <p className="mt-5 text-sm leading-6 text-white/55">
                Adult memberships can only be purchased for yourself.
              </p>
            )}
          </div>

          <div className={CARD}>
            <p className={EYEBROW}>Documents and signature</p>

            <p className="mt-4 text-sm leading-7 text-white/70">
              Open and read each versioned document. Your confirmation email will contain
              the same immutable text and attach a separate copy of every document shown.
            </p>
            <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
              {checkoutDocuments.map((document) => (
                <details key={document.key} id={`document-${document.key}`} className="py-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-white marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>{document.title}</span>
                      <span className="break-all text-xs font-normal text-white/45">
                        {document.version}
                      </span>
                    </span>
                  </summary>
                  <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-black/35 p-4 font-sans text-sm leading-6 text-white/65">
                    {document.content}
                  </pre>
                  <a
                    href={document.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm text-white/75 underline decoration-white/30 underline-offset-4 hover:text-white"
                  >
                    Open the versioned plain-text copy
                  </a>
                </details>
              ))}
            </div>

            <fieldset className="mt-6 space-y-5">
              <legend className="text-sm font-semibold text-white">
                Confirm each statement separately
              </legend>
              {checkoutStatements
                .filter(({id}) => id !== "guardian_authority")
                .map(({id, statement}) => (
                  <label key={id} className="flex items-start gap-3 text-sm leading-6 text-white/70">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={acceptedStatements[id] === true}
                      onChange={(event) => setStatementAccepted(id, event.target.checked)}
                    />
                    <span>{statement}</span>
                  </label>
                ))}
            </fieldset>

            <label className="mt-6 block">
              <span className={LABEL}>
                {isYouth
                  ? "Type the paying adult’s full name to sign"
                  : "Type your full name to sign"}
              </span>
              <input
                className={FIELD}
                value={signedName}
                onChange={(event) => setSignedName(event.target.value)}
                aria-describedby="signature-hint"
                aria-invalid={typedSignature.length >= 2 && !signatureMatches}
                maxLength={160}
                required
              />
            </label>
            <p
              id="signature-hint"
              className={`mt-3 text-xs leading-5 ${
                typedSignature.length >= 2 && !signatureMatches ?
                  "text-red-200" : "text-white/45"
              }`}
            >
              {typedSignature.length >= 2 && !signatureMatches
                ? `This must match ${isYouth ? "the paying adult’s" : "your"} full name above.`
                : `This electronic signature must match ${isYouth ? "the paying adult’s" : "your"} full name above.`}
            </p>
          </div>

          <div className={CARD}>
            <p className={EYEBROW}>What happens next</p>
            <p className="mt-4 text-sm leading-7 text-white/70">
              {presale ? POLICY_TEXT.prorationAuthority : POLICY_TEXT.prorationRule}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/70">
              {POLICY_TEXT.cancellationRule}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/70">{POLICY_TEXT.refund}</p>
          </div>

          {billingPolicyChanged && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-amber-50"
            >
              <p className="font-semibold">Payment details changed</p>
              <p className="mt-2 text-sm leading-6 text-amber-50/85">
                The payment schedule changed while this page was open. Refresh and review
                today&rsquo;s charge and the first payment date before continuing.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-xl bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100"
              >
                Refresh and review
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-2xl bg-white px-5 py-4 text-sm font-bold uppercase tracking-[0.14em] text-black transition disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/45"
          >
            {authLoading ?
              "Checking account…" : submitting ?
                "Starting Stripe checkout…" : presale ?
                  "Continue to Stripe — £0 today" : "Subscribe and pay"}
          </button>

          <p className="text-center text-xs leading-6 text-white/40">
            {presale
              ? "Stripe will show £0 due today, save your payment method and show 1 September 2026 as the first monthly payment date. Do not confirm if those details are different."
              : "You will review the exact initial charge, monthly price and first full billing date on Stripe’s secure checkout before paying."}
          </p>
        </form>

        <footer className="mt-12 border-t border-white/10 pt-6 text-xs leading-6 text-white/40">
          <p>{COMPANY.legalName}, company number {COMPANY.companyNumber}.</p>
          <p>Trading and contact address: {COMPANY.address}.</p>
          <p>Registered office: {COMPANY.registeredOffice}.</p>
          <p>Registered in: {COMPANY.registrationJurisdiction}.</p>
        </footer>
      </div>
    </div>
  );
}
