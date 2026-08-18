import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import MembershipSuccess from "./MembershipSuccess";

const mockRememberPendingClaim = jest.fn();
const mockClearPendingClaim = jest.fn();
const mockClearCheckoutAttempt = jest.fn();
const mockReadCheckoutAttemptId = jest.fn();
const mockClaimMembership = jest.fn();
const mockGetMyMemberships = jest.fn();
const mockRefreshAppUser = jest.fn();
let mockUser: { uid: string } | null = { uid: "buyer-1" };
let mockLoading = false;

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: mockLoading,
    refreshAppUser: mockRefreshAppUser,
  }),
}));
jest.mock("../services/membership", () => ({
  claimMembership: (...args: unknown[]) => mockClaimMembership(...args),
  clearCheckoutAttempt: (...args: unknown[]) => mockClearCheckoutAttempt(...args),
  clearPendingClaim: (...args: unknown[]) => mockClearPendingClaim(...args),
  getMyMemberships: (...args: unknown[]) => mockGetMyMemberships(...args),
  readCheckoutAttemptId: () => mockReadCheckoutAttemptId(),
  rememberPendingClaim: (...args: unknown[]) => mockRememberPendingClaim(...args),
}));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams("session_id=cs_signed_in")],
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
    mockUser = { uid: "buyer-1" };
    mockLoading = false;
    mockReadCheckoutAttemptId.mockReturnValue("12345678-1234-4123-8123-123456789abc");
    mockClaimMembership.mockResolvedValue({ok: true, claimed: ["sub_1"]});
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [activeMembership],
      cancellationPreview: null,
    });
    mockRefreshAppUser.mockResolvedValue(undefined);
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
    expect(screen.queryByText("Go to AlphaWOD")).not.toBeInTheDocument();
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
});
