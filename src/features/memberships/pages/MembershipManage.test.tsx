import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MembershipManage from "./MembershipManage";

const mockClaimMembership = jest.fn();
const mockGetMyMemberships = jest.fn();
const mockReadPendingClaim = jest.fn();
const mockReadPendingClaimVerifier = jest.fn();
const mockClearPendingClaim = jest.fn();
const mockRequestMembershipCancellation = jest.fn();
const mockNavigate = jest.fn();
const mockSendEmailVerification = jest.fn();
const mockRefreshAppUser = jest.fn();
let mockAuthUser = { uid: "buyer-1", emailVerified: false };
let mockAppUser: Record<string, unknown> | null = null;
let mockSearch = "";

jest.mock("firebase/auth", () => ({
  sendEmailVerification: (...args: unknown[]) => mockSendEmailVerification(...args),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: mockAuthUser,
    appUser: mockAppUser,
    refreshAppUser: mockRefreshAppUser,
  }),
}));

jest.mock("../services/membership", () => ({
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
  claimMembership: (...args: unknown[]) => mockClaimMembership(...args),
  clearPendingClaim: () => mockClearPendingClaim(),
  createCustomerPortalSession: jest.fn(),
  formatIsoDate: (value: string) => value,
  formatUnixDate: (value: number | null) => String(value ?? "—"),
  getMyMemberships: (...args: unknown[]) => mockGetMyMemberships(...args),
  readPendingClaim: () => mockReadPendingClaim(),
  readPendingClaimVerifier: () => mockReadPendingClaimVerifier(),
  requestMembershipCancellation: (...args: unknown[]) =>
    mockRequestMembershipCancellation(...args),
}));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(mockSearch)],
  }),
  { virtual: true }
);

const cancellationPreview = {
  nextBillingDate: "2026-09-01",
  noticeDeadlineMet: true,
  noticeDaysGiven: 14,
  noticeDeadlineDate: "2026-08-18",
  finalPaymentDate: null,
  accessEndsOnDate: "2026-08-31",
  cancelAtUnixSeconds: 1788217200,
};

const activeMembership = {
  subscriptionId: "sub_active",
  planKey: "adult_unlimited",
  planName: "Adult Unlimited Membership",
  state: "active",
  grantsAlphaWodAccess: true,
  participantFullName: "Alex Member",
  participantIsPayer: true,
  currentPeriodEnd: 1788217200,
  cancelAt: null,
  cancellationOutcome: null,
  cancellationPending: false,
  cancellationManualReview: false,
  cancellationRequestError: null,
  providerContractStatus: "verified",
  providerContractError: null,
  entitlementProjectionStatus: "applied",
  entitlementProjectionError: null,
  coolingOffEndsAt: "2026-01-15T23:59:59.999Z",
  coolingOffActive: false,
};

const multiChildTeenAlphasMembership = {
  ...activeMembership,
  subscriptionId: "sub_teenstars_family",
  planKey: "youth_teenstars",
  planName: "TEEN ALPHAS - 11 & UP",
  grantsAlphaWodAccess: false,
  participantFullName: "Alex Child",
  participantFullNames: ["Alex Child", "Sam Child"],
  participantCount: 2,
  participantIsPayer: false,
};

describe("MembershipManage pending-claim recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { uid: "buyer-1", emailVerified: false };
    mockAppUser = null;
    mockRefreshAppUser.mockResolvedValue(undefined);
    mockSendEmailVerification.mockResolvedValue(undefined);
    mockSearch = "";
    mockReadPendingClaim.mockReturnValue("cs_waiting_for_webhook");
    mockReadPendingClaimVerifier.mockReturnValue(
      "12345678-1234-4123-8123-123456789abc"
    );
    mockClaimMembership.mockRejectedValue(
      Object.assign(new Error("Membership not found"), { code: "functions/not-found" })
    );
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [],
      cancellationPreview,
    });
  });

  it("loads current memberships even when a pending checkout is not fulfilled yet", async () => {
    render(<MembershipManage />);

    await waitFor(() => expect(mockGetMyMemberships).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Loading your memberships…")).not.toBeInTheDocument();
    expect(screen.getByText(/checkout is still being confirmed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try linking my membership/i }));
    await waitFor(() => expect(mockClaimMembership).toHaveBeenCalledTimes(2));
    expect(mockClaimMembership).toHaveBeenLastCalledWith(
      "cs_waiting_for_webhook",
      "12345678-1234-4123-8123-123456789abc"
    );
  });

  it("clears a terminal pending link and preserves its useful error", async () => {
    mockClaimMembership.mockRejectedValue(
      Object.assign(new Error("This purchase link has expired."), {
        code: "functions/deadline-exceeded",
      })
    );

    render(<MembershipManage />);

    expect(await screen.findByText("This purchase link has expired.")).toBeInTheDocument();
    expect(mockClearPendingClaim).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockGetMyMemberships).toHaveBeenCalledTimes(1));
    expect(screen.getByText("This purchase link has expired.")).toBeInTheDocument();
  });

  it("claims by verified email after returning from the verification link", async () => {
    mockSearch = "claim=email";
    mockReadPendingClaim.mockReturnValue(null);
    mockReadPendingClaimVerifier.mockReturnValue(null);
    mockClaimMembership.mockResolvedValue({ok: true, claimed: ["sub_email"]});

    render(<MembershipManage />);

    await waitFor(() => expect(mockClaimMembership).toHaveBeenCalledWith(
      undefined,
      undefined
    ));
    expect(mockNavigate).toHaveBeenCalledWith("/account/membership", {replace: true});
  });

  it("lets an already-signed-in buyer request email verification", async () => {
    mockSearch = "claim=email";
    mockReadPendingClaim.mockReturnValue(null);
    mockReadPendingClaimVerifier.mockReturnValue(null);
    mockClaimMembership.mockRejectedValue(Object.assign(
      new Error("Sign in with the verified email used to pay."),
      {code: "functions/permission-denied"}
    ));

    render(<MembershipManage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Send verification email",
    }));
    await waitFor(() => expect(mockSendEmailVerification).toHaveBeenCalledWith(
      mockAuthUser,
      {url: `${window.location.origin}/account/membership?claim=email`}
    ));
    expect(await screen.findByText(/Verification email sent/i)).toBeInTheDocument();
  });
});

