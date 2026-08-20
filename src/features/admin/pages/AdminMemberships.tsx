import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MEMBERSHIP_STATE_LABEL,
  formatUnixDate,
  linkMembershipParticipant,
  listMemberships,
  type AdminMembership,
  type MembershipState,
} from "../../memberships/services/membership";
import MembershipDiscountSummary from "../../memberships/components/MembershipDiscountSummary";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

const STATE_TONE: Record<MembershipState, string> = {
  scheduled: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  past_due_grace: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  past_due_suspended: "border-red-500/25 bg-red-500/10 text-red-200",
  disputed: "border-red-500/25 bg-red-500/10 text-red-200",
  revoked: "border-red-500/25 bg-red-500/10 text-red-200",
  cancelled: "border-white/15 bg-white/5 text-white/60",
  incomplete: "border-white/15 bg-white/5 text-white/60",
};

type Filter = "all" | "attention" | "scheduled" | "active" | "ended";

/** Memberships an administrator should look at rather than just monitor. */
function needsAttention(membership: AdminMembership): boolean {
  return (
    membership.disputeOpen ||
    membership.accessRevoked ||
    membership.providerContractStatus === "manual_review" ||
    Boolean(membership.providerContractError) ||
    membership.state === "past_due_suspended" ||
    membership.state === "past_due_grace" ||
    membership.confirmationEmailStatus === "dead_letter" ||
    membership.confirmationEmailStatus === "manual_review" ||
    Boolean(membership.confirmationEmailError) ||
    membership.cancellationRequestStatus === "manual_review" ||
    Boolean(membership.cancellationRequestError) ||
    membership.refundReviewRequired === true ||
    membership.cancellationAcknowledgementStatus === "dead_letter" ||
    membership.cancellationAcknowledgementStatus === "manual_review" ||
    Boolean(membership.cancellationAcknowledgementError) ||
    membership.entitlementProjectionStatus === "manual_review" ||
    Boolean(membership.entitlementProjectionError) ||
    (membership.state !== "scheduled" &&
      membership.grantsAlphaWodAccess &&
      membership.entitlementTargetUid !== null &&
      membership.entitlementProjectionStatus !== "applied") ||
    (membership.state !== "scheduled" &&
      membership.grantsAlphaWodAccess && membership.entitlementTargetUid === null)
  );
}

