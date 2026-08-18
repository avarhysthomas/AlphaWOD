import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  requestMembershipCancellation,
  type CancellationOutcome,
  type MyMembership,
} from "../services/membership";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

function CancellationPreview({ preview }: { preview: CancellationOutcome }) {
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5 text-sm leading-7 text-white/70">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
        If you cancel now
      </p>
      {preview.noticeDeadlineMet ? (
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
      <p className="mt-3 text-xs text-white/40">
        The deadline for the {formatIsoDate(preview.nextBillingDate)} payment is{" "}
        {formatIsoDate(preview.noticeDeadlineDate)}.
      </p>
    </div>
  );
}

export default function MembershipManage() {
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [preview, setPreview] = useState<CancellationOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
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
  const claim = useCallback(async (sessionId?: string) => {
    try {
      setClaiming(true);
      setError("");
      await claimMembership(sessionId);
      clearPendingClaim();
      await load();
      return true;
    } catch (claimError: unknown) {
      const code = (claimError as {code?: string} | null)?.code ?? "";
      if (!code.includes("not-found")) {
        setError(
          claimError instanceof Error
            ? claimError.message
            : "Could not claim that purchase."
        );
      }
      return false;
    } finally {
      setClaiming(false);
    }
  }, [load]);

  useEffect(() => {
    void (async () => {
      const pending = readPendingClaim();
      if (pending) {
        await claim(pending);
        return;
      }
      await load();
    })();
  }, [claim, load]);

  const openPortal = async () => {
    try {
      setBusy("portal");
      setError("");
      const { portalUrl } = await createCustomerPortalSession();
      window.location.assign(portalUrl);
    } catch (portalError: unknown) {
      setError(
        portalError instanceof Error ? portalError.message : "Could not open the portal."
      );
      setBusy("");
    }
  };

  const cancel = async (subscriptionId: string) => {
    try {
      setBusy(subscriptionId);
      setError("");
      await requestMembershipCancellation(subscriptionId);
      setConfirming(null);
      await load();
    } catch (cancelError: unknown) {
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

        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
            {error}
          </div>
        )}

        {loading && (
          <p className="mt-8 text-sm text-white/50">Loading your memberships…</p>
        )}

        {!loading && memberships.length === 0 && (
          <div className={`mt-8 ${CARD}`}>
            <p className="text-sm leading-7 text-white/70">
              You do not have a membership on this account yet. If you have already paid,
              claim that purchase here — it links by the email address you paid with.
            </p>
            <button
              type="button"
              onClick={() => claim()}
              disabled={claiming}
              className="mt-6 w-full rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-white/35 disabled:opacity-50"
            >
              {claiming ? "Claiming…" : "Claim a purchase I already made"}
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
            const scheduled = membership.cancelAt !== null;
            const isConfirming = confirming === membership.subscriptionId;

            return (
              <div key={membership.subscriptionId} className={CARD}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className={EYEBROW}>{MEMBERSHIP_STATE_LABEL[membership.state]}</p>
                    <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.08em] text-white">
                      {membership.planName}
                    </h2>
                    <p className="mt-2 text-sm text-white/50">
                      Participant: {membership.participantFullName}
                    </p>
                  </div>
                  {membership.grantsAlphaWodAccess && (
                    <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                      AlphaWOD
                    </span>
                  )}
                </div>

                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      Next payment
                    </dt>
                    <dd className="mt-1 text-sm text-white/75">
                      {scheduled ? "None scheduled" : formatUnixDate(membership.currentPeriodEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      {scheduled ? "Membership ends" : "Status"}
                    </dt>
                    <dd className="mt-1 text-sm text-white/75">
                      {scheduled
                        ? formatUnixDate(membership.cancelAt)
                        : MEMBERSHIP_STATE_LABEL[membership.state]}
                    </dd>
                  </div>
                </dl>

                {scheduled && membership.cancellationOutcome && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5 text-sm leading-7 text-white/70">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      Cancellation confirmed
                    </p>
                    <p className="mt-3">
                      {membership.cancellationOutcome.finalPaymentDate
                        ? `Your final payment is due on ${formatIsoDate(
                            membership.cancellationOutcome.finalPaymentDate
                          )}. `
                        : "No further payment is due. "}
                      Your access ends on{" "}
                      {formatIsoDate(membership.cancellationOutcome.accessEndsOnDate)}.
                    </p>
                  </div>
                )}

                {!scheduled && preview && isConfirming && (
                  <>
                    <CancellationPreview preview={preview} />
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => cancel(membership.subscriptionId)}
                        disabled={busy === membership.subscriptionId}
                        className="rounded-2xl bg-red-500/90 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:bg-red-500/40"
                      >
                        {busy === membership.subscriptionId
                          ? "Submitting…"
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

                {!scheduled && !isConfirming && (
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
            <button
              type="button"
              onClick={openPortal}
              disabled={busy === "portal"}
              className="mt-6 rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-white/35 disabled:opacity-50"
            >
              {busy === "portal" ? "Opening…" : "Open secure portal"}
            </button>
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
            recorded payer email. We record when the request reaches us.
          </p>
        </div>
      </div>
    </div>
  );
}
