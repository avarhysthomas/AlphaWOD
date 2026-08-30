import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Link} from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  PoundSterling,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import AppBottomNav from "../../../components/layout/AppBottomNav";
import {formatConditioningSlot, type PlanKey} from "../../../lib/membershipPlans";
import MembershipDiscountSummary from "../../memberships/components/MembershipDiscountSummary";
import {resolveParticipantFullNames} from "../../memberships/components/membershipPresentation";
import {
  formatUnixDate,
  linkMembershipParticipant,
  listMemberships,
  releaseAbandonedMembershipCheckout,
  type AdminCheckoutIssue,
  type AdminMembership,
  type AdminMembershipSummary,
  type MembershipState,
} from "../../memberships/services/membership";

type PlanFilter = "all" | PlanKey;
type StatusFilter =
  | "open"
  | "current"
  | "scheduled"
  | "issues"
  | "awaiting"
  | "ended"
  | "all";
type CheckoutRecoveryNotice = {
  message: string;
  tone: "success" | "warning";
};

const PLAN_TABS: Array<{key: PlanFilter; label: string}> = [
  {key: "all", label: "All memberships"},
  {key: "adult_unlimited", label: "Adult Unlimited"},
  {key: "adult_conditioning", label: "Conditioning Only"},
  {key: "adult_gym", label: "Adult Gym Only"},
  {key: "adult_ladies", label: "Ladies Only"},
  {key: "youth_youngstars", label: "MINI ALPHAS - 10 & Under"},
  {key: "youth_teenstars", label: "TEEN ALPHAS - 11 & UP"},
];

const STATUS_OPTIONS: Array<{key: StatusFilter; label: string}> = [
  {key: "open", label: "Open memberships"},
  {key: "current", label: "Paid / current"},
  {key: "scheduled", label: "Scheduled"},
  {key: "issues", label: "Payment issues"},
  {key: "awaiting", label: "Awaiting payment"},
  {key: "ended", label: "Ended"},
  {key: "all", label: "All records"},
];

const STATE_TONE: Record<MembershipState, string> = {
  scheduled: "border-sky-400/25 bg-sky-400/10 text-sky-100",
  active: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
  past_due_grace: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  past_due_suspended: "border-red-400/25 bg-red-400/10 text-red-100",
  disputed: "border-red-400/25 bg-red-400/10 text-red-100",
  revoked: "border-red-400/20 bg-red-400/[0.08] text-red-100/75",
  cancelled: "border-white/10 bg-white/[0.04] text-white/55",
  incomplete: "border-white/10 bg-white/[0.04] text-white/65",
};

const STATE_LABEL: Record<MembershipState, string> = {
  scheduled: "Scheduled",
  active: "Paid / current",
  past_due_grace: "Payment failed · grace",
  past_due_suspended: "Overdue",
  disputed: "Payment disputed",
  revoked: "Revoked",
  cancelled: "Cancelled",
  incomplete: "Awaiting payment",
};

function formatGbp(amountPence?: number | null): string {
  if (typeof amountPence !== "number" || !Number.isFinite(amountPence)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: amountPence % 100 === 0 ? 0 : 2,
  }).format(amountPence / 100);
}

function hasPaymentIssue(membership: AdminMembership): boolean {
  return membership.state === "past_due_grace" ||
    membership.state === "past_due_suspended" ||
    membership.state === "disputed" ||
    membership.disputeOpen;
}

function isOpenMembership(membership: AdminMembership): boolean {
  return membership.state === "scheduled" ||
    membership.state === "active" ||
    hasPaymentIssue(membership);
}

/** Operational failures that need staff review, including but not limited to payment. */
function needsAttention(membership: AdminMembership): boolean {
  return hasPaymentIssue(membership) ||
    membership.accessRevoked ||
    membership.providerContractStatus === "manual_review" ||
    Boolean(membership.providerContractError) ||
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
    (membership.state !== "scheduled" && membership.grantsAlphaWodAccess &&
      membership.entitlementTargetUid !== null &&
      membership.entitlementProjectionStatus !== "applied") ||
    (membership.state !== "scheduled" && membership.grantsAlphaWodAccess &&
      membership.entitlementTargetUid === null);
}

function matchesStatus(membership: AdminMembership, filter: StatusFilter): boolean {
  switch (filter) {
  case "open":
    return isOpenMembership(membership);
  case "current":
    return membership.state === "active";
  case "scheduled":
    return membership.state === "scheduled";
  case "issues":
    return hasPaymentIssue(membership);
  case "awaiting":
    return membership.state === "incomplete";
  case "ended":
    return membership.state === "cancelled" || membership.state === "revoked";
  default:
    return true;
  }
}