describe("MembershipManage cancellation confirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { uid: "buyer-1", emailVerified: true };
    mockSearch = "";
    mockReadPendingClaim.mockReturnValue(null);
    mockReadPendingClaimVerifier.mockReturnValue(null);
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [activeMembership],
      cancellationPreview,
    });
    mockRequestMembershipCancellation.mockResolvedValue({
      ok: true,
      outcome: cancellationPreview,
    });
  });

  it("submits the exact cancel-at value displayed in the preview", async () => {
    render(<MembershipManage />);

    fireEvent.click(await screen.findByRole("button", {name: "Request cancellation"}));
    expect(screen.getByText(
      /Your request would arrive 14 calendar days before/i
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Confirm cancellation"}));

    await waitFor(() => expect(mockRequestMembershipCancellation).toHaveBeenCalledWith(
      "sub_active",
      cancellationPreview.cancelAtUnixSeconds
    ));
  });

  it.each([
    ["standard", multiChildTeenAlphasMembership],
    ["presale", {
      ...multiChildTeenAlphasMembership,
      state: "scheduled",
      billingMode: "presale_deferred",
      cancellationMode: "cancel_before_start",
      cancellationPreview,
    }],
  ])("states the whole-family impact before a %s cancellation", async (_label, membership) => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [membership],
      cancellationPreview,
    });

    render(<MembershipManage />);
    fireEvent.click(await screen.findByRole("button", {name: "Request cancellation"}));

    expect(screen.getByText(/Submitting this request cancels the whole TEEN ALPHAS - 11 & UP/))
      .toHaveTextContent(
        "The places for Alex Child and Sam Child will all end with it. " +
        "Individual children cannot be removed online."
      );
  });

  it("shows a presale membership as scheduled with £0 today and no access warning", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        state: "scheduled",
        billingMode: "presale_deferred",
        serviceStartsAt: 1788220800,
        firstPaymentAt: 1788220800,
        billingCycleAnchor: 1788220800,
        initialChargePence: 0,
        cancellationMode: "cancel_before_start",
        cancellationPreview,
        coolingOffActive: true,
        entitlementProjectionStatus: null,
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
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Scheduled — starts 1 September"))
      .toBeInTheDocument();
    expect(screen.getByText("Nothing charged today")).toBeInTheDocument();
    expect(screen.getByText(/This membership does not unlock Zero Alpha App access/i))
      .toBeInTheDocument();
    expect(screen.getByText("Existing-member discount applied")).toBeInTheDocument();
    expect(screen.getByText(/£5 off each of your first 3 monthly payments/i))
      .toBeInTheDocument();
    expect(screen.queryByText("Zero Alpha App access is still pending"))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Cooling-off cancellation needs staff"))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Request cancellation"}));
    expect(screen.getByText(/Nothing will be charged and no membership access/i))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Cancel scheduled membership"}))
      .toBeInTheDocument();
  });

  it("shows every TEEN ALPHAS - 11 & UP child with its frozen legacy family discount", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        planKey: "youth_teenstars",
        planName: "TEEN ALPHAS - 11 & UP",
        grantsAlphaWodAccess: false,
        participantFullName: "Alex Child",
        participantFullNames: ["Alex Child", "Sam Child"],
        participantCount: 2,
        participantIsPayer: false,
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
      cancellationPreview,
    });

    render(<MembershipManage />);

    const planHeading = await screen.findByRole("heading", {
      level: 2,
      name: "TEEN ALPHAS - 11 & UP",
    });
    expect(planHeading).not.toHaveClass("uppercase");
    expect(await screen.findByText("Participants: Alex Child, Sam Child"))
      .toBeInTheDocument();
    expect(screen.getByText("Family discount applied")).toBeInTheDocument();
    expect(screen.getByText(/15% off the full monthly total/i)).toBeInTheDocument();
    expect(screen.getByText(/pay £59.50 per month instead of £70/i))
      .toBeInTheDocument();
  });

  it("returns an existing member to the app immediately after scheduled checkout", async () => {
    mockAppUser = {
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
    };
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        state: "scheduled",
        billingMode: "presale_deferred",
        serviceStartsAt: 1788220800,
        firstPaymentAt: 1788220800,
        billingCycleAnchor: 1788220800,
        initialChargePence: 0,
        cancellationMode: "cancel_before_start",
        cancellationPreview,
        entitlementProjectionStatus: null,
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText(/existing Zero Alpha App access is available now/i))
      .toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Continue to Zero Alpha App"}))
      .toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText(/does not unlock Zero Alpha App access before then/i))
      .not.toBeInTheDocument();
  });

  it("keeps a cooling-off cancellation action available and marks its request kind", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{...multiChildTeenAlphasMembership, coolingOffActive: true}],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cooling-off period"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Cancel during cooling-off period",
    }));
    expect(screen.getByText(/Submitting this request cancels the whole TEEN ALPHAS - 11 & UP/))
      .toHaveTextContent(
        "The places for Alex Child and Sam Child will all end with it. " +
        "Individual children cannot be removed online."
      );
    fireEvent.click(screen.getByRole("button", {
      name: "Submit cooling-off cancellation",
    }));

    await waitFor(() => expect(mockRequestMembershipCancellation).toHaveBeenCalledWith(
      "sub_teenstars_family",
      cancellationPreview.cancelAtUnixSeconds,
      "cooling_off"
    ));
  });

  it("gives an actionable fallback when the old backend cannot record cooling-off", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{...activeMembership, coolingOffActive: true}],
      cancellationPreview,
    });
    mockRequestMembershipCancellation.mockRejectedValue(Object.assign(
      new Error("Manual cooling-off review"),
      {
        code: "functions/failed-precondition",
        details: {reason: "cooling_off_manual_review"},
      }
    ));

    render(<MembershipManage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Cancel during cooling-off period",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Submit cooling-off cancellation",
    }));

    expect(await screen.findByText(/could not record this cooling-off cancellation online/i))
      .toBeInTheDocument();
    expect(screen.getAllByText(/keep a copy of your sent message/i)).not.toHaveLength(0);
  });

  it("refreshes and re-presents a changed preview before allowing another confirmation", async () => {
    const updatedPreview = {
      ...cancellationPreview,
      noticeDeadlineMet: false,
      noticeDaysGiven: 13,
      noticeDeadlineDate: "2026-08-19",
      finalPaymentDate: "2026-09-01",
      accessEndsOnDate: "2026-09-30",
      cancelAtUnixSeconds: 1790809200,
    };
    mockGetMyMemberships
      .mockResolvedValueOnce({
        ok: true,
        memberships: [activeMembership],
        cancellationPreview,
      })
      .mockResolvedValue({
        ok: true,
        memberships: [activeMembership],
        cancellationPreview: updatedPreview,
      });
    mockRequestMembershipCancellation
      .mockRejectedValueOnce(Object.assign(new Error("Preview is stale."), {
        code: "functions/failed-precondition",
      }))
      .mockResolvedValueOnce({ok: true, outcome: updatedPreview});

    render(<MembershipManage />);
    fireEvent.click(await screen.findByRole("button", {name: "Request cancellation"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirm cancellation"}));

    expect(await screen.findByText(
      "The cancellation dates changed while you were confirming. Review the updated dates and confirm again."
    )).toBeInTheDocument();
    await waitFor(() => expect(mockGetMyMemberships).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/13 calendar days before/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Confirm cancellation"}));
    await waitFor(() => expect(mockRequestMembershipCancellation).toHaveBeenLastCalledWith(
      "sub_active",
      updatedPreview.cancelAtUnixSeconds
    ));
  });

  it("keeps cancellation available for a revoked membership without a schedule", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{...activeMembership, state: "revoked"}],
      cancellationPreview,
    });

    render(<MembershipManage />);

    const requestButton = await screen.findByRole("button", {
      name: "Request cancellation",
    });
    fireEvent.click(requestButton);
    expect(screen.getByRole("button", {name: "Confirm cancellation"})).toBeInTheDocument();
  });

  it("shows a retained cancellation as processing without asking for a duplicate", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        cancelAt: 1_790_809_200,
        cancellationPending: true,
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancellation request received")).toBeInTheDocument();
    expect(screen.getByText("Update processing")).toBeInTheDocument();
    expect(screen.queryByText("Cancellation confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Membership ends")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Retry cancellation"}))
      .not.toBeInTheDocument();
    expect(screen.getByText(/do not need to submit another request/i)).toBeInTheDocument();
  });

  it("shows the projected cancellation receipt and accepted state", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        cancellationRequestStatus: "accepted",
        cancellationRequestKind: "cooling_off",
        cancellationReceipt: {
          reference: "cancel_COFF_01J5X5YJ7S",
          receivedAt: "2026-08-19T14:05:00.000Z",
          kind: "cooling_off",
          acknowledgementStatus: "sent",
          refundReviewRequired: false,
        },
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancellation receipt")).toBeInTheDocument();
    expect(screen.getByText("cancel_COFF_01J5X5YJ7S")).toBeInTheDocument();
    expect(screen.getByText("19 Aug 2026, 15:05"))
      .toHaveAttribute("dateTime", "2026-08-19T14:05:00.000Z");
    expect(screen.getByText("Cancellation request accepted")).toBeInTheDocument();
    expect(screen.getByText(/Cooling-off cancellation · Acknowledgement sent/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();
  });

  it.each([
    ["contractual", "Membership cancellation"],
    ["presale_withdrawal", "Cancellation before start"],
  ] as const)(
    "shows the recorded receipt time for a %s request",
    async (kind, kindLabel) => {
      mockGetMyMemberships.mockResolvedValue({
        ok: true,
        memberships: [{
          ...activeMembership,
          cancellationRequestStatus: "accepted",
          cancellationRequestKind: kind,
          cancellationReceipt: {
            reference: `cancel_${kind}`,
            receivedAt: "2026-08-19T14:05:00.000Z",
            kind,
          },
        }],
        cancellationPreview,
      });

      render(<MembershipManage />);

      expect(await screen.findByText(`cancel_${kind}`)).toBeInTheDocument();
      expect(screen.getByText("19 Aug 2026, 15:05"))
        .toHaveAttribute("dateTime", "2026-08-19T14:05:00.000Z");
      expect(screen.getByText(kindLabel)).toBeInTheDocument();
      expect(screen.queryByText(/Acknowledgement pending/i)).not.toBeInTheDocument();
    }
  );

  it("confirms that every child place ends with a family subscription", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...multiChildTeenAlphasMembership,
        state: "cancelled",
        cancellationOutcome: cancellationPreview,
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText(/This cancellation applies to the whole TEEN ALPHAS - 11 & UP/))
      .toHaveTextContent("The places for Alex Child and Sam Child all end with it.");
  });

  it("separates refund review from acceptance of the cancellation request", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        cancellationRequestStatus: "refund_review",
        cancellationRequestKind: "cooling_off",
        cancellationReceipt: {
          reference: "cancel_refund_review",
          receivedAt: "2026-08-19T14:05:00.000Z",
          kind: "cooling_off",
          acknowledgementStatus: "pending",
          refundReviewRequired: true,
        },
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancellation accepted · refund review"))
      .toBeInTheDocument();
    expect(screen.getByText("Refund review")).toBeInTheDocument();
    expect(screen.getByText(/reviewing only whether a refund/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();
  });

  it("routes a cancellation in manual review to support instead of another request", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        cancelAt: 1_790_809_200,
        cancellationManualReview: true,
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancellation needs support")).toBeInTheDocument();
    expect(screen.getByText("Needs support")).toBeInTheDocument();
    expect(screen.getByText(/original request has been retained for staff review/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Retry cancellation"}))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Cancellation confirmed")).not.toBeInTheDocument();
  });

  it("shows refund review separately from a retained cancellation end date", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        state: "cancelled",
        cancellationOutcome: cancellationPreview,
        cancellationManualReview: true,
        cancellationRequestError: "Review charges after the promised date and refund.",
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancellation confirmed")).toBeInTheDocument();
    expect(screen.getByText("Cancellation needs support")).toBeInTheDocument();
    expect(screen.getByText(/charges or a refund still need staff review/i))
      .toBeInTheDocument();
  });

  it("describes a withdrawn presale as cancelled before start", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        state: "cancelled",
        billingMode: "presale_deferred",
        initialChargePence: 0,
        firstPaymentReceivedAt: null,
        cancellationOutcome: cancellationPreview,
      }],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cancelled before start")).toBeInTheDocument();
    expect(screen.getByText(/No payment was taken.*cancelled before it started/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/Your access ends on/i)).not.toBeInTheDocument();
  });
});
