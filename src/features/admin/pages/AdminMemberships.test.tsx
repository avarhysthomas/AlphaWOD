import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminMemberships from "./AdminMemberships";

const mockListMemberships = jest.fn();
const mockLinkMembershipParticipant = jest.fn();

jest.mock("../../memberships/services/membership", () => ({
  MEMBERSHIP_STATE_LABEL: {
    incomplete: "Awaiting payment",
    scheduled: "Scheduled — starts 1 September",
    active: "Active",
    past_due_grace: "Payment failed — in grace period",
    past_due_suspended: "Suspended — payment overdue",
    disputed: "Suspended — payment disputed",
    cancelled: "Cancelled",
    revoked: "Revoked",
  },
  formatUnixDate: (value: number | null) => String(value ?? "—"),
  linkMembershipParticipant: (...args: unknown[]) =>
    mockLinkMembershipParticipant(...args),
  listMemberships: () => mockListMemberships(),
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to}: {children: React.ReactNode; to: string}) => (
      <a href={to}>{children}</a>
    ),
  }),
  {virtual: true}
);

describe("AdminMemberships cancellation attention", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLinkMembershipParticipant.mockResolvedValue({
      ok: true,
      alreadyLinked: true,
      repaired: true,
    });
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        subscriptionId: "sub_cancel_review",
        payerUid: "payer-one",
        payerEmail: "payer@example.test",
        planKey: "adult_gym",
        planName: "Adult Gym Only",
        state: "active",
        stripeStatus: "active",
        grantsAlphaWodAccess: false,
        entitlementTargetUid: null,
        participantFullName: "Review Member",
        participantAge: 34,
        participantIsPayer: true,
        guardianFullName: null,
        currentPeriodEnd: 1_790_809_200,
        cancelAt: 1_790_809_200,
        disputeOpen: false,
        accessRevoked: false,
        pastDueSince: null,
        confirmationEmailStatus: "sent",
        confirmationEmailError: null,
        confirmationEmailProviderId: "email_123",
        cancellationRequestStatus: "manual_review",
        cancellationRequestKind: "cooling_off",
        cancellationReceipt: {
          reference: "cancel_review_receipt",
          receivedAt: "2026-08-19T14:05:00.000Z",
          kind: "cooling_off",
        },
        refundReviewRequired: true,
        cancellationRequestError: "Stripe cancellation recovery exhausted.",
        cancellationAcknowledgementStatus: "manual_review",
        cancellationAcknowledgementError: "Delivery requires manual review.",
        cancellationAcknowledgementProviderId: null,
        entitlementProjectionStatus: "manual_review",
        entitlementProjectionError: "Participant profile is missing.",
      }],
    });
  });

  it("keeps a cancellation manual-review record in attention and shows its error", async () => {
    render(<AdminMemberships />);

    expect(await screen.findByText("Adult Gym Only")).toBeInTheDocument();
    expect(screen.getByText("Cancellation request needs manual review"))
      .toBeInTheDocument();
    expect(screen.getByText(
      "Status: manual review · Stripe cancellation recovery exhausted."
    )).toBeInTheDocument();
    expect(screen.getByText("Zero Alpha App access needs manual review"))
      .toBeInTheDocument();
    expect(screen.getByText("Participant profile is missing."))
      .toBeInTheDocument();
    expect(screen.getByText("Cooling-off follow-up required"))
      .toBeInTheDocument();
    expect(screen.getByText(/Refund or proportionate-service review is required/))
      .toBeInTheDocument();
    expect(screen.getByText(/Receipt cancel_review_receipt/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Repair Zero Alpha App access"}))
      .not.toBeInTheDocument();
  });

  it("keeps a healthy presale membership out of attention and shows its schedule", async () => {
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        subscriptionId: "sub_scheduled",
        payerUid: "payer-one",
        payerEmail: "payer@example.test",
        planKey: "adult_unlimited",
        planName: "Adult Unlimited Membership",
        state: "scheduled",
        stripeStatus: "active",
        billingMode: "presale_deferred",
        serviceStartsAt: 1788217200,
        firstPaymentAt: 1788220800,
        billingCycleAnchor: 1788220800,
        initialChargePence: 0,
        grantsAlphaWodAccess: true,
        entitlementTargetUid: "payer-one",
        participantFullName: "Scheduled Member",
        participantAge: 34,
        participantIsPayer: true,
        guardianFullName: null,
        currentPeriodEnd: 1788220800,
        cancelAt: null,
        disputeOpen: false,
        accessRevoked: false,
        providerContractStatus: "verified",
        providerContractError: null,
        pastDueSince: null,
        confirmationEmailStatus: "sent",
        confirmationEmailError: null,
        confirmationEmailProviderId: "email_456",
        cancellationRequestStatus: null,
        cancellationRequestError: null,
        entitlementProjectionStatus: null,
        entitlementProjectionError: null,
        discount: {
          couponId: "coupon_existing_5",
          promotionCodeId: "promo_1",
          amountOffPence: 500,
          currency: "gbp",
          durationInMonths: 3,
          startsAt: 1787149200,
          endsAt: 1795035600,
        },
      }],
    });

    render(<AdminMemberships />);

    expect(await screen.findByText("No memberships match this filter."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "scheduled"}));

    expect(await screen.findByRole("heading", {name: "Adult Unlimited Membership"}))
      .toBeInTheDocument();
    expect(screen.getByText("Scheduled — starts 1 September")).toBeInTheDocument();
    expect(screen.getByText("Pre-opening membership")).toBeInTheDocument();
    expect(screen.getByText("Existing-member discount applied")).toBeInTheDocument();
    expect(screen.queryByText("Zero Alpha App access has not been applied"))
      .not.toBeInTheDocument();
  });

  it("shows every youth participant and the projected family total", async () => {
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        subscriptionId: "sub_family",
        payerUid: "payer-family",
        payerEmail: "family@example.test",
        planKey: "youth_teenstars",
        planName: "HYROX Teenstars",
        state: "past_due_grace",
        stripeStatus: "past_due",
        grantsAlphaWodAccess: false,
        entitlementTargetUid: null,
        participantFullName: "Alex Child",
        participantFullNames: ["Alex Child", "Sam Child"],
        participantCount: 2,
        participantAge: 14,
        participantAges: [14, 13],
        participantIsPayer: false,
        guardianFullName: "Ava Parent",
        currentPeriodEnd: 1_790_809_200,
        cancelAt: null,
        disputeOpen: false,
        accessRevoked: false,
        providerContractStatus: "verified",
        providerContractError: null,
        pastDueSince: 1_790_809_200,
        confirmationEmailStatus: "sent",
        confirmationEmailError: null,
        confirmationEmailProviderId: "email_family",
        cancellationRequestStatus: null,
        cancellationRequestError: null,
        entitlementProjectionStatus: null,
        entitlementProjectionError: null,
        discount: {
          couponId: "coupon_family_15",
          promotionCodeId: null,
          amountOffPence: null,
          currency: null,
          durationInMonths: null,
          startsAt: 1787149200,
          endsAt: null,
          kind: "youth_family",
          percentOff: 15,
          duration: "forever",
        },
        paymentSchedule: {
          amountDueTodayPence: 0,
          firstPaymentAt: 1788220800,
          standardMonthlyPence: 7000,
          discountedMonthlyPence: 5950,
          discountedPaymentCount: null,
          fullPriceFrom: null,
        },
      }],
    });

    render(<AdminMemberships />);

    expect(await screen.findByText(
      "Participants: Alex Child · age 14; Sam Child · age 13 · guardian Ava Parent"
    )).toBeInTheDocument();
    expect(screen.getByText("Family discount applied")).toBeInTheDocument();
    expect(screen.getByText(/pay £59.50 per month instead of £70/i))
      .toBeInTheDocument();
  });

  it("repairs only the account already linked to the membership", async () => {
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        subscriptionId: "sub_projection_repair",
        payerUid: "repair-target",
        payerEmail: "repair@example.test",
        planKey: "adult_unlimited",
        planName: "Adult Unlimited Membership",
        state: "active",
        stripeStatus: "active",
        grantsAlphaWodAccess: true,
        entitlementTargetUid: "repair-target",
        participantFullName: "Repair Member",
        participantAge: 34,
        participantIsPayer: true,
        guardianFullName: null,
        currentPeriodEnd: 1_790_809_200,
        cancelAt: null,
        disputeOpen: false,
        accessRevoked: false,
        providerContractStatus: "verified",
        providerContractError: null,
        pastDueSince: null,
        confirmationEmailStatus: "sent",
        confirmationEmailError: null,
        confirmationEmailProviderId: "email_repair",
        cancellationRequestStatus: null,
        cancellationRequestError: null,
        entitlementProjectionStatus: "manual_review",
        entitlementProjectionError: "Interrupted before access projection.",
      }],
    });

    render(<AdminMemberships />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Repair Zero Alpha App access",
    }));

    await waitFor(() => {
      expect(mockLinkMembershipParticipant).toHaveBeenCalledWith(
        "sub_projection_repair",
        "repair-target"
      );
    });
    expect(screen.getByText(/reapplies access only to the account already linked/i))
      .toBeInTheDocument();
  });

  it("keeps a failed repair visible for an operator to retry", async () => {
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        subscriptionId: "sub_projection_failure",
        payerUid: "repair-target",
        payerEmail: "repair@example.test",
        planKey: "adult_unlimited",
        planName: "Adult Unlimited Membership",
        state: "active",
        stripeStatus: "active",
        grantsAlphaWodAccess: true,
        entitlementTargetUid: "repair-target",
        participantFullName: "Repair Member",
        participantAge: 34,
        participantIsPayer: true,
        guardianFullName: null,
        currentPeriodEnd: 1_790_809_200,
        cancelAt: null,
        disputeOpen: false,
        accessRevoked: false,
        providerContractStatus: "verified",
        providerContractError: null,
        pastDueSince: null,
        confirmationEmailStatus: "sent",
        confirmationEmailError: null,
        confirmationEmailProviderId: "email_repair",
        cancellationRequestStatus: null,
        cancellationRequestError: null,
        entitlementProjectionStatus: "manual_review",
        entitlementProjectionError: "Interrupted before access projection.",
      }],
    });
    mockLinkMembershipParticipant.mockRejectedValueOnce(
      new Error("Stripe state is temporarily unavailable.")
    );

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Repair Zero Alpha App access",
    }));

    expect(await screen.findByText("Stripe state is temporarily unavailable."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Repair Zero Alpha App access"}))
      .toBeEnabled();
  });
});