function nextBillingMoment(membership: AdminMembership): {
  label: string;
  value: number | null;
} {
  if (membership.state === "scheduled") {
    return {
      label: "First payment",
      value: membership.firstPaymentAt ?? membership.billingCycleAnchor ??
        membership.currentPeriodEnd,
    };
  }
  if (membership.cancelAt) return {label: "Ends", value: membership.cancelAt};
  if (membership.state === "cancelled" || membership.state === "revoked") {
    return {label: "Ended", value: membership.currentPeriodEnd};
  }
  return {label: "Next billing", value: membership.currentPeriodEnd};
}

function participantDetails(membership: AdminMembership) {
  const names = resolveParticipantFullNames(
    membership.participantFullName,
    membership.participantFullNames,
    membership.participantCount
  );
  const ages = Array.isArray(membership.participantAges) &&
      membership.participantAges.length === names.length ?
    membership.participantAges : [];
  return names.map((name, index) => ({
    name,
    age: ages[index] ?? (index === 0 ? membership.participantAge : null),
  }));
}

function SummaryCell({
  label,
  value,
  detail,
  tone = "text-white",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-[-0.02em] ${tone}`}>
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-white/48">{detail}</p>
    </div>
  );
}

function StatusBadge({membership}: {membership: AdminMembership}) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATE_TONE[membership.state]}`}>
      {STATE_LABEL[membership.state]}
    </span>
  );
}

