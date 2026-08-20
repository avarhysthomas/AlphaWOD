import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { hasAlphaWodAccess } from "../../../context/authUser";
import {
  COMPANY,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  isFoundingPresale,
  isPlanKey,
} from "../../../lib/membershipPlans";
import {
  claimMembership,
  clearCheckoutAttempt,
  clearPendingClaim,
  getMyMemberships,
  readCheckoutAttemptId,
  readPendingClaim,
  readPendingClaimVerifier,
  rememberPendingClaim,
  formatUnixDate,
  type MyMembership,
} from "../services/membership";
import MembershipDiscountSummary from "../components/MembershipDiscountSummary";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;

function activeSuccessMessageFor(membership: MyMembership): string {
  if (MEMBERSHIP_PLANS[membership.planKey]?.audience === "youth") {
    return POLICY_TEXT.youthSuccess;
  }
  return membership.grantsAlphaWodAccess && membership.participantIsPayer
    ? POLICY_TEXT.adultUnlimitedSuccess
    : POLICY_TEXT.adultOtherSuccess;
}

/** Never let an old payment receipt imply that suspended or ended access is live. */
function membershipPresentation(
  membership: MyMembership,
  existingAppAccess: boolean
): {
  eyebrow: string;
  message: string;
  appAccessAvailable: boolean;
} {
  if (membership.providerContractStatus === "manual_review") {
    return {
      eyebrow: "Membership needs attention",
      message: `The Stripe subscription details need staff review before access can continue. Contact ${COMPANY.supportEmail} if you need help.`,
      appAccessAvailable: false,
    };
  }
  if ((membership.state === "active" || membership.state === "past_due_grace") &&
    membership.grantsAlphaWodAccess && membership.participantIsPayer &&
    membership.entitlementProjectionStatus !== "applied") {
    return {
      eyebrow: "Payment confirmed — access pending",
      message: `Payment is confirmed, but Zero Alpha App access has not been safely applied yet. Contact ${COMPANY.supportEmail} if it does not appear shortly.`,
      appAccessAvailable: false,
    };
  }
  switch (membership.state) {
  case "scheduled": {
    const serviceStartsAt = membership.serviceStartsAt ??
      membership.firstPaymentAt ?? membership.billingCycleAnchor ?? null;
    const serviceStart = serviceStartsAt ? formatUnixDate(serviceStartsAt) : "1 September 2026";
    const accessMessage = membership.grantsAlphaWodAccess && membership.participantIsPayer
      ? existingAppAccess
        ? " Your existing Zero Alpha App access is available now and continues independently of this scheduled membership."
        : " This membership will not unlock Zero Alpha App access until that first payment succeeds."
      : " We’ll email you with the details you need before your first session.";
    return {
      eyebrow: "Membership scheduled",
      message: `Your payment method is saved and nothing was charged today. Your membership starts on ${serviceStart}, when your first monthly payment is due.${accessMessage}`,
      appAccessAvailable: existingAppAccess,
    };
  }
  case "active":
    return {
      eyebrow: "Payment confirmed",
      message: activeSuccessMessageFor(membership),
      appAccessAvailable: membership.grantsAlphaWodAccess && membership.participantIsPayer,
    };
  case "past_due_grace":
    return {
      eyebrow: "Membership active — payment needs attention",
      message: "Your membership remains active during a short payment grace period. Review your billing details from the membership page to avoid suspension.",
      appAccessAvailable: membership.grantsAlphaWodAccess && membership.participantIsPayer,
    };
  case "incomplete":
    return {
      eyebrow: "Payment pending",
      message: "Stripe is still confirming payment for this membership. Its current status is shown on your membership page; access has not been confirmed yet.",
      appAccessAvailable: false,
    };
  case "past_due_suspended":
    return {
      eyebrow: "Membership suspended",
      message: "This membership is currently suspended because payment is overdue. Review your billing details from the membership page.",
      appAccessAvailable: false,
    };
  case "disputed":
    return {
      eyebrow: "Membership suspended",
      message: `This membership is suspended while a payment dispute is open. Contact ${COMPANY.supportEmail} if you need help.`,
      appAccessAvailable: false,
    };
  case "cancelled":
    return {
      eyebrow: "Membership ended",
      message: "This membership is cancelled. Its recorded billing and cancellation details remain available on your membership page.",
      appAccessAvailable: false,
    };
  case "revoked":
    return {
      eyebrow: "Membership needs attention",
      message: `Access for this membership has been revoked. Contact ${COMPANY.supportEmail} if you need help.`,
      appAccessAvailable: false,
    };
  }
}