export default function AdminMemberships() {
  const [memberships, setMemberships] = useState<AdminMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("attention");
  const [linking, setLinking] = useState<string | null>(null);
  const [linkUid, setLinkUid] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await listMemberships();
      setMemberships(result.memberships);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load memberships."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    switch (filter) {
    case "attention":
      return memberships.filter(needsAttention);
    case "active":
      return memberships.filter(
        (entry) => entry.state === "active" || entry.state === "past_due_grace"
      );
    case "scheduled":
      return memberships.filter((entry) => entry.state === "scheduled");
    case "ended":
      return memberships.filter(
        (entry) => entry.state === "cancelled" || entry.state === "revoked"
      );
    default:
      return memberships;
    }
  }, [memberships, filter]);

  const counts = useMemo(
    () => ({
      total: memberships.length,
      attention: memberships.filter(needsAttention).length,
      scheduled: memberships.filter((entry) => entry.state === "scheduled").length,
      alphaWod: memberships.filter(
        (entry) =>
          entry.grantsAlphaWodAccess &&
          (entry.state === "active" || entry.state === "past_due_grace")
      ).length,
    }),
    [memberships]
  );

  const link = async (subscriptionId: string) => {
    const participantUid = linkUid.trim();
    if (participantUid.length < 3) return;

    try {
      setBusy(subscriptionId);
      setError("");
      await linkMembershipParticipant(subscriptionId, participantUid);
      setLinking(null);
      setLinkUid("");
      await load();
    } catch (linkError: unknown) {
      setError(
        linkError instanceof Error ? linkError.message : "Could not link the participant."
      );
    } finally {
      setBusy("");
    }
  };

  const repairProjection = async (
    subscriptionId: string,
    participantUid: string
  ) => {
    try {
      setBusy(subscriptionId);
      setError("");
      await linkMembershipParticipant(subscriptionId, participantUid);
      await load();
    } catch (repairError: unknown) {
      setError(
        repairError instanceof Error ?
          repairError.message :
          "Could not repair Zero Alpha App access."
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
      <p className={EYEBROW}>Admin</p>
      <h1 className="mt-3 font-heading text-[2.5rem] uppercase leading-[1] tracking-[0.02em] text-white sm:text-[3rem]">
        Memberships
      </h1>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total", value: counts.total },
          { label: "Need attention", value: counts.attention },
          { label: "Scheduled", value: counts.scheduled },
          { label: "Zero Alpha App active", value: counts.alphaWod },
        ].map((stat) => (
          <div key={stat.label} className="rounded-[28px] border border-white/10 bg-[#151311] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
              {stat.label}
            </p>
            <p className="mt-2 font-heading text-3xl text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {(["attention", "scheduled", "active", "ended", "all"] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
              filter === option
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-white/45 hover:border-white/25"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
          {error}
        </div>
      )}

      {loading && <p className="mt-8 text-sm text-white/50">Loading memberships…</p>}

      {!loading && visible.length === 0 && (
        <div className={`mt-8 ${CARD}`}>
          <p className="text-sm leading-7 text-white/70">
            No memberships match this filter.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {visible.map((membership) => {
          const isScheduled = membership.state === "scheduled";
          const firstPaymentAt = membership.firstPaymentAt ??
            membership.billingCycleAnchor ?? membership.currentPeriodEnd;
          const serviceStartsAt = membership.serviceStartsAt ?? firstPaymentAt;

          return (
          <div key={membership.subscriptionId} className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-heading text-xl uppercase tracking-[0.08em] text-white">
                  {membership.planName}
                </h2>
                <p className="mt-2 text-sm text-white/60">
                  {membership.participantFullName}
                  {membership.participantAge !== null && ` · age ${membership.participantAge}`}
                  {membership.guardianFullName && ` · guardian ${membership.guardianFullName}`}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  Payer {membership.payerEmail ?? membership.payerUid} ·{" "}
                  {membership.subscriptionId}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                  STATE_TONE[membership.state]
                }`}
              >
                {MEMBERSHIP_STATE_LABEL[membership.state]}
              </span>
            </div>

            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                  Stripe status
                </dt>
                <dd className="mt-1 text-white/75">{membership.stripeStatus}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                  {isScheduled ? "First payment" : "Period end"}
                </dt>
                <dd className="mt-1 text-white/75">
                  {formatUnixDate(isScheduled ? firstPaymentAt : membership.currentPeriodEnd)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                  Ends
                </dt>
                <dd className="mt-1 text-white/75">{formatUnixDate(membership.cancelAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                  Confirmation
                </dt>
                <dd className="mt-1 text-white/75">
                  {membership.confirmationEmailStatus?.replaceAll("_", " ") ?? "—"}
                </dd>
                {membership.confirmationEmailProviderId && (
                  <dd className="mt-1 break-all text-xs text-white/40">
                    {membership.confirmationEmailProviderId}
                  </dd>
                )}
              </div>
            </dl>

            {isScheduled && (
              <div className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-400/10 p-5 text-sm leading-7 text-sky-50/90">
                <p className="font-semibold text-sky-100">Pre-opening membership</p>
                <p className="mt-1 text-xs leading-6 text-sky-100/70">
                  £0 charged at checkout. Service starts {formatUnixDate(serviceStartsAt)};
                  activate access only after the first payment succeeds.
                </p>
              </div>
            )}

            <MembershipDiscountSummary
              planKey={membership.planKey}
              discount={membership.discount}
              paymentSchedule={membership.paymentSchedule}
              firstPaymentAt={firstPaymentAt}
              className="mt-5"
            />

            {(membership.disputeOpen || membership.accessRevoked) && (
              <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                {membership.accessRevoked
                  ? "Access revoked: the payment was fully refunded or a dispute was lost."
                  : "Access suspended while a payment dispute is investigated."}
              </p>
            )}

            {(membership.providerContractStatus === "manual_review" ||
              membership.providerContractError) && (
              <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                Stripe subscription contract needs manual review
                {membership.providerContractError
                  ? `: ${membership.providerContractError}`
                  : ". Access was failed closed after the provider contract changed."}
              </p>
            )}

            {(membership.confirmationEmailStatus === "dead_letter" ||
              membership.confirmationEmailStatus === "manual_review" ||
              membership.confirmationEmailError) && (
              <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                Confirmation email needs review
                {membership.confirmationEmailError
                  ? `: ${membership.confirmationEmailError}`
                  : ". Check the billing audit and Resend delivery before contacting the payer."}
              </p>
            )}

            {(membership.cancellationRequestStatus === "manual_review" ||
              membership.cancellationRequestError) && (
              <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                <p className="font-semibold">
                  {membership.cancellationRequestStatus === "manual_review"
                    ? "Cancellation request needs manual review"
                    : "Cancellation recovery needs attention"}
                </p>
                <p className="mt-1 text-xs text-red-100/70">
                  Status: {membership.cancellationRequestStatus?.replaceAll("_", " ") ?? "unknown"}
                  {membership.cancellationRequestError
                    ? ` · ${membership.cancellationRequestError}`
                    : " · Check the billing audit and Stripe schedule before contacting the payer."}
                </p>
              </div>
            )}

            {(membership.refundReviewRequired ||
              membership.cancellationAcknowledgementStatus === "dead_letter" ||
              membership.cancellationAcknowledgementStatus === "manual_review" ||
              membership.cancellationAcknowledgementError) && (
              <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-50">
                <p className="font-semibold">Cooling-off follow-up required</p>
                <p className="mt-1 text-xs text-amber-100/70">
                  {membership.refundReviewRequired
                    ? "Refund or proportionate-service review is required. "
                    : ""}
                  {membership.cancellationAcknowledgementError
                    ? `Acknowledgement: ${membership.cancellationAcknowledgementError} `
                    : membership.cancellationAcknowledgementStatus
                      ? `Acknowledgement status: ${membership.cancellationAcknowledgementStatus.replaceAll("_", " ")}. `
                      : ""}
                  {membership.cancellationReceipt
                    ? `Receipt ${membership.cancellationReceipt.reference} · received ${new Date(
                      membership.cancellationReceipt.receivedAt
                    ).toLocaleString("en-GB")}.`
                    : "Check the billing audit and immutable cancellation receipt."}
                </p>
              </div>
            )}

            {(membership.entitlementProjectionStatus === "manual_review" ||
              membership.entitlementProjectionError ||
              (membership.state !== "scheduled" && membership.grantsAlphaWodAccess &&
                membership.entitlementTargetUid !== null &&
                membership.entitlementProjectionStatus !== "applied")) && (
              <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                <p className="font-semibold">
                  {membership.entitlementProjectionStatus === "manual_review"
                    ? "Zero Alpha App access needs manual review"
                    : "Zero Alpha App access has not been applied"}
                </p>
                <p className="mt-1 text-xs text-red-100/70">
                  {membership.entitlementProjectionError ??
                    "The paid membership could not be safely projected onto the participant account. Check the billing audit and entitlement owner before making a manual change."}
                </p>
                {membership.entitlementTargetUid && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => repairProjection(
                        membership.subscriptionId,
                        membership.entitlementTargetUid as string
                      )}
                      disabled={busy === membership.subscriptionId}
                      className="rounded-2xl bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-black disabled:opacity-50"
                    >
                      {busy === membership.subscriptionId ?
                        "Rechecking Stripe…" :
                        "Repair Zero Alpha App access"}
                    </button>
                    <p className="mt-2 text-xs leading-5 text-red-100/60">
                      Rechecks this subscription in Stripe, then reapplies access only to
                      the account already linked above.
                    </p>
                  </div>
                )}
              </div>
            )}

            {membership.grantsAlphaWodAccess &&
              !membership.participantIsPayer &&
              membership.entitlementTargetUid === null && (
              <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
                <p className="text-sm leading-6 text-amber-50/90">
                  This membership includes Zero Alpha App access but was bought for someone other
                  than the payer, so no account has been granted access. Link the
                  participant&rsquo;s account to grant it.
                </p>

                {linking === membership.subscriptionId ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <input
                      className="min-w-[16rem] flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-white/30"
                      placeholder="Participant account UID"
                      value={linkUid}
                      onChange={(event) => setLinkUid(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => link(membership.subscriptionId)}
                      disabled={busy === membership.subscriptionId}
                      className="rounded-2xl bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-black disabled:opacity-50"
                    >
                      {busy === membership.subscriptionId ? "Linking…" : "Link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLinking(null);
                        setLinkUid("");
                      }}
                      className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-white/70"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLinking(membership.subscriptionId)}
                    className="mt-4 text-sm font-semibold text-amber-200 underline decoration-amber-400/40 underline-offset-4"
                  >
                    Link participant account
                  </button>
                )}
              </div>
            )}

            {membership.entitlementTargetUid && (
              <p className="mt-5 text-xs text-white/40">
                Zero Alpha App access target: {membership.entitlementTargetUid}
              </p>
            )}
          </div>
          );
        })}
      </div>

      <p className="mt-10 text-xs leading-6 text-white/40">
        Entitlement overrides remain on the member record. Use{" "}
        <Link to="/admin/strength-blocks" className="underline underline-offset-4">
          member administration
        </Link>{" "}
        to change a member&rsquo;s access directly.
      </p>
    </div>
  );
}