function MembershipDetails({
  membership,
  linking,
  linkUid,
  busy,
  onLinkUidChange,
  onBeginLink,
  onCancelLink,
  onLink,
  onRepair,
}: {
  membership: AdminMembership;
  linking: boolean;
  linkUid: string;
  busy: boolean;
  onLinkUidChange: (value: string) => void;
  onBeginLink: () => void;
  onCancelLink: () => void;
  onLink: () => void;
  onRepair: () => void;
}) {
  const firstPaymentAt = membership.firstPaymentAt ??
    membership.billingCycleAnchor ?? membership.currentPeriodEnd;
  const serviceStartsAt = membership.serviceStartsAt ?? firstPaymentAt;

  return (
    <div className="border-t border-white/8 bg-black/20 px-4 py-5 sm:px-5 lg:px-6">
      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-white/45">Stripe status</dt>
          <dd className="mt-1 text-white/78">{membership.stripeStatus}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/45">
            {membership.state === "scheduled" ? "First payment" : "Period end"}
          </dt>
          <dd className="mt-1 text-white/78">
            {formatUnixDate(membership.state === "scheduled" ?
              firstPaymentAt : membership.currentPeriodEnd)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/45">Cancellation date</dt>
          <dd className="mt-1 text-white/78">{formatUnixDate(membership.cancelAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/45">Confirmation email</dt>
          <dd className="mt-1 text-white/78">
            {membership.confirmationEmailStatus?.replaceAll("_", " ") ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/45">App access tier</dt>
          <dd className="mt-1 text-white/78">
            {membership.appAccessTier === "limited" ? "Limited" :
              membership.appAccessTier === "full" ? "Full" : "None"}
          </dd>
        </div>
      </dl>

      {membership.appAccessTier === "limited" ? (
        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4 text-sm leading-6 text-amber-50/85">
          <p className="font-semibold text-amber-100">Conditioning booking policy</p>
          {(membership.selectedConditioningSlots?.length ?? 0) === 2 ? (
            <p className="mt-1">Selected slots: {membership.selectedConditioningSlots?.map(formatConditioningSlot).join(" · ")}</p>
          ) : (
            <p className="mt-1 text-red-100">Two canonical slots are not recorded. Access should remain failed closed until this is repaired.</p>
          )}
          <p className="mt-1 text-xs text-amber-50/55">Allowed app areas: Schedule, Profile and Membership only.</p>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs leading-6 text-white/48">
        <p className="break-all">Subscription {membership.subscriptionId}</p>
        <p>Payer account {membership.payerUid ?? "Not yet claimed"}</p>
        {membership.confirmationEmailProviderId ? (
          <p className="break-all">
            Confirmation {membership.confirmationEmailProviderId}
          </p>
        ) : null}
      </div>

      {membership.state === "scheduled" ? (
        <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-400/[0.08] p-4 text-sm leading-6 text-sky-50/85">
          <p className="font-semibold text-sky-100">Pre-opening membership</p>
          <p className="mt-1 text-xs text-sky-100/70">
            £0 charged at checkout. Service starts {formatUnixDate(serviceStartsAt)};
            access begins only after the first payment succeeds.
          </p>
        </div>
      ) : null}

      <MembershipDiscountSummary
        planKey={membership.planKey}
        discount={membership.discount}
        paymentSchedule={membership.paymentSchedule}
        firstPaymentAt={firstPaymentAt}
        participantCount={membership.participantCount}
        className="mt-5"
      />

      {(membership.disputeOpen || membership.accessRevoked) ? (
        <p className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
          {membership.accessRevoked ?
            "Access revoked: the payment was fully refunded or a dispute was lost." :
            "Access is suspended while a payment dispute is investigated."}
        </p>
      ) : null}

      {(membership.providerContractStatus === "manual_review" ||
        membership.providerContractError) ? (
        <p className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
          Stripe subscription contract needs manual review
          {membership.providerContractError ?
            `: ${membership.providerContractError}` :
            ". Access was failed closed after the provider contract changed."}
        </p>
      ) : null}

      {(membership.confirmationEmailStatus === "dead_letter" ||
        membership.confirmationEmailStatus === "manual_review" ||
        membership.confirmationEmailError) ? (
        <p className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
          Confirmation email needs review
          {membership.confirmationEmailError ?
            `: ${membership.confirmationEmailError}` :
            ". Check the billing audit and delivery status before contacting the payer."}
        </p>
      ) : null}

      {(membership.cancellationRequestStatus === "manual_review" ||
        membership.cancellationRequestError) ? (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
          <p className="font-semibold">
            {membership.cancellationRequestStatus === "manual_review" ?
              "Cancellation request needs manual review" :
              "Cancellation recovery needs attention"}
          </p>
          <p className="mt-1 text-xs text-red-100/70">
            Status: {membership.cancellationRequestStatus?.replaceAll("_", " ") ??
              "unknown"}
            {membership.cancellationRequestError ?
              ` · ${membership.cancellationRequestError}` :
              " · Check the billing audit and Stripe schedule before contacting the payer."}
          </p>
        </div>
      ) : null}

      {(membership.refundReviewRequired ||
        membership.cancellationAcknowledgementStatus === "dead_letter" ||
        membership.cancellationAcknowledgementStatus === "manual_review" ||
        membership.cancellationAcknowledgementError) ? (
        <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] p-4 text-sm leading-6 text-amber-50">
          <p className="font-semibold">Cooling-off follow-up required</p>
          <p className="mt-1 text-xs text-amber-100/70">
            {membership.refundReviewRequired ?
              "Refund or proportionate-service review is required. " : ""}
            {membership.cancellationAcknowledgementError ?
              `Acknowledgement: ${membership.cancellationAcknowledgementError} ` :
              membership.cancellationAcknowledgementStatus ?
                `Acknowledgement status: ${membership.cancellationAcknowledgementStatus.replaceAll("_", " ")}. ` :
                ""}
            {membership.cancellationReceipt ?
              `Receipt ${membership.cancellationReceipt.reference} · received ${new Date(
                membership.cancellationReceipt.receivedAt
              ).toLocaleString("en-GB")}.` :
              "Check the billing audit and cancellation receipt."}
          </p>
        </div>
      ) : null}

      {(membership.entitlementProjectionStatus === "manual_review" ||
        membership.entitlementProjectionError ||
        (membership.state !== "scheduled" && membership.grantsAlphaWodAccess &&
          membership.entitlementTargetUid !== null &&
          membership.entitlementProjectionStatus !== "applied")) ? (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
          <p className="font-semibold">
            {membership.entitlementProjectionStatus === "manual_review" ?
              "Zero Alpha App access needs manual review" :
              "Zero Alpha App access has not been applied"}
          </p>
          <p className="mt-1 text-xs text-red-100/70">
            {membership.entitlementProjectionError ??
              "The paid membership could not be safely applied to the linked participant account."}
          </p>
          {membership.entitlementTargetUid ? (
            <button
              type="button"
              onClick={onRepair}
              disabled={busy}
              className="mt-4 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-black transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Rechecking Stripe…" : "Repair Zero Alpha App access"}
            </button>
          ) : null}
        </div>
      ) : null}

      {membership.grantsAlphaWodAccess && !membership.participantIsPayer &&
        membership.entitlementTargetUid === null ? (
        <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] p-4">
          <p className="text-sm leading-6 text-amber-50/90">
            This membership includes Zero Alpha App access, but no participant
            account is linked yet.
          </p>
          {linking ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/35 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30 focus:ring-2 focus:ring-white/10"
                placeholder="Participant account UID"
                value={linkUid}
                onChange={(event) => onLinkUidChange(event.target.value)}
              />
              <button
                type="button"
                onClick={onLink}
                disabled={busy || linkUid.trim().length < 3}
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Linking…" : "Link account"}
              </button>
              <button
                type="button"
                onClick={onCancelLink}
                className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onBeginLink}
              className="mt-4 text-sm font-semibold text-amber-200 underline decoration-amber-400/40 underline-offset-4 focus:outline-none focus:ring-2 focus:ring-amber-300/30"
            >
              Link participant account
            </button>
          )}
        </div>
      ) : null}

      {membership.entitlementTargetUid ? (
        <p className="mt-5 text-xs text-white/42">
          Zero Alpha App access target: {membership.entitlementTargetUid}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminMemberships() {
  const [memberships, setMemberships] = useState<AdminMembership[]>([]);
  const [checkoutIssues, setCheckoutIssues] = useState<AdminCheckoutIssue[]>([]);
  const [summary, setSummary] = useState<AdminMembershipSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);
  const [linkingSubscriptionId, setLinkingSubscriptionId] = useState<string | null>(null);
  const [linkUid, setLinkUid] = useState("");
  const [busySubscriptionId, setBusySubscriptionId] = useState("");
  const [busyCheckoutIntentId, setBusyCheckoutIntentId] = useState("");
  const [checkoutRecoveryNotice, setCheckoutRecoveryNotice] =
    useState<CheckoutRecoveryNotice | null>(null);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    try {
      setRefreshing(true);
      setError("");
      const result = await listMemberships();
      if (requestId !== loadRequestIdRef.current) return;
      setMemberships(result.memberships);
      if (Array.isArray(result.checkoutIssues)) {
        setCheckoutIssues(result.checkoutIssues);
      } else {
        setCheckoutIssues([]);
        setError(
          "Interrupted checkout data is unavailable because the billing admin service is out of date. Update the service before releasing checkout reservations."
        );
      }
      setSummary(result.summary ?? null);
    } catch (loadError: unknown) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(loadError instanceof Error ?
        loadError.message : "Could not load membership reporting.");
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPlanSummary = planFilter === "all" ? summary :
    summary?.plans.find(({planKey}) => planKey === planFilter) ?? null;
  const selectedPlanTitle = planFilter === "all" ? "All memberships" :
    summary?.plans.find(({planKey}) => planKey === planFilter)?.planName ??
    PLAN_TABS.find(({key}) => key === planFilter)?.label ?? "Memberships";

  const filteredMemberships = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const statePriority: Record<MembershipState, number> = {
      past_due_suspended: 0,
      past_due_grace: 1,
      disputed: 2,
      incomplete: 3,
      scheduled: 4,
      active: 5,
      revoked: 6,
      cancelled: 7,
    };

    return memberships
      .filter((membership) => planFilter === "all" || membership.planKey === planFilter)
      .filter((membership) => matchesStatus(membership, statusFilter))
      .filter((membership) => {
        if (!normalizedSearch) return true;
        const participantNames = participantDetails(membership)
          .map(({name}) => name)
          .join(" ");
        const haystack = [
          participantNames,
          membership.guardianFullName,
          membership.payerEmail,
          membership.subscriptionId,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const attentionDelta = Number(needsAttention(right)) - Number(needsAttention(left));
        if (attentionDelta !== 0) return attentionDelta;
        const stateDelta = statePriority[left.state] - statePriority[right.state];
        if (stateDelta !== 0) return stateDelta;
        return (left.participantFullName ?? "").localeCompare(
          right.participantFullName ?? ""
        );
      });
  }, [memberships, planFilter, search, statusFilter]);

  const filteredCheckoutIssues = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return checkoutIssues.filter((issue) => {
      if (planFilter !== "all" && issue.planKey !== planFilter) return false;
      if (!normalizedSearch) return true;
      return [
        ...issue.participantFullNames,
        issue.payerEmail,
        issue.intentId,
      ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
    });
  }, [checkoutIssues, planFilter, search]);
  const planCheckoutIssueCount = checkoutIssues.filter((issue) =>
    planFilter === "all" || issue.planKey === planFilter
  ).length;

  const planCount = (planKey: PlanFilter) => {
    if (summary) {
      if (planKey === "all") return summary.openSubscriptions;
      return summary.plans.find((plan) => plan.planKey === planKey)?.openSubscriptions ?? 0;
    }
    return memberships.filter((membership) =>
      (planKey === "all" || membership.planKey === planKey) && isOpenMembership(membership)
    ).length;
  };

  const link = async (membership: AdminMembership) => {
    const participantUid = linkUid.trim();
    if (participantUid.length < 3) return;
    try {
      setBusySubscriptionId(membership.subscriptionId);
      setError("");
      await linkMembershipParticipant(membership.subscriptionId, participantUid);
      setLinkingSubscriptionId(null);
      setLinkUid("");
      await load();
    } catch (linkError: unknown) {
      setError(linkError instanceof Error ?
        linkError.message : "Could not link the participant account.");
    } finally {
      setBusySubscriptionId("");
    }
  };

  const repairProjection = async (membership: AdminMembership) => {
    if (!membership.entitlementTargetUid) return;
    try {
      setBusySubscriptionId(membership.subscriptionId);
      setError("");
      await linkMembershipParticipant(
        membership.subscriptionId,
        membership.entitlementTargetUid
      );
      await load();
    } catch (repairError: unknown) {
      setError(repairError instanceof Error ?
        repairError.message : "Could not repair Zero Alpha App access.");
    } finally {
      setBusySubscriptionId("");
    }
  };

  const releaseCheckout = async (issue: AdminCheckoutIssue) => {
    const names = issue.participantFullNames.join(", ") || "this customer";
    const confirmed = window.confirm(
      `Verify, release and email ${names}?\n\n` +
      "Stripe will be checked first. A completed, paid or uncertain checkout will stay " +
      "locked. If a verified email address is available, a recovery email will be queued " +
      "after release."
    );
    if (!confirmed) return;

    try {
      setBusyCheckoutIntentId(issue.intentId);
      setCheckoutRecoveryNotice(null);
      setError("");
      const result = await releaseAbandonedMembershipCheckout(issue.intentId);
      const releaseMessage = result.outcome === "already_released" ?
        `${names}’s checkout was already released.` :
        `${names}’s unpaid checkout was released. They can now start again.`;
      const recipient = result.recoveryEmailRecipient ??
        "the verified Stripe email address";
      switch (result.recoveryEmailStatus) {
      case "queued":
        setCheckoutRecoveryNotice({
          message: `${releaseMessage} A recovery email was queued to ${recipient}.`,
          tone: "success",
        });
        break;
      case "already_queued":
        setCheckoutRecoveryNotice({
          message: `${releaseMessage} A recovery email was already queued to ${recipient}.`,
          tone: "success",
        });
        break;
      case "manual_review":
        setCheckoutRecoveryNotice({
          message: result.recoveryEmailRecipient ?
            `${releaseMessage} No recovery email was queued because its delivery ` +
              "record needs billing review." :
            `${releaseMessage} No recovery email was queued because no verified ` +
              "email address was available. Follow up with the customer manually.",
          tone: "warning",
        });
        break;
      default:
        setCheckoutRecoveryNotice({
          message: `${releaseMessage} No recovery email was queued.`,
          tone: "warning",
        });
      }
      await load();
    } catch (releaseError: unknown) {
      const releaseMessage = releaseError instanceof Error ?
        releaseError.message : "Could not safely release this checkout.";
      await load();
      setError(releaseMessage);
    } finally {
      setBusyCheckoutIntentId("");
    }
  };

  return (
    <div className="px-3 pb-36 pt-5 sm:px-6 lg:px-8">
      <main className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-[24px] border border-white/8 bg-[#11100f] sm:rounded-[28px]">
          <div className="flex flex-col gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-4xl font-bold tracking-[-0.03em] text-white sm:text-5xl">
                Memberships
              </h1>
              <p className="mt-3 max-w-[68ch] text-sm leading-6 text-white/55 sm:text-base">
                See who is current, what needs attention and the contracted monthly
                income behind every Zero Alpha membership.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50 lg:self-auto"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing" : "Refresh billing records"}
            </button>
          </div>

          <div className="grid border-t border-white/8 bg-black/20 sm:grid-cols-2 sm:divide-x sm:divide-white/8 lg:grid-cols-4 [&>*]:border-b [&>*]:border-white/8 sm:[&>*]:border-b-0">
            <SummaryCell
              label="Projected monthly"
              value={summary ? formatGbp(summary.projectedMonthlyPence) : "—"}
              detail="Scheduled and paid/current subscriptions"
              tone="text-emerald-200"
            />
            <SummaryCell
              label="Monthly at risk"
              value={summary ? formatGbp(summary.atRiskMonthlyPence) : "—"}
              detail="Failed, overdue or disputed payments"
              tone={summary?.atRiskMonthlyPence ? "text-amber-200" : "text-white"}
            />
            <SummaryCell
              label="Open participants"
              value={summary ? String(summary.openParticipants) : "—"}
              detail={`${summary?.openSubscriptions ?? "—"} open subscriptions`}
            />
            <SummaryCell
              label="Payment issues"
              value={summary ? String(summary.paymentIssueSubscriptions) : "—"}
              detail={summary?.paymentIssueSubscriptions ?
                "Review these memberships now" : "No payment problems detected"}
              tone={summary?.paymentIssueSubscriptions ? "text-red-200" : "text-white"}
            />
          </div>
        </header>

        {error ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-4 py-4 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {checkoutRecoveryNotice ? (
          <div
            role="status"
            className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm ${checkoutRecoveryNotice.tone === "success" ?
              "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-100" :
              "border-amber-400/20 bg-amber-400/[0.08] text-amber-100"}`}
          >
            {checkoutRecoveryNotice.tone === "success" ?
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> :
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <p>{checkoutRecoveryNotice.message}</p>
          </div>
        ) : null}

        {summary && !summary.isComplete ? (
          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] px-4 py-4 text-sm leading-6 text-amber-100">
            This report reached its {summary.reportingLimit}-membership safety limit.
            Financial totals may be incomplete until reporting is paginated.
          </div>
        ) : null}

        {loading ? (
          <div aria-label="Loading memberships" className="mt-6 space-y-4">
            <div className="h-14 animate-pulse rounded-2xl bg-white/[0.05]" />
            <div className="h-72 animate-pulse rounded-2xl bg-white/[0.05]" />
          </div>
        ) : (
          <>
            {planCheckoutIssueCount > 0 ? (
              <section
                aria-labelledby="checkout-recovery-title"
                className="mt-6 overflow-hidden rounded-2xl border border-amber-300/20 bg-[#11100f]"
              >
                <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-5 sm:px-5 lg:flex-row lg:items-start lg:justify-between lg:px-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id="checkout-recovery-title" className="text-xl font-semibold tracking-[-0.02em] text-white">
                        Interrupted checkouts
                      </h2>
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2.5 py-1 text-xs font-semibold text-amber-100">
                        {search.trim() ?
                          `${filteredCheckoutIssues.length} of ${planCheckoutIssueCount}` :
                          `${planCheckoutIssueCount} open`}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[70ch] text-sm leading-6 text-white/52">
                      These are Stripe checkout reservations, not completed memberships.
                      Release one only after the customer confirms they were knocked out
                      of checkout. The server will recheck Stripe and refuse any completed,
                      paid or uncertain Session. After a safe release, it will queue a
                      recovery email when Stripe has a verified address.
                    </p>
                  </div>
                  <label className="relative block w-full lg:w-72">
                    <span className="sr-only">Search interrupted checkouts</span>
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search interrupted checkout"
                      className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/32 focus:border-white/22 focus:ring-2 focus:ring-white/10"
                    />
                  </label>
                </div>

                <div className="divide-y divide-white/8">
                  {filteredCheckoutIssues.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-white/48">
                      No interrupted checkout matches this search.
                    </div>
                  ) : filteredCheckoutIssues.map((issue) => {
                    const names = issue.participantFullNames.join(", ") ||
                      "Unnamed checkout";
                    const busy = busyCheckoutIntentId === issue.intentId;
                    const stateLabel = issue.status === "payment_pending" ?
                      "Confirmation pending" : issue.status === "reserved" ?
                        "Provider result unknown" : issue.status === "release_claimed" ?
                          "Release interrupted — retry" : "Checkout interrupted";
                    return (
                      <article
                        key={issue.intentId}
                        className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(14rem,1.2fr)_minmax(11rem,0.8fr)_minmax(11rem,0.8fr)_auto] lg:items-center lg:px-6"
                      >
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-white">{names}</p>
                          <p className="mt-1 text-xs leading-5 text-white/45">
                            {issue.planName} · {issue.participantCount} participant
                            {issue.participantCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="min-w-0 text-sm">
                          <p className="text-white/72">{stateLabel}</p>
                          <p className="mt-1 break-all text-xs text-white/42">
                            {issue.payerEmail ?? (issue.payerUid ?
                              `Account ${issue.payerUid}` : "Anonymous checkout")}
                          </p>
                        </div>
                        <div className="text-sm">
                          <p className="text-white/72">
                            {issue.createdAt ? new Date(issue.createdAt).toLocaleString("en-GB") :
                              "Start time unavailable"}
                          </p>
                          <p className="mt-1 text-xs text-white/42">
                            Stripe expiry {formatUnixDate(issue.checkoutExpiresAt)}
                          </p>
                        </div>
                        <div className="lg:justify-self-end">
                          <button
                            type="button"
                            onClick={() => void releaseCheckout(issue)}
                            disabled={!issue.canRelease || busy}
                            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200/25 bg-amber-200/[0.08] px-4 py-2.5 text-sm font-semibold text-amber-50 transition hover:border-amber-200/45 hover:bg-amber-200/[0.12] focus:outline-none focus:ring-2 focus:ring-amber-200/25 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.025] disabled:text-white/35 lg:w-auto"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            {busy ? "Checking Stripe…" : issue.canRelease ?
                              "Verify, release & email" : "Billing review required"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <nav
              className="mt-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Membership plans"
            >
              <div role="tablist" className="flex min-w-max gap-2">
                {PLAN_TABS.map((tab) => {
                  const selected = planFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setPlanFilter(tab.key)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-amber-300/25 ${selected ?
                        "border-amber-300/30 bg-amber-300/10 text-amber-50" :
                        "border-white/10 bg-white/[0.025] text-white/58 hover:border-white/18 hover:bg-white/[0.05] hover:text-white"}`}
                    >
                      {tab.label}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${selected ?
                        "bg-amber-100/12 text-amber-100" : "bg-white/[0.06] text-white/45"}`}
                      >
                        {planCount(tab.key)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <section className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-[#11100f]">
              <div className="border-b border-white/8 px-4 py-5 sm:px-5 lg:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">
                        {selectedPlanTitle}
                      </h2>
                      {selectedPlanSummary ? (
                        selectedPlanSummary.paymentIssueSubscriptions > 0 ? (
                          <span className="rounded-full border border-red-400/20 bg-red-400/[0.08] px-2.5 py-1 text-xs font-semibold text-red-100">
                            {selectedPlanSummary.paymentIssueSubscriptions} payment issue
                            {selectedPlanSummary.paymentIssueSubscriptions === 1 ? "" : "s"}
                          </span>
                        ) : selectedPlanSummary.openSubscriptions > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-xs font-semibold text-emerald-100">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            No payment issues
                          </span>
                        ) : null
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-white/48">
                      {selectedPlanSummary ?
                        `${selectedPlanSummary.openParticipants} participants · ${selectedPlanSummary.openSubscriptions} open subscriptions · ${formatGbp(selectedPlanSummary.projectedMonthlyPence)} projected monthly` :
                        "Membership status and revenue will appear after the Stripe view loads."}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(15rem,1fr)_auto] lg:w-auto">
                    <label className="relative block">
                      <span className="sr-only">Search memberships</span>
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search member, payer, checkout or subscription"
                        className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/32 focus:border-white/22 focus:ring-2 focus:ring-white/10"
                      />
                    </label>
                    <label>
                      <span className="sr-only">Filter by membership status</span>
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                        className="min-h-11 w-full rounded-xl border border-white/10 bg-[#151311] px-4 py-2.5 text-sm font-semibold text-white/75 outline-none focus:border-white/22 focus:ring-2 focus:ring-white/10 sm:w-auto"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              {filteredMemberships.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <CreditCard className="mx-auto h-7 w-7 text-white/28" />
                  <h3 className="mt-4 text-base font-semibold text-white">
                    No memberships match this view
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/48">
                    Try another status, clear the search, or choose a different
                    membership plan.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="hidden grid-cols-[minmax(15rem,1.4fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)_minmax(7rem,0.55fr)_minmax(9rem,0.75fr)_2.5rem] gap-4 border-b border-white/8 bg-black/15 px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:grid">
                    <span>Member</span>
                    <span>Payer</span>
                    <span>Status</span>
                    <span>Monthly</span>
                    <span>Next</span>
                    <span className="sr-only">Details</span>
                  </div>

                  {filteredMemberships.map((membership) => {
                    const participants = participantDetails(membership);
                    const billingMoment = nextBillingMoment(membership);
                    const expanded = expandedSubscriptionId === membership.subscriptionId;
                    const detailId = `membership-details-${membership.subscriptionId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
                    const busy = busySubscriptionId === membership.subscriptionId;

                    return (
                      <article key={membership.subscriptionId} className="border-b border-white/8 last:border-b-0">
                        <div className="grid gap-4 px-4 py-4 transition hover:bg-white/[0.018] sm:px-5 lg:grid-cols-[minmax(15rem,1.4fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)_minmax(7rem,0.55fr)_minmax(9rem,0.75fr)_2.5rem] lg:items-center lg:px-6">
                          <div className="min-w-0">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:hidden">
                              Member
                            </p>
                            <div className="space-y-1">
                              {participants.map(({name, age}) => (
                                <p key={`${membership.subscriptionId}-${name}`} className="truncate text-sm font-semibold text-white">
                                  {name || "Unnamed participant"}
                                  {typeof age === "number" ?
                                    <span className="font-normal text-white/42"> · age {age}</span> : null}
                                </p>
                              ))}
                            </div>
                            {membership.guardianFullName ? (
                              <p className="mt-1 truncate text-xs text-white/45">
                                Guardian {membership.guardianFullName}
                              </p>
                            ) : null}
                            <p className="mt-1 truncate text-xs text-white/38">
                              {membership.planName}
                              {membership.appAccessTier === "limited" ? " · limited app" : ""}
                            </p>
                          </div>

                          <div className="min-w-0">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:hidden">
                              Payer
                            </p>
                            <p className="truncate text-sm text-white/68">
                              {membership.payerEmail ?? membership.payerUid ?? "Not yet claimed"}
                            </p>
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:hidden">
                              Status
                            </p>
                            <StatusBadge membership={membership} />
                            {needsAttention(membership) && !hasPaymentIssue(membership) ? (
                              <p className="mt-1.5 text-xs text-amber-200/75">Admin review needed</p>
                            ) : null}
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:hidden">
                              Monthly
                            </p>
                            <p className="text-sm font-semibold text-white">
                              {formatGbp(membership.monthlyRecurringPence)}
                            </p>
                            {membership.revenueState === "at_risk" ? (
                              <p className="mt-0.5 text-xs text-amber-200/70">At risk</p>
                            ) : membership.revenueState === "excluded" ? (
                              <p className="mt-0.5 text-xs text-white/35">Not projected</p>
                            ) : null}
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 lg:hidden">
                              {billingMoment.label}
                            </p>
                            <p className="text-sm text-white/68">
                              <span className="hidden text-xs text-white/38 lg:block">
                                {billingMoment.label}
                              </span>
                              {formatUnixDate(billingMoment.value)}
                            </p>
                          </div>

                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={detailId}
                            aria-label={`${expanded ? "Hide" : "View"} details for ${participants.map(({name}) => name).join(", ")}`}
                            onClick={() => {
                              setExpandedSubscriptionId(expanded ? null : membership.subscriptionId);
                              if (expanded) {
                                setLinkingSubscriptionId(null);
                                setLinkUid("");
                              }
                            }}
                            className="flex h-10 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-white/55 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 lg:w-10"
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                          </button>
                        </div>

                        {expanded ? (
                          <div id={detailId}>
                            <MembershipDetails
                              membership={membership}
                              linking={linkingSubscriptionId === membership.subscriptionId}
                              linkUid={linkUid}
                              busy={busy}
                              onLinkUidChange={setLinkUid}
                              onBeginLink={() => {
                                setLinkingSubscriptionId(membership.subscriptionId);
                                setLinkUid("");
                              }}
                              onCancelLink={() => {
                                setLinkingSubscriptionId(null);
                                setLinkUid("");
                              }}
                              onLink={() => void link(membership)}
                              onRepair={() => void repairProjection(membership)}
                            />
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-6 grid gap-3 text-sm text-white/48 sm:grid-cols-3">
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-4">
                <PoundSterling className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                <p>Projected monthly income is contracted recurring value, not cash received.</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-4">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" />
                <p>Youth family subscriptions count each child once and revenue once.</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-4">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                <p>Discounts are reflected until their server-recorded full-price date.</p>
              </div>
            </div>

            <p className="mt-8 text-xs leading-6 text-white/40">
              Direct entitlement overrides remain in{" "}
              <Link to="/admin/strength-blocks" className="text-white/65 underline decoration-white/25 underline-offset-4 hover:text-white">
                member administration
              </Link>.
            </p>
          </>
        )}
      </main>
      <AppBottomNav />
    </div>
  );
}