export default function MembershipSuccess() {
  const { user, appUser, loading, refreshAppUser } = useAuth();
  const [params] = useSearchParams();
  const returnedSessionId = params.get("session_id");
  const [rememberedSessionId] = useState(() => readPendingClaim());
  const sessionId = returnedSessionId ?? rememberedSessionId;
  const returnedPlan = params.get("plan");
  const returnedPlanKey = isPlanKey(returnedPlan) ? returnedPlan : null;
  const [checkoutAttemptId] = useState(
    () => readCheckoutAttemptId() ?? readPendingClaimVerifier()
  );

  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [settled, setSettled] = useState(false);
  const [claimError, setClaimError] = useState("");
  const cancelled = useRef(false);
  const presentation = membership ? membershipPresentation(
    membership,
    hasAlphaWodAccess(appUser)
  ) : null;
  const presale = isFoundingPresale();
  const isAlphaWodAccountJourney = membership
    ? membership.planKey === "adult_unlimited" &&
      membership.grantsAlphaWodAccess &&
      membership.participantIsPayer
    : returnedPlanKey === "adult_unlimited";

  // Held locally so the buyer can create an account now and claim from the
  // membership page, without the checkout session id being lost on the way.
  useEffect(() => {
    if (!sessionId) return;
    clearCheckoutAttempt();
    // The Session id is not sufficient to claim a purchase, but it is still
    // sensitive billing metadata. Keep it out of copied URLs, browser history
    // and referrer headers once this page has captured it.
    const url = new URL(window.location.href);
    url.searchParams.delete("session_id");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || loading) return;
    // Keep the verifier until attachment actually succeeds or fails
    // terminally. That lets an existing member log in, refresh during webhook
    // lag, and continue the same verified claim instead of losing it early.
    if (!user) rememberPendingClaim(sessionId, checkoutAttemptId);
  }, [sessionId, checkoutAttemptId, user, loading]);

  const attach = useCallback(async () => {
    if (!sessionId) {
      setSettled(true);
      return;
    }
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (cancelled.current) return;

      try {
        // Fulfilment runs on the Stripe webhook, which can land a moment after
        // the browser returns, so the claim is retried rather than failed.
        const claim = await claimMembership(
          sessionId,
          checkoutAttemptId ?? undefined
        );
        clearPendingClaim();
        const result = await getMyMemberships();
        const exact = result.memberships.find((entry) =>
          claim.claimed.includes(entry.subscriptionId)
        ) ?? null;

        if (exact) {
          if (cancelled.current) return;
          setMembership(exact);
          setSettled(true);
          await refreshAppUser();
          return;
        }
      } catch (error) {
        const code = (error as {code?: string} | null)?.code ?? "";
        const terminal = [
          "permission-denied",
          "deadline-exceeded",
          "failed-precondition",
          "already-exists",
        ].some((value) => code.includes(value));
        if (terminal) {
          clearPendingClaim();
          if (!cancelled.current) {
            setClaimError(
              (error as Error).message ||
                "This membership could not be linked to your account."
            );
            setSettled(true);
          }
          return;
        }
        // not-found simply means the webhook has not fulfilled it yet.
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!cancelled.current) setSettled(true);
  }, [sessionId, checkoutAttemptId, refreshAppUser]);

  useEffect(() => {
    cancelled.current = false;
    if (user) void attach();
    return () => {
      cancelled.current = true;
    };
  }, [user, attach]);

  return (
    <div className="carbon-fiber-bg min-h-screen text-[#f4f0ea]">
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12">
        <div className={`w-full ${CARD}`}>
          <p className={EYEBROW}>
            {presentation?.eyebrow ?? (sessionId ? "Checkout received" : "Checkout link unavailable")}
          </p>
          <h1 className="mt-4 font-heading text-3xl uppercase tracking-[0.06em] text-white sm:text-4xl">
            {membership?.planName ?? (sessionId ? "Thank you" : "We need the checkout link")}
          </h1>

          <p className="mt-5 text-sm leading-7 text-white/75">
            {presentation
              ? presentation.message
              : sessionId
                ? presale
                  ? isAlphaWodAccountJourney
                    ? "Thanks for registering. Nothing was charged today. Your payment method is saved and the membership is scheduled to start with its first payment on 1 September 2026. Zero Alpha App access will not be unlocked before that payment succeeds."
                    : "Thanks for registering. Nothing was charged today. Your payment method is saved and the membership is scheduled to start with its first payment on 1 September 2026. We’ll send the details by email; there’s nothing else you need to do on this page."
                  : isAlphaWodAccountJourney
                    ? "We’re confirming the exact membership from this checkout. No access or payment status is shown as confirmed until that finishes."
                    : "Thanks for registering. We’re confirming your membership and will send the details by email. There’s nothing else you need to do on this page."
                : `This page has no checkout reference. Return to your membership page or contact ${COMPANY.supportEmail}.`}
          </p>

          {membership && (
            <MembershipDiscountSummary
              planKey={membership.planKey}
              discount={membership.discount}
              paymentSchedule={membership.paymentSchedule}
              firstPaymentAt={membership.firstPaymentAt}
              className="mt-6"
            />
          )}

          {sessionId && !loading && !user && isAlphaWodAccountJourney && (
            <>
              <div className="mt-7 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">
                  Use Zero Alpha App with your membership
                </p>
                <p className="mt-3 text-sm leading-7 text-amber-50/85">
                  New to Zero Alpha App? Create an account with the same email address you just
                  used at Stripe checkout. Already have an account? Log in and we&rsquo;ll link this
                  membership to it automatically.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                <Link
                  to="/signup"
                  className="block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black"
                >
                  Create Zero Alpha App account
                </Link>
                <Link
                  to="/"
                  className="block text-center text-sm text-white/50 underline underline-offset-4"
                >
                  Log in to Zero Alpha App
                </Link>
              </div>
            </>
          )}

          {user && !settled && (
            <p className="mt-5 text-xs leading-6 text-white/40">
              Linking your membership to this account…
            </p>
          )}

          {user && claimError && (
            <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
              {claimError}
            </div>
          )}

          {user && settled && !membership && !claimError && (
            <p className="mt-5 text-xs leading-6 text-white/40">
              Your membership is still being confirmed. It will appear on your membership
              page shortly. If it does not, contact {COMPANY.supportEmail}.
            </p>
          )}

          {user && isAlphaWodAccountJourney && (
            <div className="mt-8 space-y-3">
              <Link
                to="/account/membership"
                className="block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black"
              >
                View my membership
              </Link>
              {presentation?.appAccessAvailable === true && (
                <Link
                  to="/dashboard"
                  className="block text-center text-sm text-white/50 underline underline-offset-4"
                >
                  Go to Zero Alpha App
                </Link>
              )}
            </div>
          )}

          <p className="mt-7 text-xs leading-6 text-white/40">
            A confirmation email will be sent from {COMPANY.confirmationSender} with your
            plan, amount due today, first payment date, any applied discount and cancellation
            information. Questions:{" "}
            {COMPANY.supportEmail}.
          </p>
        </div>
      </div>
    </div>
  );
}
