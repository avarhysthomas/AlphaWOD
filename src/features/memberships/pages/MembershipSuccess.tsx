import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { COMPANY, MEMBERSHIP_PLANS, POLICY_TEXT } from "../../../lib/membershipPlans";
import {
  claimMembership,
  clearCheckoutAttempt,
  clearPendingClaim,
  getMyMemberships,
  readCheckoutAttemptId,
  rememberPendingClaim,
  type MyMembership,
} from "../services/membership";

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
function membershipPresentation(membership: MyMembership): {
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
      message: `Payment is confirmed, but AlphaWOD access has not been safely applied yet. Contact ${COMPANY.supportEmail} if it does not appear shortly.`,
      appAccessAvailable: false,
    };
  }
  switch (membership.state) {
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
  const { user, loading, refreshAppUser } = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [checkoutAttemptId] = useState(() => readCheckoutAttemptId());

  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [settled, setSettled] = useState(false);
  const [claimError, setClaimError] = useState("");
  const cancelled = useRef(false);
  const presentation = membership ? membershipPresentation(membership) : null;

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
    // A buyer who was already signed in is attached by the webhook itself. Do
    // not leave that completed checkout behind as a pending claim: the claim
    // callable quite correctly ignores memberships that already have a payer.
    if (!sessionId || loading) return;
    if (user) clearPendingClaim();
    else rememberPendingClaim(sessionId, checkoutAttemptId);
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
                ? "We’re confirming the exact membership from this checkout. No access or payment status is shown as confirmed until that finishes."
                : `This page has no checkout reference. Return to your membership page or contact ${COMPANY.supportEmail}.`}
          </p>

          {sessionId && !loading && !user && (
            <>
              <div className="mt-7 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">
                  One step left
                </p>
                <p className="mt-3 text-sm leading-7 text-amber-50/85">
                  Create your account with the same email address you just paid with, and
                  your membership will be linked to it automatically.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                <Link
                  to="/signup"
                  className="block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black"
                >
                  Create my account
                </Link>
                <Link
                  to="/"
                  className="block text-center text-sm text-white/50 underline underline-offset-4"
                >
                  I already have an account
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

          {user && (
            <div className="mt-8 space-y-3">
              <Link
                to="/account/membership"
                className="block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black"
              >
                View my membership
              </Link>
              {(!presentation || presentation.appAccessAvailable) && (
                <Link
                  to="/dashboard"
                  className="block text-center text-sm text-white/50 underline underline-offset-4"
                >
                  Go to AlphaWOD
                </Link>
              )}
            </div>
          )}

          <p className="mt-7 text-xs leading-6 text-white/40">
            A confirmation email will be sent from {COMPANY.confirmationSender} with your
            plan, amounts, next payment date and cancellation information. Questions:{" "}
            {COMPANY.supportEmail}.
          </p>
        </div>
      </div>
    </div>
  );
}
