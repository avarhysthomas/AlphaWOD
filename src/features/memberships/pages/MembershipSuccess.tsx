import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { COMPANY, MEMBERSHIP_PLANS, POLICY_TEXT } from "../../../lib/membershipPlans";
import {
  claimMembership,
  clearPendingClaim,
  getMyMemberships,
  rememberPendingClaim,
  type MyMembership,
} from "../services/membership";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;

/**
 * The approved confirmation wording for the membership just bought. Only Adult
 * Unlimited unlocks the app, so every other plan gets the onboarding message
 * rather than one implying immediate access.
 */
function successMessageFor(membership: MyMembership | null): string {
  if (!membership) return POLICY_TEXT.adultOtherSuccess;
  if (MEMBERSHIP_PLANS[membership.planKey]?.audience === "youth") {
    return POLICY_TEXT.youthSuccess;
  }
  return membership.grantsAlphaWodAccess && membership.participantIsPayer
    ? POLICY_TEXT.adultUnlimitedSuccess
    : POLICY_TEXT.adultOtherSuccess;
}

export default function MembershipSuccess() {
  const { user, refreshAppUser } = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");

  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [settled, setSettled] = useState(false);
  const [claimError, setClaimError] = useState("");
  const cancelled = useRef(false);

  // Held locally so the buyer can create an account now and claim from the
  // membership page, without the checkout session id being lost on the way.
  useEffect(() => {
    if (sessionId) rememberPendingClaim(sessionId);
  }, [sessionId]);

  const attach = useCallback(async () => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (cancelled.current) return;

      try {
        // Fulfilment runs on the Stripe webhook, which can land a moment after
        // the browser returns, so the claim is retried rather than failed.
        await claimMembership(sessionId ?? undefined);
        clearPendingClaim();
      } catch (error) {
        const code = (error as {code?: string} | null)?.code ?? "";
        if (code.includes("permission-denied") || code.includes("deadline-exceeded")) {
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

      try {
        const result = await getMyMemberships();
        const latest =
          result.memberships.find(
            (entry) => entry.state === "active" || entry.state === "past_due_grace"
          ) ?? result.memberships[0] ?? null;

        if (latest) {
          if (cancelled.current) return;
          setMembership(latest);
          setSettled(true);
          await refreshAppUser();
          return;
        }
      } catch (error) {
        console.error("Could not load membership after checkout:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!cancelled.current) setSettled(true);
  }, [sessionId, refreshAppUser]);

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
          <p className={EYEBROW}>Payment confirmed</p>
          <h1 className="mt-4 font-heading text-3xl uppercase tracking-[0.06em] text-white sm:text-4xl">
            {membership?.planName ?? "Thank you"}
          </h1>

          <p className="mt-5 text-sm leading-7 text-white/75">
            {successMessageFor(membership)}
          </p>

          {!user && (
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
              <Link
                to="/dashboard"
                className="block text-center text-sm text-white/50 underline underline-offset-4"
              >
                Go to AlphaWOD
              </Link>
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
