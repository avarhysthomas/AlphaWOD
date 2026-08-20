import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import MembershipSuccess from "./MembershipSuccess";

const mockRememberPendingClaim = jest.fn();
const mockClearPendingClaim = jest.fn();
const mockClearCheckoutAttempt = jest.fn();
const mockReadCheckoutAttemptId = jest.fn();
const mockReadPendingClaim = jest.fn();
const mockReadPendingClaimVerifier = jest.fn();
const mockClaimMembership = jest.fn();
const mockGetMyMemberships = jest.fn();
const mockRefreshAppUser = jest.fn();
let mockUser: { uid: string } | null = { uid: "buyer-1" };
let mockAppUser: Record<string, unknown> | null = null;
let mockLoading = false;
let mockSearchParams = "plan=adult_unlimited&session_id=cs_signed_in";

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    appUser: mockAppUser,
    loading: mockLoading,
    refreshAppUser: mockRefreshAppUser,
  }),
}));
jest.mock("../services/membership", () => ({
  claimMembership: (...args: unknown[]) => mockClaimMembership(...args),
  clearCheckoutAttempt: (...args: unknown[]) => mockClearCheckoutAttempt(...args),
  clearPendingClaim: (...args: unknown[]) => mockClearPendingClaim(...args),
  getMyMemberships: (...args: unknown[]) => mockGetMyMemberships(...args),
  formatUnixDate: (value: number | null) => {
    if (value === 1788217200) return "1 September 2026";
    if (value === 1796083200) return "1 December 2026";
    return String(value ?? "—");
  },
  readCheckoutAttemptId: () => mockReadCheckoutAttemptId(),
  readPendingClaim: () => mockReadPendingClaim(),
  readPendingClaimVerifier: () => mockReadPendingClaimVerifier(),
  rememberPendingClaim: (...args: unknown[]) => mockRememberPendingClaim(...args),
}));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams(mockSearchParams)],
  }),
  { virtual: true }
);

