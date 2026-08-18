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
let mockAuthUser = { uid: "buyer-1", emailVerified: false };
let mockSearch = "";

jest.mock("firebase/auth", () => ({
  sendEmailVerification: (...args: unknown[]) => mockSendEmailVerification(...args),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({user: mockAuthUser}),
}));

jest.mock("../services/membership", () => ({
  MEMBERSHIP_STATE_LABEL: {
    incomplete: "Awaiting payment",
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

describe("MembershipManage pending-claim recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { uid: "buyer-1", emailVerified: false };
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
    expect(screen.getByText(/payment is still being confirmed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try linking my paid membership/i }));
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

  it("routes a cooling-off request to staffed review instead of renewal cancellation", async () => {
    mockGetMyMemberships.mockResolvedValue({
      ok: true,
      memberships: [{...activeMembership, coolingOffActive: true}],
      cancellationPreview,
    });

    render(<MembershipManage />);

    expect(await screen.findByText("Cooling-off cancellation needs staff"))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();
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

  it("shows an unfinished cancellation as pending and lets the member retry it", async () => {
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

    expect(await screen.findByText("Cancellation still processing")).toBeInTheDocument();
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
    expect(screen.queryByText("Cancellation confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Membership ends")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Request cancellation"}))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Retry cancellation"}));
    await waitFor(() => expect(mockRequestMembershipCancellation).toHaveBeenCalledWith(
      "sub_active",
      cancellationPreview.cancelAtUnixSeconds
    ));
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
});
