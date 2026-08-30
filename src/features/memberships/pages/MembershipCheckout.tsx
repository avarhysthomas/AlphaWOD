import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import {
  COMPANY,
  CONDITIONING_SLOT_OPTIONS,
  EXISTING_MEMBER_OFFER,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  YOUTH_FAMILY_OFFER,
  formatPence,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  formatPlanPrice,
  isFoundingPresale,
  isAgeEligibleForPlan,
  isPlanKey,
  resolveDisplayAge,
  resolveYouthMonthlyPricing,
  type CheckoutAcceptanceId,
  type ConditioningSlotKey,
} from "../../../lib/membershipPlans";
import {
  clearCheckoutAttempt,
  createMembershipCheckoutSession,
  resolveCheckoutAttempt,
  type CheckoutAttempt,
  type CheckoutDetails,
} from "../services/membership";
import {MEMBERSHIP_PURCHASE_AVAILABILITY} from "../purchaseAvailability";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";
const FIELD =
  "mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45";
const PRIMARY_ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100";
const SECONDARY_ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-100/25 px-4 py-3 text-sm font-semibold text-amber-50 transition hover:border-amber-100/50 hover:bg-amber-100/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100";

type CheckoutBlockReason =
  | "checkout_in_progress"
  | "checkout_processing"
  | "membership_exists";

type AdditionalParticipantInput = {
  id: number;
  fullName: string;
  dateOfBirth: string;
};