const activeMembership = {
  subscriptionId: "sub_1",
  planKey: "adult_unlimited",
  planName: "Adult Unlimited Membership",
  state: "active",
  grantsAlphaWodAccess: true,
  participantFullName: "Buyer One",
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

describe("MembershipSuccess claim persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-19T09:00:00.000Z"));
    mockUser = { uid: "buyer-1" };
    mockAppUser = null;
    mockLoading = false;
    mockSearchParams = "plan=adult_unlimited&session_id=cs_signed_in";
    mockReadCheckoutAttemptId.mockReturnValue("12345678-1234-4123-8123-123456789abc");
    mockReadPendingClaim.mockReturnValue(null);
    mockReadPendingClaimVerifier.mockReturnValue(null);
    mockClaimMembership.mockResolvedValue({ok: true, claimed: ["sub_1"]});
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [activeMembership],
      cancellationPreview: null,
    });
    mockRefreshAppUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not persist a pending claim for a buyer who was already signed in", async () => {
    render(<MembershipSuccess />);

    await waitFor(() => expect(mockGetMyMemberships).toHaveBeenCalledTimes(1));
    expect(mockRememberPendingClaim).not.toHaveBeenCalled();
    expect(mockClearPendingClaim).toHaveBeenCalled();
    expect(mockClearCheckoutAttempt).toHaveBeenCalled();
  });

  it("still preserves the checkout session for a signed-out buyer", () => {
    mockUser = null;
    render(<MembershipSuccess />);

    expect(mockRememberPendingClaim).toHaveBeenCalledWith(
      "cs_signed_in",
      "12345678-1234-4123-8123-123456789abc"
    );
  });

  it("offers both account paths after an Adult Unlimited purchase", () => {
    mockUser = null;
    render(<MembershipSuccess />);

    expect(screen.getByText(/Nothing was charged today/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero Alpha App access will not be unlocked before/i))
      .toBeInTheDocument();
    expect(
      screen.getByRole("link", {name: "Create Zero Alpha App account"})
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", {name: "Log in to Zero Alpha App"}))
      .toHaveAttribute("href", "/");
  });

  it("keeps the Adult Unlimited account choices usable after a refresh", () => {
    mockUser = null;
    mockSearchParams = "plan=adult_unlimited";
    mockReadCheckoutAttemptId.mockReturnValue(null);
    mockReadPendingClaim.mockReturnValue("cs_remembered");
    mockReadPendingClaimVerifier.mockReturnValue(
      "12345678-1234-4123-8123-123456789abc"
    );
    render(<MembershipSuccess />);

    expect(screen.getByRole("link", {name: "Create Zero Alpha App account"}))
      .toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Log in to Zero Alpha App"}))
      .toBeInTheDocument();
    expect(mockRememberPendingClaim).toHaveBeenCalledWith(
      "cs_remembered",
      "12345678-1234-4123-8123-123456789abc"
    );
  });

  it.each([
    "adult_ladies",
    "adult_gym",
    "youth_youngstars",
    "youth_teenstars",
  ])("shows thank-you only for the %s plan", (planKey) => {
    mockUser = null;
    mockSearchParams = `plan=${planKey}&session_id=cs_signed_in`;
    render(<MembershipSuccess />);

    expect(screen.getByRole("heading", {name: "Thank you"})).toBeInTheDocument();
    expect(screen.getByText(/There’s nothing else you need to do on this page/i))
      .toBeInTheDocument();
    expect(screen.queryByText("Use Zero Alpha App with your membership"))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name: "Create Zero Alpha App account"}))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name: "Log in to Zero Alpha App"}))
      .not.toBeInTheDocument();
  });

  it("fails closed to thank-you only when the returned plan is missing or invalid", () => {
    mockUser = null;
    mockSearchParams = "plan=not-a-plan&session_id=cs_signed_in";
    render(<MembershipSuccess />);

    expect(screen.getByRole("heading", {name: "Thank you"})).toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /Zero Alpha App account/i}))
      .not.toBeInTheDocument();
  });

  it("waits for Firebase Auth, then persists the claim only after signed-out resolution", () => {
    mockUser = null;
    mockLoading = true;
    const { rerender } = render(<MembershipSuccess />);

    expect(mockRememberPendingClaim).not.toHaveBeenCalled();
    expect(mockClearPendingClaim).not.toHaveBeenCalled();
    expect(mockClearCheckoutAttempt).toHaveBeenCalled();

    mockLoading = false;
    rerender(<MembershipSuccess />);
    expect(mockRememberPendingClaim).toHaveBeenCalledWith(
      "cs_signed_in",
      "12345678-1234-4123-8123-123456789abc"
    );
    expect(mockClearCheckoutAttempt).toHaveBeenCalled();
  });

  it("does not show an older membership as confirmation for a pending checkout", async () => {
    mockClaimMembership.mockRejectedValue(
      Object.assign(new Error("Still processing"), {code: "functions/not-found"})
    );
    render(<MembershipSuccess />);

    expect(screen.getByText("Checkout received")).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(mockGetMyMemberships).not.toHaveBeenCalled();
    expect(screen.queryByText("Go to Zero Alpha App")).not.toBeInTheDocument();
  });

  it("does not show AlphaWOD account actions for a signed-in non-access plan", async () => {
    mockSearchParams = "plan=adult_gym&session_id=cs_signed_in";
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        planKey: "adult_gym",
        planName: "Adult Gym Only",
        grantsAlphaWodAccess: false,
      }],
      cancellationPreview: null,
    });
    render(<MembershipSuccess />);

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(screen.queryByText("View my membership")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Zero Alpha App")).not.toBeInTheDocument();
  });

  it("shows the exact membership's current revoked state instead of active-access copy", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{...activeMembership, state: "revoked"}],
      cancellationPreview: null,
    });
    render(<MembershipSuccess />);

    expect(await screen.findByText("Membership needs attention")).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText(/access has been unlocked/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Zero Alpha App")).not.toBeInTheDocument();
  });

  it("does not call AlphaWOD unlocked while entitlement projection needs review", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        entitlementProjectionStatus: "manual_review",
        entitlementProjectionError: "Profile missing",
      }],
      cancellationPreview: null,
    });
    render(<MembershipSuccess />);

    expect(await screen.findByText("Payment confirmed — access pending"))
      .toBeInTheDocument();
    expect(screen.queryByText(/access has been unlocked/i)).not.toBeInTheDocument();
  });

  it("confirms a presale signup without implying payment or access is active", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{
        ...activeMembership,
        state: "scheduled",
        billingMode: "presale_deferred",
        serviceStartsAt: 1788217200,
        firstPaymentAt: 1788220800,
        billingCycleAnchor: 1788220800,
        initialChargePence: 0,
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
      cancellationPreview: null,
    });

    render(<MembershipSuccess />);

    expect(await screen.findByText("Membership scheduled")).toBeInTheDocument();
    expect(screen.getByText(/nothing was charged today/i)).toBeInTheDocument();
    expect(screen.getByText(/will not unlock Zero Alpha App access until/i))
      .toBeInTheDocument();
    expect(screen.getByText("Existing-member discount applied")).toBeInTheDocument();
    expect(screen.getByText(/The standard price resumes on 1 December 2026/i))
      .toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name: "Go to Zero Alpha App"}))
      .not.toBeInTheDocument();
  });

  it("keeps an existing member's app access available after presale checkout", async () => {
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
        serviceStartsAt: 1788217200,
        firstPaymentAt: 1788220800,
        billingCycleAnchor: 1788220800,
        initialChargePence: 0,
        entitlementProjectionStatus: null,
      }],
      cancellationPreview: null,
    });

    render(<MembershipSuccess />);

    expect(await screen.findByText(/existing Zero Alpha App access is available now/i))
      .toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Go to Zero Alpha App"}))
      .toHaveAttribute("href", "/dashboard");
  });
});
