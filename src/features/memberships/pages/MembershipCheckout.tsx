import React, { useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import {
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  COMPANY,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  formatPlanPrice,
  isAgeEligibleForPlan,
  isPlanKey,
  resolveDisplayAge,
  resolveYouthPlanForAge,
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

export default function MembershipCheckout() {
  const { planKey } = useParams<{ planKey: string }>();
  const { user, appUser, loading: authLoading } = useAuth();

  const [participantFullName, setParticipantFullName] = useState("");
  const [participantDateOfBirth, setParticipantDateOfBirth] = useState("");
  const [participantIsPayer, setParticipantIsPayer] = useState(true);
  const [guardianFullName, setGuardianFullName] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [guardianConfirmsAuthority, setGuardianConfirmsAuthority] = useState(false);
  const [acceptedDocuments, setAcceptedDocuments] = useState(false);
  const [immediatePerformanceRequested, setImmediatePerformanceRequested] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const checkoutAttempt = useRef<CheckoutAttempt | null>(null);

  const plan = isPlanKey(planKey) ? MEMBERSHIP_PLANS[planKey] : null;
  const isYouth = plan?.audience === "youth";

  const age = useMemo(
    () => resolveDisplayAge(participantDateOfBirth),
    [participantDateOfBirth]
  );

  // The server re-derives the age and rejects a mismatch. This only steers the
  // form so a guardian is not sent to Stripe with the wrong youth band.
  const suggestedYouthPlan = age === null ? null : resolveYouthPlanForAge(age);
  const ageMismatch =
    plan !== null && age !== null && !isAgeEligibleForPlan(plan, age);

  if (!plan) return <Navigate to="/memberships" replace />;

  const payerName = appUser?.name?.trim() || user?.displayName?.trim() || "";
  const typedSignature = signedName.trim();
  const guardianReady = !isYouth || (
    guardianFullName.trim().length >= 2 &&
    guardianRelationship.trim().length >= 2 &&
    guardianConfirmsAuthority
  );
  const canSubmit =
    (CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION ||
      LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED) &&
    participantFullName.trim().length >= 2 &&
    age !== null &&
    !ageMismatch &&
    guardianReady &&
    acceptedDocuments &&
    immediatePerformanceRequested &&
    typedSignature.length >= 2 &&
    !authLoading &&
    !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    let submittedAttemptId: string | undefined;

    try {
      setSubmitting(true);
      setError("");

      const checkoutDetails: CheckoutDetails = {
        planKey: plan.key,
        participantFullName: participantFullName.trim(),
        participantDateOfBirth,
        participantIsPayer: isYouth ? false : participantIsPayer,
        signedName: typedSignature,
        acceptedDocuments: true,
        immediatePerformanceRequested,
        ...(isYouth
          ? {
              guardianFullName: guardianFullName.trim(),
              guardianRelationship: guardianRelationship.trim(),
              guardianConfirmsAuthority: true,
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
      if (typeof code === "string" &&
        (code.includes("deadline-exceeded") || code.includes("failed-precondition"))) {
        clearCheckoutAttempt(submittedAttemptId);
        checkoutAttempt.current = null;
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
          {formatPlanPrice(plan)} per month. {POLICY_TEXT.prorationRule}
        </p>

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
              You do not need an account to join. Complete your details and pay, then
              create your account to claim the membership.{" "}
              <Link to="/" className="underline underline-offset-4">
                Already train with us? Sign in first
              </Link>{" "}
              and your purchase is linked automatically.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div className={CARD}>
            <p className={EYEBROW}>Participant</p>

            <label className="mt-5 block">
              <span className={LABEL}>Participant full name</span>
              <input
                className={FIELD}
                value={participantFullName}
                onChange={(event) => setParticipantFullName(event.target.value)}
                autoComplete="name"
                maxLength={160}
                required
              />
            </label>

            <label className="mt-5 block">
              <span className={LABEL}>Participant date of birth</span>
              <input
                type="date"
                className={FIELD}
                value={participantDateOfBirth}
                onChange={(event) => setParticipantDateOfBirth(event.target.value)}
                required
              />
            </label>

            {age !== null && (
              <p className="mt-3 text-xs text-white/45">Age {age}</p>
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
              <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-white/70">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={participantIsPayer}
                  onChange={(event) => setParticipantIsPayer(event.target.checked)}
                />
                <span>
                  I am the participant{payerName ? ` (${payerName})` : ""}. Untick this if
                  you are paying for another adult; they will accept their own waiver and we
                  will link their access.
                </span>
              </label>
            )}
          </div>

          {isYouth && (
            <div className={CARD}>
              <p className={EYEBROW}>Parent or guardian</p>
              <p className="mt-4 text-sm leading-7 text-white/70">
                {POLICY_TEXT.guardianRequirement}
              </p>

              <label className="mt-5 block">
                <span className={LABEL}>Your full name</span>
                <input
                  className={FIELD}
                  value={guardianFullName}
                  onChange={(event) => setGuardianFullName(event.target.value)}
                  maxLength={160}
                  required
                />
              </label>

              <label className="mt-5 block">
                <span className={LABEL}>Relationship to participant</span>
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
                  checked={guardianConfirmsAuthority}
                  onChange={(event) => setGuardianConfirmsAuthority(event.target.checked)}
                />
                <span>
                  I confirm I am this participant&rsquo;s parent or legal guardian, or an
                  adult with lawful authority to enter this arrangement for them, and I am
                  the payer.
                </span>
              </label>
            </div>
          )}

          <div className={CARD}>
            <p className={EYEBROW}>Documents and signature</p>

            <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-white/70">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={acceptedDocuments}
                onChange={(event) => setAcceptedDocuments(event.target.checked)}
              />
              <span>
                I have read and accept the Membership Terms, the Cancellation, Refund and
                Cooling-off Policy, and the Privacy Notice
                {isYouth ? ", and the Parent/Guardian Consent and Youth Membership Addendum" : ""}
                .
              </span>
            </label>

            {/*
              The immediate-performance request is a separate, unticked control.
              It must never be bundled with the document acceptance above,
              because a pre-ticked or combined consent would not be a valid
              express request under the Consumer Contracts Regulations.
            */}
            <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-white/70">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={immediatePerformanceRequested}
                onChange={(event) =>
                  setImmediatePerformanceRequested(event.target.checked)
                }
              />
              <span>{POLICY_TEXT.coolingOffConsent}</span>
            </label>

            <label className="mt-6 block">
              <span className={LABEL}>Type your full name to sign</span>
              <input
                className={FIELD}
                value={signedName}
                onChange={(event) => setSignedName(event.target.value)}
                maxLength={160}
                required
              />
            </label>
          </div>

          <div className={CARD}>
            <p className={EYEBROW}>What happens next</p>
            <p className="mt-4 text-sm leading-7 text-white/70">
              {POLICY_TEXT.prorationAuthority}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/70">
              {POLICY_TEXT.cancellationRule}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/70">{POLICY_TEXT.refund}</p>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
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
                "Starting checkout…" : "Subscribe and pay"}
          </button>

          <p className="text-center text-xs leading-6 text-white/40">
            You will review the exact initial charge, the monthly price and the first full
            billing date on Stripe&rsquo;s secure checkout before paying.
          </p>
        </form>
      </div>
    </div>
  );
}