function resolveCheckoutBlockReason(error: unknown): CheckoutBlockReason | null {
  const candidate = error as {details?: {reason?: unknown} | null} | null;
  const reason = candidate?.details?.reason;
  return reason === "checkout_in_progress" ||
    reason === "checkout_processing" ||
    reason === "membership_exists" ? reason : null;
}

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
  const [selectedConditioningSlots, setSelectedConditioningSlots] = useState<
    ConditioningSlotKey[]
  >([]);
  const [participantDateOfBirth, setParticipantDateOfBirth] = useState("");
  const [additionalParticipants, setAdditionalParticipants] = useState<
    AdditionalParticipantInput[]
  >([]);
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
  const [checkoutBlockReason, setCheckoutBlockReason] =
    useState<CheckoutBlockReason | null>(null);
  const checkoutAttempt = useRef<CheckoutAttempt | null>(null);
  const checkoutBlockRef = useRef<HTMLDivElement | null>(null);
  const nextParticipantId = useRef(2);
  const acceptedPlanKey = useRef(planKey);

  useEffect(() => {
    if (checkoutBlockReason) checkoutBlockRef.current?.focus();
  }, [checkoutBlockReason]);

  useEffect(() => {
    if (acceptedPlanKey.current === planKey) return;

    acceptedPlanKey.current = planKey;
    setAcceptedStatements({});
    setSelectedConditioningSlots([]);
    checkoutAttempt.current = null;
    clearCheckoutAttempt();
    setError("");
    setBillingPolicyChanged(false);
    setCheckoutBlockReason(null);
  }, [planKey]);

  const plan = isPlanKey(planKey) ? MEMBERSHIP_PLANS[planKey] : null;
  const {
    checkoutEnabled,
    conditioningCheckoutEnabled,
    documentsApproved,
    localTestJourneyEnabled,
  } = MEMBERSHIP_PURCHASE_AVAILABILITY;
  const isYouth = plan?.audience === "youth";
  const isConditioning = plan?.key === "adult_conditioning";
  const participantCount = isYouth ? 1 + additionalParticipants.length : 1;
  const presale = isFoundingPresale();
  const promotionCodeAvailable =
    presale && plan?.key === EXISTING_MEMBER_OFFER.planKey;
  const checkoutDocuments = useMemo(
    () => plan ? resolveCheckoutDocuments(plan.key) : [],
    [plan]
  );
  const checkoutStatements = useMemo(
    () => plan ? resolveCheckoutAcceptanceStatements(plan.key, participantCount) : [],
    [participantCount, plan]
  );

  const age = useMemo(
    () => resolveDisplayAge(participantDateOfBirth),
    [participantDateOfBirth]
  );

  const ageMismatch =
    plan?.audience === "adult" && age !== null && !isAgeEligibleForPlan(plan, age);
  const additionalParticipantAges = useMemo(
    () => additionalParticipants.map((participant) =>
      resolveDisplayAge(participant.dateOfBirth)
    ),
    [additionalParticipants]
  );

  const addYouthParticipant = () => {
    if (!isYouth || participantCount >= YOUTH_FAMILY_OFFER.maximumParticipants) return;
    const id = nextParticipantId.current;
    nextParticipantId.current += 1;
    setAdditionalParticipants((current) => [
      ...current,
      {id, fullName: "", dateOfBirth: ""},
    ]);
    // The legal statements change from one child to multiple children.
    setAcceptedStatements({});
  };

  const updateAdditionalParticipant = (
    id: number,
    field: "fullName" | "dateOfBirth",
    value: string
  ) => {
    setAdditionalParticipants((current) => current.map((participant) =>
      participant.id === id ? {...participant, [field]: value} : participant
    ));
    // These acknowledgements confirm the accuracy of every named child's
    // details. A post-acceptance edit therefore needs a fresh confirmation.
    setAcceptedStatements({});
  };

  const removeAdditionalParticipant = (id: number) => {
    setAdditionalParticipants((current) => current.filter(
      (participant) => participant.id !== id
    ));
    // Require a fresh confirmation because the named participants changed.
    setAcceptedStatements({});
  };

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
  const additionalParticipantsReady = !isYouth || additionalParticipants.every(
    (participant, index) => {
      const participantAge = additionalParticipantAges[index] ?? null;
      return participant.fullName.trim().length >= 2 &&
        participantAge !== null;
    }
  );
  const allStatementsAccepted = checkoutStatements.every(({id}) =>
    acceptedStatements[id] === true
  );
  const canSubmit =
    (isConditioning ? conditioningCheckoutEnabled : checkoutEnabled) &&
    (!isConditioning || selectedConditioningSlots.length === 2) &&
    participantFullName.trim().length >= 2 &&
    age !== null &&
    !ageMismatch &&
    additionalParticipantsReady &&
    guardianReady &&
    allStatementsAccepted &&
    signatureMatches &&
    !authLoading &&
    !billingPolicyChanged &&
    !checkoutBlockReason &&
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
        checkoutSchemaVersion: 5,
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
        ...(isConditioning ? { selectedConditioningSlots } : {}),
        ...(promotionCodeAvailable && promotionCode.trim()
          ? {promotionCode: promotionCode.trim()}
          : {}),
        ...(isYouth
          ? {
              guardianFullName: guardianFullName.trim(),
              guardianRelationship: guardianRelationship.trim(),
              ...(additionalParticipants.length > 0 ? {
                additionalParticipants: additionalParticipants.map((participant) => ({
                  fullName: participant.fullName.trim(),
                  dateOfBirth: participant.dateOfBirth,
                })),
              } : {}),
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
      const blockReason = resolveCheckoutBlockReason(submitError);
      if (blockReason) {
        // These are authoritative, recoverable server states. Keep the browser's
        // attempt verifier so the original Checkout can still be reconciled.
        setCheckoutBlockReason(blockReason);
        setError("");
        setSubmitting(false);
        return;
      }
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

  const youthPricing = isYouth ? resolveYouthMonthlyPricing(plan, participantCount) : null;
  const familySavingPence = youthPricing ?
    youthPricing.standardMonthlyPence - youthPricing.recurringMonthlyPence : 0;
  const childWord = participantCount === 1 ? "child" : "children";

  if (isConditioning && !conditioningCheckoutEnabled) {
    return (
      <ConditioningCheckoutPreview
        planName={plan.name}
        planSummary={plan.summary}
        price={formatPlanPrice(plan)}
        selectedSlots={selectedConditioningSlots}
        onToggle={(slot) => {
          setSelectedConditioningSlots((current) => {
            if (current.includes(slot)) return current.filter((value) => value !== slot);
            return current.length < 2 ? [...current, slot] : current;
          });
          setAcceptedStatements({});
          checkoutAttempt.current = null;
        }}
      />
    );
  }

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-10 sm:px-8">
        <Link to="/memberships" className="text-sm text-white/45 underline underline-offset-4">
          Back to memberships
        </Link>

        <p className={`mt-7 ${EYEBROW}`}>Join</p>
        <h1 className={`mt-3 font-heading text-[2.5rem] leading-[1] tracking-[0.02em] text-white sm:text-[3rem] ${isYouth ? "" : "uppercase"}`}>
          {plan.name}
        </h1>
        {isYouth && (
          <p className="mt-4 text-sm leading-7 text-white/70">{plan.summary}</p>
        )}
        <p className="mt-4 text-sm leading-7 text-white/70">
          {isYouth
            ? `${formatPlanPrice(plan)} per child, per month. `
            : `${formatPlanPrice(plan)} per month. `}
          {presale
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

        {localTestJourneyEnabled && (
          <div className="mt-7 rounded-[28px] border border-sky-400/30 bg-sky-400/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
              Local Stripe test journey
            </p>
            <p className="mt-3 text-sm leading-7 text-sky-50/85">
              Test mode only: use a Stripe test card. No real payment or live membership
              will be created. {!documentsApproved &&
                "The documents shown below are still drafts."}
            </p>
          </div>
        )}

        {!checkoutEnabled && (
          <div className="mt-7 rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
              Checkout closed
            </p>
            <p className="mt-3 text-sm leading-7 text-amber-50/85">
              {documentsApproved
                ? "Online membership purchase is currently closed. "
                : "The membership documents are still in legal review, so online purchase is not open. "}
              Contact{" "}
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
                ? "Complete registration and Stripe checkout first. Afterwards, you can create a new Zero Alpha App account or log in to an existing one, and we’ll securely link this membership."
                : "You do not need a Zero Alpha App account to buy this membership. Complete registration and Stripe checkout below, then you’ll return to a simple confirmation page."}
            </p>
          </div>
        )}

        {user && (
          <div className="mt-7 rounded-[28px] border border-white/10 bg-[#151311] p-6">
            <p className="text-sm leading-7 text-white/70">
              You&rsquo;re signed in{payerName ? ` as ${payerName}` : ""}. Complete the
              same registration and Stripe checkout journey below; afterwards, this
              membership will be linked to your existing Zero Alpha App account automatically.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {isConditioning ? (
            <section className="rounded-2xl border border-white/10 bg-[#151311] p-6" aria-labelledby="active-conditioning-slots-title">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="active-conditioning-slots-title" className="font-heading text-3xl uppercase text-white">Choose two weekly slots</h2>
                  <p className="mt-2 text-sm leading-6 text-white/55">Your app will allow bookings only for these two recurring conditioning sessions.</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">
                    App access includes Schedule, Profile and Membership only; Dashboard/WOD,
                    Training, Leaderboards and performance stats are not included.
                  </p>
                </div>
                <p aria-live="polite" className="text-sm font-black text-amber-200">{selectedConditioningSlots.length} of 2 selected</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {CONDITIONING_SLOT_OPTIONS.map((slot) => {
                  const selected = selectedConditioningSlots.includes(slot.key);
                  const disabled = !selected && selectedConditioningSlots.length === 2;
                  return (
                    <button
                      key={slot.key}
                      type="button"
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() => {
                        setSelectedConditioningSlots((current) =>
                          current.includes(slot.key)
                            ? current.filter((value) => value !== slot.key)
                            : current.length < 2 ? [...current, slot.key] : current
                        );
                        setAcceptedStatements({});
                        checkoutAttempt.current = null;
                      }}
                      className={[
                        "rounded-xl border px-5 py-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-amber-200",
                        selected
                          ? "border-amber-200 bg-amber-100 text-black"
                          : disabled
                            ? "cursor-not-allowed border-white/5 bg-black/20 text-white/25"
                            : "border-white/12 bg-black/30 text-white hover:border-white/25",
                      ].join(" ")}
                    >
                      <span className="block text-sm font-black">{slot.day}</span>
                      <span className={`mt-1 block font-heading text-3xl ${selected ? "text-black" : "text-white"}`}>{slot.time}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          {promotionCodeAvailable && (
            <div className="rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
                  Discount Code
                </span>
                <input
                  className={`${FIELD} border-amber-200/20 bg-black/30 focus:border-amber-100/55`}
                  value={promotionCode}
                  onChange={(event) => setPromotionCode(event.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={64}
                />
              </label>
            </div>
          )}

          {isYouth && (
            <div className={CARD}>
              <p className={EYEBROW}>Paying adult</p>
              <p className="mt-4 text-sm leading-7 text-white/70">
                Enter the details of the adult who will pay for {participantCount === 1
                  ? "this child’s membership"
                  : "these children’s memberships"}. {POLICY_TEXT.guardianRequirement}
              </p>

              <label className="mt-5 block">
                <span className={LABEL}>Paying adult&rsquo;s full name</span>
                <input
                  className={FIELD}
                  value={guardianFullName}
                  onChange={(event) => {
                    setGuardianFullName(event.target.value);
                    setAcceptedStatements({});
                  }}
                  autoComplete="name"
                  maxLength={160}
                  required
                />
              </label>

              <label className="mt-5 block">
                <span className={LABEL}>
                  Relationship to {participantCount === 1 ? "child" : "children"}
                </span>
                <input
                  className={FIELD}
                  value={guardianRelationship}
                  onChange={(event) => {
                    setGuardianRelationship(event.target.value);
                    setAcceptedStatements({});
                  }}
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

            {isYouth ? (
              <>
                <p className="mt-4 text-sm leading-7 text-white/70">
                  Add up to {YOUTH_FAMILY_OFFER.maximumParticipants} children from the same
                  programme. The {YOUTH_FAMILY_OFFER.percentOff}% family discount is applied
                  automatically when you register 2 or more children.
                </p>

                <div className="mt-6 border-y border-white/10">
                  <fieldset className="py-6">
                    <legend className="sr-only">Child 1 details</legend>
                    <div className="flex items-center justify-between gap-4">
                      <p
                        id="child-1-heading"
                        className="text-sm font-semibold text-white"
                      >
                        Child 1
                      </p>
                    </div>

                    <label className="mt-5 block">
                      <span className={LABEL}>Child 1 full name</span>
                      <input
                        className={FIELD}
                        value={participantFullName}
                        onChange={(event) => {
                          setParticipantFullName(event.target.value);
                          setAcceptedStatements({});
                        }}
                        autoComplete="off"
                        maxLength={160}
                        required
                      />
                    </label>

                    <label className="mt-5 block">
                      <span className={LABEL}>Child 1 date of birth</span>
                      <input
                        type="date"
                        className={FIELD}
                        value={participantDateOfBirth}
                        onChange={(event) => {
                          setParticipantDateOfBirth(event.target.value);
                          setAcceptedStatements({});
                        }}
                        aria-describedby={participantDateOfBirth ? "child-1-age-status" : undefined}
                        aria-invalid={participantDateOfBirth.length > 0 &&
                          age === null}
                        required
                      />
                    </label>

                    {participantDateOfBirth && age === null && (
                      <p id="child-1-age-status" className="mt-3 text-sm text-red-200">
                        Enter a valid date of birth that is not in the future.
                      </p>
                    )}
                    {age !== null && (
                      <p id="child-1-age-status" className="mt-3 text-xs text-white/45">
                        Child 1 age {age}
                      </p>
                    )}
                  </fieldset>

                  {additionalParticipants.map((participant, index) => {
                    const childNumber = index + 2;
                    const participantAge = additionalParticipantAges[index] ?? null;
                    const ageStatusId = `child-${participant.id}-age-status`;

                    return (
                      <fieldset
                        key={participant.id}
                        className="border-t border-white/10 py-6"
                      >
                        <legend className="sr-only">Child {childNumber} details</legend>
                        <div className="flex items-center justify-between gap-4">
                          <p
                            id={`child-${participant.id}-heading`}
                            className="text-sm font-semibold text-white"
                          >
                            Child {childNumber}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeAdditionalParticipant(participant.id)}
                            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-white/60 underline decoration-white/25 underline-offset-4 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                            aria-label={`Remove child ${childNumber}`}
                          >
                            Remove
                          </button>
                        </div>

                        <label className="mt-5 block">
                          <span className={LABEL}>Child {childNumber} full name</span>
                          <input
                            className={FIELD}
                            value={participant.fullName}
                            onChange={(event) => updateAdditionalParticipant(
                              participant.id,
                              "fullName",
                              event.target.value
                            )}
                            autoComplete="off"
                            maxLength={160}
                            required
                          />
                        </label>

                        <label className="mt-5 block">
                          <span className={LABEL}>Child {childNumber} date of birth</span>
                          <input
                            type="date"
                            className={FIELD}
                            value={participant.dateOfBirth}
                            onChange={(event) => updateAdditionalParticipant(
                              participant.id,
                              "dateOfBirth",
                              event.target.value
                            )}
                            aria-describedby={participant.dateOfBirth ? ageStatusId : undefined}
                            aria-invalid={participant.dateOfBirth.length > 0 &&
                              participantAge === null}
                            required
                          />
                        </label>

                        {participant.dateOfBirth && participantAge === null && (
                          <p id={ageStatusId} className="mt-3 text-sm text-red-200">
                            Enter a valid date of birth that is not in the future.
                          </p>
                        )}
                        {participantAge !== null && (
                          <p id={ageStatusId} className="mt-3 text-xs text-white/45">
                            Child {childNumber} age {participantAge}
                          </p>
                        )}
                      </fieldset>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={addYouthParticipant}
                    disabled={participantCount >= YOUTH_FAMILY_OFFER.maximumParticipants}
                    className="min-h-11 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-white transition hover:border-white/35 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-white/35"
                  >
                    {participantCount >= YOUTH_FAMILY_OFFER.maximumParticipants
                      ? "Maximum children added"
                      : "Add another child"}
                  </button>
                  <p className="text-xs text-white/45">
                    {participantCount} of {YOUTH_FAMILY_OFFER.maximumParticipants} children
                  </p>
                </div>

                {youthPricing && (
                  <section
                    aria-labelledby="monthly-price-summary"
                    aria-live="polite"
                    className="mt-7 border-t border-white/10 pt-6"
                  >
                    <h2 id="monthly-price-summary" className="text-sm font-semibold text-white">
                      Monthly price for {participantCount} {childWord}
                    </h2>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex items-baseline justify-between gap-4 text-white/60">
                        <dt>{participantCount} {childWord} × {formatPence(plan.amountPence)}</dt>
                        <dd>{formatPence(youthPricing.standardMonthlyPence)}</dd>
                      </div>
                      {youthPricing.familyDiscountApplies && (
                        <div className="flex items-baseline justify-between gap-4 text-emerald-200">
                          <dt>Family discount ({YOUTH_FAMILY_OFFER.percentOff}%)</dt>
                          <dd>−{formatPence(familySavingPence)}</dd>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between gap-4 border-t border-white/10 pt-3 text-white">
                        <dt className="font-semibold">Recurring monthly total</dt>
                        <dd className="font-heading text-2xl">
                          {formatPence(youthPricing.recurringMonthlyPence)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-xs leading-6 text-white/50">
                      {youthPricing.familyDiscountApplies
                        ? `The automatic ${YOUTH_FAMILY_OFFER.percentOff}% family discount applies to the full monthly subtotal while this membership includes 2 or more children.`
                        : `Add a second child in the same programme to receive ${YOUTH_FAMILY_OFFER.percentOff}% off the full monthly total.`}
                    </p>
                  </section>
                )}
              </>
            ) : (
              <>
                <label className="mt-5 block">
                  <span className={LABEL}>Your full name</span>
                  <input
                    className={FIELD}
                    value={participantFullName}
                    onChange={(event) => {
                      setParticipantFullName(event.target.value);
                      setAcceptedStatements({});
                    }}
                    autoComplete="name"
                    maxLength={160}
                    required
                  />
                </label>

                <label className="mt-5 block">
                  <span className={LABEL}>Your date of birth</span>
                  <input
                    type="date"
                    className={FIELD}
                    value={participantDateOfBirth}
                    onChange={(event) => {
                      setParticipantDateOfBirth(event.target.value);
                      setAcceptedStatements({});
                    }}
                    required
                  />
                </label>

                {age !== null && (
                  <p className="mt-3 text-xs text-white/45">Age {age}</p>
                )}

                {ageMismatch && (
                  <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                    {plan.name} is for ages {plan.minAge}
                    {plan.maxAge ? ` to ${plan.maxAge}` : " and over"}, and this date of
                    birth gives age {age}.
                  </div>
                )}
                <p className="mt-5 text-sm leading-6 text-white/55">
                  Adult memberships can only be purchased for yourself.
                </p>
              </>
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
              Your bank may open its app to approve your payment method. Keep this browser
              tab open, approve it in your banking app, then return here. Don&rsquo;t restart
              checkout on another phone.
            </p>
            <p className="mt-3 text-sm leading-7 text-white/70">
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

          {checkoutBlockReason && (
            <div
              ref={checkoutBlockRef}
              tabIndex={-1}
              role={checkoutBlockReason === "checkout_processing" ? "status" : "alert"}
              aria-labelledby="checkout-block-title"
              aria-describedby="checkout-block-description"
              className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-amber-50 outline-none focus-visible:ring-2 focus-visible:ring-amber-100"
            >
              <h2 id="checkout-block-title" className="font-semibold">
                {checkoutBlockReason === "checkout_in_progress"
                  ? "Checkout unavailable"
                  : checkoutBlockReason === "checkout_processing"
                    ? "Checkout submitted"
                    : "Membership already set up"}
              </h2>
              <p id="checkout-block-description" className="mt-2 text-sm leading-6 text-amber-50/85">
                {checkoutBlockReason === "checkout_in_progress"
                  ? "A checkout or membership setup already exists for these details. It may have completed after approval in your banking app. Do not start it again on another phone. Check the original browser tab and your email first. If there is still no confirmation after a few minutes, check again or contact us."
                  : checkoutBlockReason === "checkout_processing"
                    ? "Stripe has submitted your checkout and we’re waiting for confirmation. Do not start another checkout while it is being confirmed."
                    : "This account or participant already has an active or scheduled membership. We haven’t opened another checkout."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {checkoutBlockReason === "checkout_in_progress" && (
                  <button
                    type="button"
                    onClick={() => window.history.go(0)}
                    className={PRIMARY_ACTION}
                  >
                    Check again
                  </button>
                )}
                {checkoutBlockReason === "checkout_processing" && (
                  <Link to="/account/membership" className={PRIMARY_ACTION}>
                    Check membership status
                  </Link>
                )}
                {checkoutBlockReason === "membership_exists" && user && (
                  <Link to="/account/membership" className={PRIMARY_ACTION}>
                    Manage membership
                  </Link>
                )}
                {(checkoutBlockReason !== "membership_exists" || !user) && (
                  <a
                    href={`mailto:${COMPANY.supportEmail}`}
                    className={checkoutBlockReason === "checkout_processing" ||
                      checkoutBlockReason === "checkout_in_progress" ?
                      SECONDARY_ACTION : PRIMARY_ACTION}
                  >
                    Contact support
                  </a>
                )}
                {checkoutBlockReason === "membership_exists" && user && (
                  <a href={`mailto:${COMPANY.supportEmail}`} className={SECONDARY_ACTION}>
                    Contact support
                  </a>
                )}
              </div>
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
            {!checkoutEnabled ?
              "Online purchase closed" : authLoading ?
              "Checking account…" : submitting ?
                "Starting Stripe checkout…" : checkoutBlockReason === "checkout_in_progress" ?
                  "Checkout unavailable" : checkoutBlockReason === "checkout_processing" ?
                    "Checkout confirmation pending" : checkoutBlockReason === "membership_exists" ?
                      "Membership already set up" : presale ?
                        "Continue to Stripe — £0 today" : "Subscribe and pay"}
          </button>

          <p className="text-center text-xs leading-6 text-white/40">
            {!checkoutEnabled
              ? "Online checkout is closed. No payment can be started from this page."
              : presale
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

function ConditioningCheckoutPreview({
  planName,
  planSummary,
  price,
  selectedSlots,
  onToggle,
}: {
  planName: string;
  planSummary: string;
  price: string;
  selectedSlots: ConditioningSlotKey[];
  onToggle: (slot: ConditioningSlotKey) => void;
}) {
  return (
    <main className="carbon-fiber-bg min-h-screen overflow-x-hidden px-5 py-10 text-[#f4f0ea] sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link to="/memberships" className="text-sm text-white/55 underline underline-offset-4">
          Back to memberships
        </Link>
        <h1 className="mt-7 font-heading text-5xl uppercase leading-none text-white sm:text-6xl">
          {planName}
        </h1>
        <p className="mt-4 text-lg font-bold text-[#f4b16d]">{price} per month</p>
        <p className="mt-4 max-w-xl text-sm leading-7 text-white/68">{planSummary}</p>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#151311] p-6 sm:p-7" aria-labelledby="conditioning-slots-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="conditioning-slots-title" className="font-heading text-3xl uppercase text-white">
                Choose two weekly slots
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/52">
                These are the two recurring sessions this membership will allow you to book.
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/65">
                App access includes Schedule, Profile and Membership only; Dashboard/WOD,
                Training, Leaderboards and performance stats are not included.
              </p>
            </div>
            <p aria-live="polite" className="text-sm font-black text-[#f4b16d]">
              {selectedSlots.length} of 2 selected
            </p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {CONDITIONING_SLOT_OPTIONS.map((slot) => {
              const selected = selectedSlots.includes(slot.key);
              const disabled = !selected && selectedSlots.length === 2;
              return (
                <button
                  key={slot.key}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onToggle(slot.key)}
                  className={[
                    "rounded-xl border px-5 py-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#f4b16d]",
                    selected
                      ? "border-[#f4b16d] bg-[#f4b16d] text-black"
                      : disabled
                      ? "cursor-not-allowed border-white/5 bg-black/20 text-white/28"
                      : "border-white/12 bg-black/30 text-white hover:border-white/25 hover:bg-black/45",
                  ].join(" ")}
                >
                  <span className="block text-sm font-black">{slot.day}</span>
                  <span className={selected ? "mt-1 block font-heading text-3xl text-black" : "mt-1 block font-heading text-3xl text-white"}>{slot.time}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-6 text-amber-50">
          <h2 className="font-heading text-3xl uppercase">Coming soon</h2>
          <p className="mt-3 text-sm leading-7 text-amber-50/80">
            Online purchase for Conditioning Only is closed while its plan-specific terms,
            waiver wording and Stripe price are reviewed. No payment can be started here yet.
          </p>
          <a href={`mailto:${COMPANY.supportEmail}`} className="mt-5 inline-flex min-h-[48px] items-center rounded-xl bg-amber-100 px-5 py-3 text-sm font-black text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-white">
            Ask about Conditioning Only
          </a>
        </section>
      </div>
    </main>
  );
}
