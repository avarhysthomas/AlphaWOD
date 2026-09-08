import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import {
  BILLING_POLICY,
  COMPANY,
  MEMBERSHIP_PLANS,
  PLAN_LIST,
  POLICY_TEXT,
  YOUTH_FAMILY_OFFER,
  formatPlanPrice,
  isFoundingPresale,
  type MembershipPlan,
} from "../../../lib/membershipPlans";
import {MEMBERSHIP_PURCHASE_AVAILABILITY} from "../purchaseAvailability";

const CARD =
  "rounded-2xl border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

function PlanCard({
  plan,
  presale,
  checkoutEnabled,
}: {
  plan: MembershipPlan;
  presale: boolean;
  checkoutEnabled: boolean;
}) {
  const isConditioning = plan.key === "adult_conditioning";
  const isConditioningComingSoon = isConditioning && !checkoutEnabled;
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={EYEBROW}>{plan.audience === "youth" ? "Youth" : "Adult"}</p>
          <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.08em] text-white">
            {plan.name}
          </h2>
        </div>
        <p className="whitespace-nowrap font-heading text-3xl text-white">
          {formatPlanPrice(plan)}
          <span className="ml-1 text-sm font-normal text-white/45">/mo</span>
        </p>
      </div>

      <p className="mt-4 text-sm leading-7 text-white/70">{plan.summary}</p>

      {presale && (
        <p className="mt-4 text-sm font-semibold text-sky-100">
          £0 today · first payment 1 September 2026
        </p>
      )}

      {plan.appAccessTier !== "none" && !presale && (
        <p className="mt-4 inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
          {plan.appAccessTier === "limited" ? "Limited Zero Alpha App access" : "Full Zero Alpha App access"}
        </p>
      )}

      {isConditioningComingSoon ? (
        <p className="mt-4 text-sm font-bold text-amber-200">
          Coming soon · book any two eligible Conditioning classes each week
        </p>
      ) : null}

      {checkoutEnabled || isConditioningComingSoon ? (
        <Link
          to={`/memberships/checkout/${plan.key}`}
          className="mt-6 block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/85"
        >
          {isConditioningComingSoon ? "Preview weekly allowance" : `Choose ${plan.name.replace("Membership", "").trim()}`}
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className="mt-6 block w-full cursor-not-allowed rounded-2xl bg-white/20 px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-white/50"
        >
          Online purchase closed
        </button>
      )}
    </div>
  );
}

