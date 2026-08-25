import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminMemberships from "./AdminMemberships";

const mockListMemberships = jest.fn();
const mockLinkMembershipParticipant = jest.fn();
const mockReleaseAbandonedMembershipCheckout = jest.fn();

function interruptedCheckoutIssue(seed = "c") {
  return {
    intentId: `attempt_${seed.repeat(64)}`,
    planKey: "adult_unlimited",
    planName: "Adult Unlimited Membership",
    participantFullNames: ["Stacey Example"],
    participantCount: 1,
    payerUid: null,
    payerEmail: null,
    status: "created",
    createdAt: Date.parse("2026-08-24T09:00:00.000Z"),
    checkoutExpiresAt: 1_788_227_200,
    canRelease: true,
  };
}

jest.mock("../../../components/layout/AppBottomNav", () => () => (
  <nav aria-label="Primary" />
));

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
  releaseAbandonedMembershipCheckout: (...args: unknown[]) =>
    mockReleaseAbandonedMembershipCheckout(...args),
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
    mockReleaseAbandonedMembershipCheckout.mockResolvedValue({
      ok: true,
      outcome: "released",
      recoveryEmailStatus: "queued",
      recoveryEmailRecipient: "s***@example.test",
    });
    mockListMemberships.mockResolvedValue({
      ok: true,
      checkoutIssues: [],
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a cancellation manual-review record in attention and shows its error", async () => {
    render(<AdminMemberships />);

    expect(await screen.findByText("Review Member")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "View details for Review Member",
    }));
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

  it("lets an admin verify, release and queue an email for an interrupted checkout", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      checkoutIssues: [{
        intentId: `attempt_${"a".repeat(64)}`,
        planKey: "adult_unlimited",
        planName: "Adult Unlimited Membership",
        participantFullNames: ["Stacey Example"],
        participantCount: 1,
        payerUid: null,
        payerEmail: null,
        status: "created",
        createdAt: Date.parse("2026-08-24T09:00:00.000Z"),
        checkoutExpiresAt: 1_788_227_200,
        canRelease: true,
      }],
    });

    render(<AdminMemberships />);

    expect(await screen.findByText("Stacey Example")).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Interrupted checkouts"}))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by membership status"), {
      target: {value: "issues"},
    });
    expect(screen.getByText("Stacey Example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Verify, release & email"}));

    await waitFor(() => expect(mockReleaseAbandonedMembershipCheckout)
      .toHaveBeenCalledWith(`attempt_${"a".repeat(64)}`));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
      "Verify, release and email Stacey Example?"
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
      "a recovery email will be queued after release"
    ));
    expect(await screen.findByText(
      "Stacey Example’s unpaid checkout was released. They can now start again. " +
      "A recovery email was queued to s***@example.test."
    )).toBeInTheDocument();
  });

  it("reports an email that was already queued without calling it sent", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      checkoutIssues: [interruptedCheckoutIssue()],
    });
    mockReleaseAbandonedMembershipCheckout.mockResolvedValue({
      ok: true,
      outcome: "already_released",
      recoveryEmailStatus: "already_queued",
      recoveryEmailRecipient: "s***@example.test",
    });

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Stacey Example’s checkout was already released. " +
      "A recovery email was already queued to s***@example.test."
    );
    expect(status).not.toHaveTextContent(/\bsent\b/i);
  });

  it("requires manual follow-up when Stripe has no verified email address", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      checkoutIssues: [interruptedCheckoutIssue("d")],
    });
    mockReleaseAbandonedMembershipCheckout.mockResolvedValue({
      ok: true,
      outcome: "released",
      recoveryEmailStatus: "manual_review",
      recoveryEmailRecipient: null,
    });

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "No recovery email was queued because no verified email address was available. " +
      "Follow up with the customer manually."
    );
    expect(status).toHaveClass("text-amber-100");
    expect(status).not.toHaveTextContent(/\bsent\b/i);
  });

  it("reports a quarantined email record without blaming the address", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      checkoutIssues: [interruptedCheckoutIssue("f")],
    });
    mockReleaseAbandonedMembershipCheckout.mockResolvedValue({
      ok: true,
      outcome: "released",
      recoveryEmailStatus: "manual_review",
      recoveryEmailRecipient: "s***@example.test",
    });

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "No recovery email was queued because its delivery record needs billing review."
    );
    expect(status).not.toHaveTextContent(/no verified email address/i);
    expect(status).not.toHaveTextContent(/\bsent\b/i);
  });

  it("handles an older release response without claiming an email was queued", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      checkoutIssues: [interruptedCheckoutIssue("e")],
    });
    mockReleaseAbandonedMembershipCheckout.mockResolvedValue({
      ok: true,
      outcome: "released",
    });

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Stacey Example’s unpaid checkout was released. They can now start again. " +
      "No recovery email was queued."
    );
  });

  it("warns when an older billing service omits interrupted checkout data", async () => {
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      summary: null,
    });

    render(<AdminMemberships />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Interrupted checkout data is unavailable because the billing admin service is out of date."
    );
    expect(screen.queryByRole("heading", {name: "Interrupted checkouts"}))
      .not.toBeInTheDocument();
  });

  it("refreshes an interrupted checkout after a provider-side release refusal", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const checkoutIssue = {
      intentId: `attempt_${"b".repeat(64)}`,
      planKey: "youth_youngstars",
      planName: "Mini Alphas",
      participantFullNames: ["Stacey Example"],
      participantCount: 1,
      payerUid: null,
      payerEmail: null,
      status: "created",
      createdAt: Date.parse("2026-08-24T09:00:00.000Z"),
      checkoutExpiresAt: 1_788_227_200,
      canRelease: true,
    };
    mockListMemberships
      .mockResolvedValueOnce({ok: true, memberships: [], checkoutIssues: [checkoutIssue]})
      .mockResolvedValueOnce({ok: true, memberships: [], checkoutIssues: []});
    mockReleaseAbandonedMembershipCheckout.mockRejectedValueOnce(
      new Error("Stripe now reports this checkout is processing.")
    );

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stripe now reports this checkout is processing."
    );
    expect(mockListMemberships).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Stacey Example")).not.toBeInTheDocument();
  });

  it("keeps a claimed release visible after an error so staff can resume it", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const createdIssue = interruptedCheckoutIssue("9");
    const claimedIssue = {
      ...createdIssue,
      status: "release_claimed",
    };
    mockListMemberships
      .mockResolvedValueOnce({
        ok: true,
        memberships: [],
        checkoutIssues: [createdIssue],
      })
      .mockResolvedValueOnce({
        ok: true,
        memberships: [],
        checkoutIssues: [claimedIssue],
      })
      .mockResolvedValueOnce({
        ok: true,
        memberships: [],
        checkoutIssues: [],
      });
    mockReleaseAbandonedMembershipCheckout
      .mockRejectedValueOnce(new Error("The release response was interrupted."))
      .mockResolvedValueOnce({
        ok: true,
        outcome: "released",
        recoveryEmailStatus: "queued",
        recoveryEmailRecipient: "s***@example.test",
      });

    render(<AdminMemberships />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Verify, release & email",
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The release response was interrupted."
    );
    expect(screen.getByText("Release interrupted — retry")).toBeInTheDocument();
    expect(screen.getByText("Stacey Example")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Verify, release & email",
    }));
    await waitFor(() => expect(mockReleaseAbandonedMembershipCheckout)
      .toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "A recovery email was queued to s***@example.test."
    );
    expect(mockListMemberships).toHaveBeenCalledTimes(3);
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

    expect(await screen.findByText("Scheduled Member")).toBeInTheDocument();
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", {
      name: "View details for Scheduled Member",
    }));
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
        planName: "Teen Alphas",
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
          couponId: "coupon_family_10",
          promotionCodeId: null,
          amountOffPence: null,
          currency: null,
          durationInMonths: null,
          startsAt: 1787149200,
          endsAt: null,
          kind: "youth_family",
          percentOff: 10,
          duration: "forever",
        },
        paymentSchedule: {
          amountDueTodayPence: 0,
          firstPaymentAt: 1788220800,
          standardMonthlyPence: 7000,
          discountedMonthlyPence: 6300,
          discountedPaymentCount: null,
          fullPriceFrom: null,
        },
        monthlyRecurringPence: 6300,
        revenueState: "at_risk",
      }],
    });

    render(<AdminMemberships />);

    expect(await screen.findByText("Alex Child")).toBeInTheDocument();
    expect(screen.getByText("Sam Child")).toBeInTheDocument();
    expect(screen.getByText("Guardian Ava Parent")).toBeInTheDocument();
    expect(screen.getByText("£63")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "View details for Alex Child, Sam Child",
    }));
    expect(screen.getByText("Family discount applied")).toBeInTheDocument();
    expect(screen.getByText(/10% off the full monthly total/i)).toBeInTheDocument();
    expect(screen.getByText(/pay £63 per month instead of £70/i))
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
      name: "View details for Repair Member",
    }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Repair Zero Alpha App access",
    }));

    await waitFor(() => {
      expect(mockLinkMembershipParticipant).toHaveBeenCalledWith(
        "sub_projection_repair",
        "repair-target"
      );
    });
    expect(screen.getByText(/Zero Alpha App access target: repair-target/i))
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
      name: "View details for Repair Member",
    }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Repair Zero Alpha App access",
    }));

    expect(await screen.findByText("Stripe state is temporarily unavailable."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Repair Zero Alpha App access"}))
      .toBeEnabled();
  });

  it("shows server-calculated income and filters rows by membership plan", async () => {
    const bucket = {
      totalSubscriptions: 1,
      openSubscriptions: 1,
      openParticipants: 1,
      currentSubscriptions: 1,
      scheduledSubscriptions: 0,
      paymentIssueSubscriptions: 0,
      awaitingPaymentSubscriptions: 0,
      endedSubscriptions: 0,
      projectedMonthlyPence: 4500,
      atRiskMonthlyPence: 0,
    };
    mockListMemberships.mockResolvedValue({
      ok: true,
      memberships: [
        {
          subscriptionId: "sub_gym",
          payerUid: "payer-gym",
          payerEmail: "gym@example.test",
          planKey: "adult_gym",
          planName: "Adult Gym Only",
          state: "active",
          stripeStatus: "active",
          grantsAlphaWodAccess: false,
          entitlementTargetUid: null,
          participantFullName: "Gym Member",
          participantAge: 30,
          participantIsPayer: true,
          guardianFullName: null,
          currentPeriodEnd: 1_790_809_200,
          cancelAt: null,
          disputeOpen: false,
          accessRevoked: false,
          monthlyRecurringPence: 4500,
          revenueState: "projected",
        },
        {
          subscriptionId: "sub_ladies",
          payerUid: "payer-ladies",
          payerEmail: "ladies@example.test",
          planKey: "adult_ladies",
          planName: "Adult Ladies Only Membership",
          state: "active",
          stripeStatus: "active",
          grantsAlphaWodAccess: false,
          entitlementTargetUid: null,
          participantFullName: "Ladies Member",
          participantAge: 32,
          participantIsPayer: true,
          guardianFullName: null,
          currentPeriodEnd: 1_790_809_200,
          cancelAt: null,
          disputeOpen: false,
          accessRevoked: false,
          monthlyRecurringPence: 5000,
          revenueState: "projected",
        },
      ],
      summary: {
        ...bucket,
        totalSubscriptions: 2,
        openSubscriptions: 2,
        openParticipants: 2,
        currentSubscriptions: 2,
        projectedMonthlyPence: 9500,
        asOf: "2026-08-24T12:00:00.000Z",
        isComplete: true,
        reportingLimit: 500,
        plans: [
          {planKey: "adult_gym", planName: "Adult Gym Only", ...bucket},
          {
            planKey: "adult_ladies",
            planName: "Adult Ladies Only Membership",
            ...bucket,
            projectedMonthlyPence: 5000,
          },
        ],
      },
    });

    render(<AdminMemberships />);

    expect(await screen.findByText("£95")).toBeInTheDocument();
    expect(screen.getByText("Gym Member")).toBeInTheDocument();
    expect(screen.getByText("Ladies Member")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", {name: /Adult Gym Only 1/i}));

    expect(screen.getByText("Gym Member")).toBeInTheDocument();
    expect(screen.queryByText("Ladies Member")).not.toBeInTheDocument();
    expect(screen.getByText(/£45 projected monthly/i)).toBeInTheDocument();
  });
});
