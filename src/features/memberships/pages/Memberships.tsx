import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import {
  BILLING_POLICY,
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  COMPANY,
  EXISTING_MEMBER_OFFER,
  MEMBERSHIP_PLANS,
  PLAN_LIST,
  POLICY_TEXT,
  formatPlanPrice,
  isFoundingPresale,
  type MembershipPlan,
} from "../../../lib/membershipPlans";
import { LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED } from "../localTestJourney";

const CARD =
  "rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]";
const EYEBROW = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

function PlanCard({ plan, presale }: { plan: MembershipPlan; presale: boolean }) {
  const promotionCodeAvailable = presale && plan.key === EXISTING_MEMBER_OFFER.planKey;

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

      {plan.grantsAlphaWodAccess && (
        <p className="mt-4 inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
          {presale ? "AlphaWOD after first payment" : "Includes AlphaWOD access"}
        </p>
      )}

      {promotionCodeAvailable && (
        <p className="mt-3 text-xs leading-6 text-amber-100/80">
          Existing member? Enter the discount code during signup for £5 off each
          of your first three monthly payments.
        </p>
      )}

      <Link
        to={`/memberships/checkout/${plan.key}`}
        className="mt-6 block rounded-2xl bg-white px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/85"
      >
        Choose {plan.name.replace("Membership", "").trim()}
      </Link>
    </div>
  );
}

/**
 * Youth options share one catalogue card, as approved. The age bands are shown
 * so a guardian picks the right option before reaching the checkout form,
 * which re-derives the band from the participant's date of birth.
 */
function YouthCard({presale}: {presale: boolean}) {
  const youngstars = MEMBERSHIP_PLANS.youth_youngstars;
  const teenstars = MEMBERSHIP_PLANS.youth_teenstars;

  return (
    <div className={CARD}>
      <p className={EYEBROW}>Youth</p>
      <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.08em] text-white">
        Youth Membership
      </h2>
      <p className="mt-4 text-sm leading-7 text-white/70">
        Coached HYROX training for young athletes. A parent or legal guardian must be the
        payer and complete checkout.
      </p>
      {presale && (
        <p className="mt-4 text-sm font-semibold text-sky-100">
          £0 today · first payment 1 September 2026
        </p>
      )}

      <div className="mt-6 space-y-3">
        {[youngstars, teenstars].map((plan) => (
          <Link
            key={plan.key}
            to={`/memberships/checkout/${plan.key}`}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-5 py-4 transition hover:border-white/25"
          >
            <span>
              <span className="block text-sm font-bold uppercase tracking-[0.12em] text-white">
                {plan.name}
              </span>
              <span className="block text-xs text-white/50">
                Ages {plan.minAge} to {plan.maxAge}
              </span>
            </span>
            <span className="font-heading text-xl text-white">
              {formatPlanPrice(plan)}
              <span className="ml-1 text-xs font-normal text-white/45">/mo</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Memberships() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const checkoutCancelled = params.get("checkout") === "cancelled";
  const presale = isFoundingPresale();

  const adultPlans = useMemo(
    () => PLAN_LIST.filter((plan) => plan.cardGroup === "adult"),
    []
  );

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
        <p className={EYEBROW}>{COMPANY.tradingName}</p>
        <h1 className="mt-4 font-heading text-[3rem] uppercase leading-[0.98] tracking-[0.01em] text-white sm:text-[4rem]">
          Memberships
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
          {POLICY_TEXT.rollingTerm} {presale ? POLICY_TEXT.presaleRule : POLICY_TEXT.prorationRule}
        </p>

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

        {!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION &&
          LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED && (
          <div className="mt-7 rounded-[28px] border border-sky-400/30 bg-sky-400/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
              Local Stripe test journey
            </p>
            <p className="mt-3 text-sm leading-7 text-sky-50/85">
              Checkout is available only for the local Stripe test journey. Use Stripe test
              cards; no real payment or live membership is created.
            </p>
          </div>
        )}

        {!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION &&
          !LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED && (
          <div className="mt-7 rounded-[28px] border border-amber-500/25 bg-amber-500/10 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
              Not open yet
            </p>
            <p className="mt-3 text-sm leading-7 text-amber-50/85">
              Online membership purchase is not open. The membership terms, cancellation
              policy and waiver documents are still in legal review. To join now, contact{" "}
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
          <div className="mt-7 rounded-[28px] border border-white/10 bg-[#151311] p-6">
            <p className="text-sm leading-7 text-white/70">
              Checkout was cancelled and you have not been charged. Pick a membership below
              to try again; no payment method was saved.
            </p>
          </div>
        )}

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {adultPlans.map((plan) => (
            <PlanCard key={plan.key} plan={plan} presale={presale} />
          ))}
          <YouthCard presale={presale} />
        </div>

        <div className={`mt-10 ${CARD}`}>
          <p className={EYEBROW}>Before you join</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-white/70">
            <li>{presale ? POLICY_TEXT.prorationAuthority : POLICY_TEXT.prorationRule}</li>
            {presale && <li>{POLICY_TEXT.existingMemberOffer}</li>}
            <li>{POLICY_TEXT.cancellationRule}</li>
            <li>{POLICY_TEXT.refund}</li>
            <li>{POLICY_TEXT.noPause}</li>
            <li>{POLICY_TEXT.pastDue}</li>
            <li>
              Only the Adult Unlimited Membership automatically includes eligible AlphaWOD
              access. Youth, Ladies Only and Gym Only memberships do not.
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
