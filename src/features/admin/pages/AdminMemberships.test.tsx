import React from "react";
import { render, screen } from "@testing-library/react";
import AdminMemberships from "./AdminMemberships";

const mockListMemberships = jest.fn();
const mockLinkMembershipParticipant = jest.fn();

jest.mock("../../memberships/services/membership", () => ({
  MEMBERSHIP_STATE_LABEL: {
    incomplete: "Awaiting payment",
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
        cancellationRequestError: "Stripe cancellation recovery exhausted.",
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
    expect(screen.getByText("AlphaWOD access needs manual review"))
      .toBeInTheDocument();
    expect(screen.getByText("Participant profile is missing."))
      .toBeInTheDocument();
  });
});
