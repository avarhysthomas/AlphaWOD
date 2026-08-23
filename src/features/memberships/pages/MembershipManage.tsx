import React, { useCallback, useEffect, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { hasAlphaWodAccess } from "../../../context/authUser";
import { COMPANY, POLICY_TEXT } from "../../../lib/membershipPlans";
import {
  MEMBERSHIP_STATE_LABEL,
  claimMembership,
  clearPendingClaim,
  createCustomerPortalSession,
  formatIsoDate,
  formatUnixDate,
  getMyMemberships,
  readPendingClaim,
  readPendingClaimVerifier,
  requestMembershipCancellation,
  type CancellationOutcome,
  type CancellationRequestKind,
  type CancellationRequestStatus,
  type MyMembership,
} from "../services/membership";
import MembershipDiscountSummary from "../components/MembershipDiscountSummary";
import {resolveParticipantFullNames} from "../components/membershipPresentation";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

function CancellationPreview({
  preview,
  mode = "standard",
  planName,
  participantFullNames,
}: {
  preview: CancellationOutcome;
  mode?: "cancel_before_start" | "standard";
  planName: string;
  participantFullNames: string[];
}) {
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5 text-sm leading-7 text-white/70">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
        If you cancel now
      </p>
      {mode === "cancel_before_start" ? (
        <p className="mt-3">
          This membership has not started, so cancelling now stops it immediately.
          Nothing will be charged and no membership access will be activated.
        </p>
      ) : preview.noticeDeadlineMet ? (
        <p className="mt-3">
          Your request would arrive {preview.noticeDaysGiven} calendar days before{" "}
          {formatIsoDate(preview.nextBillingDate)}, which meets the 14 day deadline. No
          payment would be taken on {formatIsoDate(preview.nextBillingDate)} and your
          access would end on {formatIsoDate(preview.accessEndsOnDate)}.
        </p>
      ) : (
        <p className="mt-3">
          Your request would arrive {preview.noticeDaysGiven} calendar days before{" "}
          {formatIsoDate(preview.nextBillingDate)}, which is less than the 14 day
          deadline. The payment on {formatIsoDate(preview.nextBillingDate)} would still be
          due, and your access would continue for that paid month and end on{" "}
          {formatIsoDate(preview.accessEndsOnDate)}.
        </p>
      )}
      {mode === "standard" && (
        <p className="mt-3 text-xs text-white/40">
          The deadline for the {formatIsoDate(preview.nextBillingDate)} payment is{" "}
          {formatIsoDate(preview.noticeDeadlineDate)}.
        </p>
      )}
      <FamilyCancellationScope
        planName={planName}
        participantFullNames={participantFullNames}
      />
    </div>
  );
}

function formatParticipantList(participantFullNames: string[]): string {
  if (participantFullNames.length < 2) return participantFullNames[0] ?? "";
  if (participantFullNames.length === 2) {
    return `${participantFullNames[0]} and ${participantFullNames[1]}`;
  }
  return `${participantFullNames.slice(0, -1).join(", ")}, and ${
    participantFullNames[participantFullNames.length - 1]
  }`;
}

function FamilyCancellationScope({
  planName,
  participantFullNames,
  recorded = false,
}: {
  planName: string;
  participantFullNames: string[];
  recorded?: boolean;
}) {
  if (participantFullNames.length < 2) return null;

  return (
    <p className="mt-3 font-semibold">
      {recorded ? "This cancellation applies to" : "Submitting this request cancels"}{" "}
      the whole {planName} family subscription. The places for{" "}
      {formatParticipantList(participantFullNames)} {recorded ? "all end" : "will all end"}{" "}
      with it.
      {!recorded && " Individual children cannot be removed online."}
    </p>
  );
}

function formatReceiptTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function cancellationKindLabel(kind: CancellationRequestKind): string {
  if (kind === "cooling_off") return "Cooling-off cancellation";
  if (kind === "presale_withdrawal") return "Cancellation before start";
  return "Membership cancellation";
}