/** Youth options share one catalogue card while retaining separate pricing. */
function YouthCard({
  presale,
  checkoutEnabled,
}: {
  presale: boolean;
  checkoutEnabled: boolean;
}) {
  const miniAlphas = MEMBERSHIP_PLANS.youth_youngstars;
  const teenAlphas = MEMBERSHIP_PLANS.youth_teenstars;

  return (
    <div className={CARD}>
      <p className={EYEBROW}>Youth</p>
      <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.08em] text-white">
        Youth Membership
      </h2>
      <p className="mt-4 text-sm leading-7 text-white/70">
        Strength and conditioning for young athletes. A parent or legal guardian must be
        payer and complete checkout.
      </p>
      <p className="mt-3 text-sm font-semibold leading-7 text-emerald-100">
        Register 2 or more children in the same programme and receive an automatic
        {` ${YOUTH_FAMILY_OFFER.percentOff}%`} discount on the full monthly total.
      </p>
      {presale && (
        <p className="mt-4 text-sm font-semibold text-sky-100">
          £0 today · first payment 1 September 2026
        </p>
      )}

      <div className="mt-6 space-y-3">
        {[miniAlphas, teenAlphas].map((plan) => {
          const content = (
            <>
            <span className="min-w-0 sm:max-w-[70%]">
              <span className="block text-sm font-bold tracking-[0.12em] text-white">
                {plan.name}
              </span>
              <span className="mt-1 block text-xs leading-5 text-white/55">
                {plan.summary}
              </span>
            </span>
            <span className="shrink-0 font-heading text-xl text-white">
              {formatPlanPrice(plan)}
              <span className="ml-1 text-xs font-normal text-white/45">/child/mo</span>
            </span>
            </>
          );

          return checkoutEnabled ? (
            <Link
              key={plan.key}
              to={`/memberships/checkout/${plan.key}`}
              className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 px-5 py-4 transition hover:border-white/25 sm:flex-row sm:items-center"
            >
              {content}
            </Link>
          ) : (
            <button
              key={plan.key}
              type="button"
              disabled
              aria-label={`${plan.name} — online purchase closed`}
              className="flex w-full cursor-not-allowed flex-col items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-left opacity-50 sm:flex-row sm:items-center"
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Memberships() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const checkoutCancelled = params.get("checkout") === "cancelled";
  const presale = isFoundingPresale();
  const {
    checkoutEnabled,
    conditioningCheckoutEnabled,
    documentsApproved,
    localTestJourneyEnabled,
  } = MEMBERSHIP_PURCHASE_AVAILABILITY;

  const adultPlans = useMemo(
    () => PLAN_LIST.filter((plan) => plan.cardGroup === "adult"),
    []
  );

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
        <Link
          to="/"
          aria-label="Zero Alpha home"
          className="inline-flex rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          <span aria-hidden="true" className="relative block h-20 w-48 overflow-hidden">
            <img
              src="/ZERO-ALPHA.png"
              alt=""
              width={5000}
              height={4340}
              draggable={false}
              className="absolute left-1/2 top-1/2 w-56 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
            />
          </span>
        </Link>
        <h1 className="mt-4 font-heading text-[3rem] uppercase leading-[0.98] tracking-[0.01em] text-white sm:text-[4rem]">
          Memberships
        </h1>

        <div className="mt-7 flex flex-col gap-5 border-y border-payg/25 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-3xl uppercase text-white">Just want one class?</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">See the live timetable and choose one Pay As You Go session for £7. No account or recurring membership.</p>
          </div>
          <Link
            to="/pay-as-you-go"
            className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-xl bg-payg px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-payg-hover focus-visible:ring-2 focus-visible:ring-white"
          >
            View PAYG timetable
          </Link>
        </div>

        {presale && (
          <dl className="mt-7 grid gap-5 border-y border-white/10 py-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">Today</dt>
              <dd className="mt-1 font-semibold text-white">£0 charged</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">Membership starts</dt>
              <dd className="mt-1 font-semibold text-white">1 September 2026</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.16em] text-white/45">First payment</dt>
              <dd className="mt-1 font-semibold text-white">1 September 2026</dd>
            </div>
          </dl>
        )}

        {localTestJourneyEnabled && (
          <p className="mt-7 inline-flex rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-xs font-semibold text-sky-100">
            Local Stripe test mode · no real payments or memberships
          </p>
        )}

        {!checkoutEnabled && (
          <div className="mt-7 rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
              Not open yet
            </p>
            <p className="mt-3 text-sm leading-7 text-amber-50/85">
              {documentsApproved
                ? "Online membership purchase is currently closed. "
                : "Online membership purchase is not open. The membership terms, cancellation policy and waiver documents are still in legal review. "}
              To join now, contact{" "}
              <a
                className="underline decoration-amber-400/40 underline-offset-4"
                href={`mailto:${COMPANY.supportEmail}`}
              >
                {COMPANY.supportEmail}
              </a>
              .
            </p>
          </div>
        )}

        {checkoutCancelled && (
          <div
            role="status"
            aria-labelledby="checkout-return-title"
            className="mt-7 rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6 text-amber-50"
          >
            <h2 id="checkout-return-title" className="font-semibold">
              Checkout may still be open
            </h2>
            <p className="mt-2 text-sm leading-7 text-amber-50/85">
              Using Back in Stripe returns you here, but it does not cancel or expire the
              checkout. Use the original Stripe tab or your browser&rsquo;s Back control to
              return to it, or contact us if you need help confirming its status.
            </p>
            <div className="mt-4">
              <a
                href={`mailto:${COMPANY.supportEmail}`}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100"
              >
                Contact support
              </a>
            </div>
          </div>
        )}

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {adultPlans.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              presale={presale}
              checkoutEnabled={plan.key === "adult_conditioning" ?
                conditioningCheckoutEnabled : checkoutEnabled}
            />
          ))}
          <YouthCard presale={presale} checkoutEnabled={checkoutEnabled} />
        </div>

        <div className={`mt-10 ${CARD}`}>
          <p className={EYEBROW}>Before you join</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-white/70">
            <li>{POLICY_TEXT.rollingTerm}</li>
            <li>{presale ? POLICY_TEXT.prorationAuthority : POLICY_TEXT.prorationRule}</li>
            {presale && <li>{POLICY_TEXT.existingMemberOffer}</li>}
            <li>{POLICY_TEXT.cancellationRule}</li>
            <li>{POLICY_TEXT.refund}</li>
            <li>{POLICY_TEXT.noPause}</li>
            <li>{POLICY_TEXT.pastDue}</li>
            <li>
              Adult Unlimited includes full eligible Zero Alpha App access. Adult Conditioning
              Only includes Schedule, Profile and Membership management, with up to two eligible
              Conditioning bookings in each Monday–Sunday week. Those two classes can change
              from week to week. Youth, Ladies Only and Gym Only memberships do not include app
              access.
            </li>
          </ul>
          <p className="mt-5 text-xs leading-6 text-white/40">
            {COMPANY.legalName} · Company number {COMPANY.companyNumber} · {COMPANY.address}.
            We are not VAT registered; the price shown is the total price. Cooling-off:{" "}
            {BILLING_POLICY.coolingOffDays} days from the day the contract is made.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          {user ? (
            <Link
              to="/account/membership"
              className="font-semibold text-amber-200 underline decoration-amber-400/40 underline-offset-4"
            >
              Manage an existing membership
            </Link>
          ) : (
            <Link
              to="/"
              className="font-semibold text-amber-200 underline decoration-amber-400/40 underline-offset-4"
            >
              Already a member? Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