export default function MembershipManage() {
  const { user, appUser, refreshAppUser } = useAuth();
  const appAccessAvailable = hasAlphaWodAccess(appUser);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailClaimRequested = searchParams.get("claim") === "email";
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [preview, setPreview] = useState<CancellationOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingCheckoutAttemptId, setPendingCheckoutAttemptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getMyMemberships();
      setMemberships(result.memberships);
      setPreview(result.cancellationPreview);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load your memberships."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // A membership bought before sign-up is claimed here: either from the
  // checkout session id held since payment, or by matching the verified email
  // Stripe billed. Both are safe to attempt on load; the server rejects a
  // membership that is already owned.
  const claim = useCallback(async (
    sessionId?: string,
    checkoutAttemptId?: string
  ): Promise<"claimed" | "pending" | "terminal" | "transient"> => {
    try {
      setClaiming(true);
      setError("");
      await claimMembership(sessionId, checkoutAttemptId);
      clearPendingClaim();
      setPendingSessionId(null);
      setPendingCheckoutAttemptId(null);
      await Promise.all([load(), refreshAppUser()]);
      return "claimed";
    } catch (claimError: unknown) {
      const code = (claimError as {code?: string} | null)?.code ?? "";
      if (code.includes("not-found")) return "pending";
      const terminal = [
        "permission-denied",
        "deadline-exceeded",
        "failed-precondition",
        "already-exists",
      ].some((value) => code.includes(value));
      if (!sessionId && code.includes("permission-denied")) {
        setVerificationNeeded(true);
      }
      if (terminal && sessionId) {
        clearPendingClaim();
        setPendingSessionId(null);
        setPendingCheckoutAttemptId(null);
      }
      setError(
        claimError instanceof Error
          ? claimError.message
          : "Could not claim that purchase."
      );
      return terminal ? "terminal" : "transient";
    } finally {
      setClaiming(false);
    }
  }, [load, refreshAppUser]);

  const resendVerification = async () => {
    if (!user) return;
    try {
      setBusy("verification");
      setError("");
      await sendEmailVerification(user, {
        url: `${window.location.origin}/account/membership?claim=email`,
      });
      setVerificationSent(true);
    } catch (verificationError: unknown) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "Could not send the verification email."
      );
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    void (async () => {
      const pending = readPendingClaim();
      if (pending) {
        const pendingVerifier = readPendingClaimVerifier();
        setPendingSessionId(pending);
        setPendingCheckoutAttemptId(pendingVerifier);
        const outcome = await claim(pending, pendingVerifier ?? undefined);
        // `not-found` can mean either that the webhook has not fulfilled the
        // checkout yet or that a signed-in checkout was already attached. In
        // both cases the page must still load the account's current billing
        // state instead of remaining on its initial loading screen forever.
        if (outcome !== "claimed") await load();
        if (!cancelled && (outcome === "pending" || outcome === "transient")) {
          // One bounded automatic retry covers ordinary webhook lag; the empty
          // state also keeps a manual retry that uses this exact session id.
          retryTimer = window.setTimeout(() => {
            if (!cancelled) void claim(pending, pendingVerifier ?? undefined);
          }, 2000);
        }
        return;
      }
      if (emailClaimRequested) {
        const outcome = await claim();
        if (outcome !== "claimed") await load();
        if (!cancelled && outcome === "claimed") {
          navigate("/account/membership", {replace: true});
        }
        return;
      }
      await load();
    })();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [claim, emailClaimRequested, load, navigate]);

  const openPortal = async (subscriptionId: string) => {
    try {
      setBusy(`portal:${subscriptionId}`);
      setError("");
      const { portalUrl } = await createCustomerPortalSession(subscriptionId);
      window.location.assign(portalUrl);
    } catch (portalError: unknown) {
      setError(
        portalError instanceof Error ? portalError.message : "Could not open the portal."
      );
      setBusy("");
    }
  };

  const cancel = async (
    subscriptionId: string,
    expectedCancelAtUnixSeconds: number,
    kind?: CancellationRequestKind
  ) => {
    try {
      setBusy(subscriptionId);
      setError("");
      if (kind) {
        await requestMembershipCancellation(
          subscriptionId,
          expectedCancelAtUnixSeconds,
          kind
        );
      } else {
        await requestMembershipCancellation(
          subscriptionId,
          expectedCancelAtUnixSeconds
        );
      }
      setConfirming(null);
      await load();
    } catch (cancelError: unknown) {
      const code = (cancelError as {code?: string} | null)?.code ?? "";
      const reason = (cancelError as {details?: {reason?: string}} | null)
        ?.details?.reason;
      if (reason === "cooling_off_manual_review") {
        setError(
          `We could not record this cooling-off cancellation online. Email ${COMPANY.supportEmail} from the payer email, state clearly that you want to cancel during the cooling-off period, and keep a copy of your sent message.`
        );
        setConfirming(null);
        return;
      }
      if (code.includes("failed-precondition")) {
        setError(
          "The cancellation dates changed while you were confirming. Review the updated dates and confirm again."
        );
        setConfirming(subscriptionId);
        await load();
        return;
      }
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not submit your cancellation request."
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:px-8">
        <p className={EYEBROW}>Account</p>
        <h1 className="mt-3 font-heading text-[2.5rem] uppercase leading-[1] tracking-[0.02em] text-white sm:text-[3rem]">
          My membership
        </h1>

        {appAccessAvailable && (
          <Link
            to="/dashboard"
            className="mt-6 inline-flex rounded-2xl bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-black"
          >
            Continue to Zero Alpha App
          </Link>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
            {error}
          </div>
        )}

        {verificationNeeded && user && !user.emailVerified && (
          <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/85">
            <p>
              Verify this account’s email address, then return here to claim the
              membership. It must be the same address used at checkout.
            </p>
            {verificationSent ? (
              <p className="mt-3 font-semibold text-amber-100">
                Verification email sent. Open its link to continue.
              </p>
            ) : (
              <button
                type="button"
                onClick={resendVerification}
                disabled={busy === "verification"}
                className="mt-4 rounded-2xl border border-amber-200/30 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-amber-100 transition hover:border-amber-100/60 disabled:opacity-50"
              >
                {busy === "verification" ? "Sending…" : "Send verification email"}
              </button>
            )}
          </div>
        )}

        {loading && (
          <p className="mt-8 text-sm text-white/50">Loading your memberships…</p>
        )}

        {!loading && memberships.length === 0 && (
          <div className={`mt-8 ${CARD}`}>
            <p className="text-sm leading-7 text-white/70">
              {pendingSessionId
                ? "Your checkout is still being confirmed. Try linking it again in a moment."
                : "You do not have a membership on this account yet. If you have already completed checkout, claim that membership here — it links by the email address you used with Stripe."}
            </p>
            <button
              type="button"
              onClick={() => claim(
                pendingSessionId ?? undefined,
                pendingCheckoutAttemptId ?? undefined
              )}
              disabled={claiming}
              className="mt-6 w-full rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-white/35 disabled:opacity-50"
            >
              {claiming
                ? "Claiming…"
                : pendingSessionId
                  ? "Try linking my membership"
                  : "Claim a membership I already joined"}
            </button>
            <Link
              to="/memberships"
              className="mt-3 block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black"
            >
              View memberships
            </Link>
          </div>
        )}

        <div className="mt-8 space-y-5">
          {memberships.map((membership) => {
            const cancellationOutcome = membership.cancellationOutcome;
            const cancellationConfirmed = cancellationOutcome !== null;
            const cancellationStatus: CancellationRequestStatus | null =
              membership.cancellationRequestStatus ??
              (membership.cancellationManualReview
                ? "manual_review"
                : membership.cancellationPending
                  ? "pending"
                  : cancellationConfirmed
                    ? "applied"
                    : membership.cancellationReceipt
                      ? "accepted"
                      : null);
            const cancellationManualReview = cancellationStatus === "manual_review";
            const cancellationRefundReview =
              cancellationStatus === "refund_review" ||
              (cancellationStatus !== "manual_review" &&
                membership.cancellationReceipt?.refundReviewRequired === true);
            const cancellationAccepted = cancellationStatus === "accepted";
            const cancellationPending = Boolean(
              cancellationStatus === "pending" &&
              !cancellationConfirmed &&
              !cancellationManualReview
            );
            const cancellationRequestRecorded = Boolean(
              cancellationConfirmed ||
              cancellationAccepted ||
              cancellationPending ||
              cancellationRefundReview ||
              cancellationManualReview ||
              membership.cancellationReceipt
            );
            const cancellationPreview = membership.cancellationPreview ?? preview;
            const cancelBeforeStart = membership.cancellationMode === "cancel_before_start";
            const cancelledBeforeStart = cancellationConfirmed &&
              membership.billingMode === "presale_deferred" &&
              membership.firstPaymentReceivedAt == null &&
              cancellationOutcome.finalPaymentDate === null;
            const coolingOffActive = membership.coolingOffActive && !cancelBeforeStart;
            const isConfirming = confirming === membership.subscriptionId;
            const isScheduled = membership.state === "scheduled";
            const firstPaymentAt = membership.firstPaymentAt ??
              membership.billingCycleAnchor ?? membership.currentPeriodEnd;
            const serviceStartsAt = membership.serviceStartsAt ?? firstPaymentAt;
            const participantFullNames = resolveParticipantFullNames(
              membership.participantFullName,
              membership.participantFullNames,
              membership.participantCount
            );

            return (
              <div key={membership.subscriptionId} className={CARD}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className={EYEBROW}>{MEMBERSHIP_STATE_LABEL[membership.state]}</p>
                    <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.08em] text-white">
                      {membership.planName}
                    </h2>
                    <p className="mt-2 text-sm text-white/50">
                      {participantFullNames.length === 1 ? "Participant" : "Participants"}:{" "}
                      {participantFullNames.join(", ")}
                    </p>
                  </div>
                  {membership.grantsAlphaWodAccess && (
                    <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                      {isScheduled && !appAccessAvailable
                        ? "Zero Alpha App after first payment"
                        : "Zero Alpha App"}
                    </span>
                  )}
                </div>

                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      {isScheduled ? "First payment" : "Next payment"}
                    </dt>
                    <dd className="mt-1 text-sm text-white/75">
                      {cancellationConfirmed
                        ? cancellationOutcome.finalPaymentDate
                          ? formatIsoDate(cancellationOutcome.finalPaymentDate)
                          : "None scheduled"
                        : formatUnixDate(isScheduled ? firstPaymentAt : membership.currentPeriodEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      {cancelledBeforeStart
                          ? "Cancellation"
                        : cancellationConfirmed
                        ? "Membership ends"
                        : cancellationRequestRecorded
                          ? "Cancellation"
                          : isScheduled
                            ? "Membership starts"
                          : "Status"}
                    </dt>
                    <dd className="mt-1 text-sm text-white/75">
                      {cancellationConfirmed
                        ? cancelledBeforeStart
                          ? "Cancelled before start"
                          : formatIsoDate(cancellationOutcome.accessEndsOnDate)
                        : cancellationAccepted
                          ? "Request accepted"
                        : cancellationPending
                          ? "Update processing"
                        : cancellationRefundReview
                          ? "Refund review"
                          : cancellationManualReview
                            ? "Needs support"
                          : isScheduled
                            ? formatUnixDate(serviceStartsAt)
                            : MEMBERSHIP_STATE_LABEL[membership.state]}
                    </dd>
                  </div>
                </dl>

                {isScheduled && (
                  <div className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-400/10 p-5 text-sm leading-7 text-sky-50/90">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200">
                      Nothing charged today
                    </p>
                    <p className="mt-3">
                      Your payment method is saved. The membership remains inactive until
                      the first payment succeeds on {formatUnixDate(firstPaymentAt)}.
                      {membership.grantsAlphaWodAccess && (
                        appAccessAvailable
                          ? <> Your existing Zero Alpha App access is available now.</>
                          : <> This membership does not unlock Zero Alpha App access before then.</>
                      )}
                    </p>
                  </div>
                )}

                <MembershipDiscountSummary
                  planKey={membership.planKey}
                  discount={membership.discount}
                  paymentSchedule={membership.paymentSchedule}
                  firstPaymentAt={firstPaymentAt}
                  participantCount={membership.participantCount}
                  className="mt-5"
                />

                {membership.providerContractStatus === "manual_review" && (
                  <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-5 text-sm leading-7 text-red-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200/70">
                      Billing details need review
                    </p>
                    <p className="mt-3">
                      Access is temporarily restricted because the Stripe subscription no
                      longer matches the membership agreed at checkout. Contact{" "}
                      {COMPANY.supportEmail}.
                    </p>
                  </div>
                )}

                {membership.grantsAlphaWodAccess &&
                  membership.participantIsPayer &&
                  !isScheduled &&
                  membership.entitlementProjectionStatus !== "applied" && (
                  <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-5 text-sm leading-7 text-red-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200/70">
                      {membership.entitlementProjectionStatus === "manual_review"
                        ? "Zero Alpha App access needs support"
                        : "Zero Alpha App access is still pending"}
                    </p>
                    <p className="mt-3">
                      Payment may be confirmed, but access could not be safely linked to
                      this account. Contact {COMPANY.supportEmail}.
                    </p>
                  </div>
                )}

                {membership.cancellationReceipt && (
                  <div className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-400/10 p-5 text-sm leading-7 text-sky-50/90">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200">
                      Cancellation receipt
                    </p>
                    <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-xs text-sky-100/60">Reference</dt>
                        <dd className="break-all font-mono text-xs text-sky-50">
                          {membership.cancellationReceipt.reference}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-sky-100/60">Received</dt>
                        <dd className="text-sky-50">
                          <time dateTime={membership.cancellationReceipt.receivedAt}>
                            {formatReceiptTimestamp(
                              membership.cancellationReceipt.receivedAt
                            )}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-sky-100/70">
                      {cancellationKindLabel(membership.cancellationReceipt.kind)}
                      {membership.cancellationReceipt.acknowledgementStatus === "sent"
                        ? " · Acknowledgement sent"
                        : membership.cancellationReceipt.acknowledgementStatus === "failed"
                          ? " · Email acknowledgement needs retry; this receipt remains valid"
                          : membership.cancellationReceipt.acknowledgementStatus === "pending"
                            ? " · Acknowledgement pending"
                            : ""}
                    </p>
                  </div>
                )}

                {coolingOffActive && !cancellationRequestRecorded && (
                  <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/90">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                      Cooling-off period
                    </p>
                    <p className="mt-3">
                      You can ask to cancel during the cooling-off period
                      {membership.coolingOffEndsAt
                        ? `, which ends ${formatReceiptTimestamp(membership.coolingOffEndsAt)}`
                        : ""}.
                      Any proportionate service charge or refund is reviewed separately
                      and does not prevent you from submitting the cancellation request.
                    </p>
                    {isConfirming ? (
                      <div className="mt-4">
                        <p className="font-semibold text-amber-50">
                          Submit a clear request to cancel this membership during the
                          cooling-off period. We will record when it is received.
                        </p>
                        <FamilyCancellationScope
                          planName={membership.planName}
                          participantFullNames={participantFullNames}
                        />
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => cancellationPreview && cancel(
                              membership.subscriptionId,
                              cancellationPreview.cancelAtUnixSeconds,
                              "cooling_off"
                            )}
                            disabled={
                              !cancellationPreview || busy === membership.subscriptionId
                            }
                            className="rounded-2xl bg-red-500/90 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:bg-red-500/40"
                          >
                            {busy === membership.subscriptionId
                              ? "Submitting…"
                              : "Submit cooling-off cancellation"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            className="rounded-2xl border border-amber-200/30 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-amber-50 transition hover:border-amber-100/60"
                          >
                            Keep membership
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(membership.subscriptionId)}
                        className="mt-4 rounded-2xl border border-amber-200/30 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-amber-50 transition hover:border-amber-100/60"
                      >
                        Cancel during cooling-off period
                      </button>
                    )}
                  </div>
                )}

                {cancellationConfirmed && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5 text-sm leading-7 text-white/70">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      Cancellation confirmed
                    </p>
                    <p className="mt-3">
                      {cancelledBeforeStart
                        ? "No payment was taken. This membership was cancelled before it started, so no membership access was activated."
                        : <>
                          {cancellationOutcome.finalPaymentDate
                            ? `Your final payment is due on ${formatIsoDate(
                              cancellationOutcome.finalPaymentDate
                            )}. `
                            : "No further payment is due. "}
                          Your access ends on{" "}
                          {formatIsoDate(cancellationOutcome.accessEndsOnDate)}.
                        </>}
                    </p>
                    <FamilyCancellationScope
                      planName={membership.planName}
                      participantFullNames={participantFullNames}
                      recorded
                    />
                  </div>
                )}

                {cancellationAccepted && !cancellationConfirmed && (
                  <div
                    className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-400/10 p-5 text-sm leading-7 text-sky-50/90"
                    role="status"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200">
                      Cancellation request accepted
                    </p>
                    <p className="mt-3">
                      Your request has been recorded. Final billing and membership end
                      dates will appear here when the provider update is available. You
                      do not need to submit another request.
                    </p>
                  </div>
                )}

                {cancellationPending && (
                  <div
                    className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/90"
                    role="status"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/70">
                      Cancellation request received
                    </p>
                    <p className="mt-3">
                      Your receipt is retained while the billing update processes. Final
                      payment and membership end dates will appear here when ready. You
                      do not need to submit another request.
                    </p>
                  </div>
                )}

                {cancellationRefundReview && (
                  <div
                    className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/90"
                    role="status"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                      Cancellation accepted · refund review
                    </p>
                    <p className="mt-3">
                      Your cancellation request remains recorded. Staff are reviewing
                      only whether a refund or proportionate service charge applies. You
                      do not need to request cancellation again.
                    </p>
                  </div>
                )}

                {cancellationManualReview && (
                  <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-5 text-sm leading-7 text-red-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200/70">
                      Cancellation needs support
                    </p>
                    <p className="mt-3">
                      {cancellationConfirmed
                        ? "The recorded membership end date is retained, but charges or a refund still need staff review. "
                        : "We could not finish confirming this cancellation automatically. Your original request has been retained for staff review. "}
                      {membership.cancellationRequestError && (
                        <>{membership.cancellationRequestError}{" "}</>
                      )}
                      Email{" "}
                      <a
                        href={`mailto:${COMPANY.supportEmail}`}
                        className="font-semibold underline underline-offset-4"
                      >
                        {COMPANY.supportEmail}
                      </a>{" "}
                      from your recorded payer email and include membership reference{" "}
                      <span className="font-mono text-xs">{membership.subscriptionId}</span>.
                    </p>
                  </div>
                )}

                {!cancellationConfirmed &&
                  !cancellationRequestRecorded &&
                  !coolingOffActive &&
                  cancellationPreview &&
                  isConfirming && (
                  <>
                    <CancellationPreview
                      preview={cancellationPreview}
                      mode={cancelBeforeStart ? "cancel_before_start" : "standard"}
                      planName={membership.planName}
                      participantFullNames={participantFullNames}
                    />
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => cancel(
                          membership.subscriptionId,
                          cancellationPreview.cancelAtUnixSeconds
                        )}
                        disabled={busy === membership.subscriptionId}
                        className="rounded-2xl bg-red-500/90 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:bg-red-500/40"
                      >
                        {busy === membership.subscriptionId
                          ? "Submitting…"
                          : cancelBeforeStart
                            ? "Cancel scheduled membership"
                            : "Confirm cancellation"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white/70"
                      >
                        Keep membership
                      </button>
                    </div>
                  </>
                )}

                {!cancellationConfirmed &&
                  !cancellationRequestRecorded &&
                  !coolingOffActive &&
                  !isConfirming && (
                  <button
                    type="button"
                    onClick={() => setConfirming(membership.subscriptionId)}
                    className="mt-6 text-sm font-semibold text-white/50 underline underline-offset-4 transition hover:text-white/80"
                  >
                    Request cancellation
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {memberships.length > 0 && (
          <div className={`mt-5 ${CARD}`}>
            <p className={EYEBROW}>Payment method</p>
            <p className="mt-4 text-sm leading-7 text-white/70">{POLICY_TEXT.portalScope}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {memberships.map((membership) => {
                const portalBusy = busy === `portal:${membership.subscriptionId}`;
                const participantFullNames = resolveParticipantFullNames(
                  membership.participantFullName,
                  membership.participantFullNames,
                  membership.participantCount
                );
                return (
                  <button
                    key={membership.subscriptionId}
                    type="button"
                    onClick={() => openPortal(membership.subscriptionId)}
                    disabled={busy.startsWith("portal:")}
                    className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-white/35 disabled:opacity-50"
                  >
                    {portalBusy
                      ? "Opening…"
                      : memberships.length === 1
                        ? "Open secure portal"
                        : `Portal: ${participantFullNames.join(", ")}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={`mt-5 ${CARD}`}>
          <p className={EYEBROW}>Policy</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-white/70">
            <li>{POLICY_TEXT.cancellationRule}</li>
            <li>{POLICY_TEXT.refund}</li>
            <li>{POLICY_TEXT.noPause}</li>
            <li>{POLICY_TEXT.pastDue}</li>
          </ul>
          <p className="mt-5 text-xs leading-6 text-white/40">
            If the cancellation flow is unavailable, email {COMPANY.supportEmail} from your
            recorded payer email and state clearly that you want to cancel. Keep a copy of
            your sent message. Staff will reply with a receipt reference and the effective
            dates.
          </p>
        </div>
      </div>
    </div>
  );
}
