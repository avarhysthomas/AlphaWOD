import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAuth } from "../../../context/AuthContext";
import { acceptCurrentWaiver } from "../services/account";
import WaiverGate from "./WaiverGate";

jest.mock("../../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../services/account", () => ({
  acceptCurrentWaiver: jest.fn(),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedAcceptCurrentWaiver = acceptCurrentWaiver as jest.MockedFunction<
  typeof acceptCurrentWaiver
>;

const baseUser = {
  uid: "member-a",
  email: "member@example.com",
  displayName: "Member A",
} as any;

function mockAuth(overrides: Record<string, unknown> = {}) {
  const refreshAppUser = jest.fn().mockResolvedValue(undefined);
  mockedUseAuth.mockReturnValue({
    user: baseUser,
    appUser: {
      uid: baseUser.uid,
      email: baseUser.email,
      name: "Member A",
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
      strengthBlock: "none",
      ...overrides,
    },
    loading: false,
    refreshAppUser,
  });
  return refreshAppUser;
}

describe("WaiverGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("does not trust a localStorage acceptance flag", () => {
    mockAuth();
    window.localStorage.setItem(
      "zaf-waiver-accepted:member-a:2026-30-05",
      "true"
    );

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByText("Required waiver")).toBeInTheDocument();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
  });

  it("does not render protected children while an authenticated profile is unresolved", () => {
    mockedUseAuth.mockReturnValue({
      user: baseUser,
      appUser: null,
      loading: false,
      refreshAppUser: jest.fn().mockResolvedValue(undefined),
    });

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
  });

  it("requires a complete persisted acceptance for the current version", () => {
    mockAuth({
      waiverAcceptedVersion: "2026-30-05",
      waiverAcceptedAt: { seconds: 1 },
    });

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByText("Protected app")).toBeInTheDocument();
  });

  it("does not block billing controls behind the participation waiver", () => {
    mockAuth();

    render(
      <WaiverGate bypass>
        <div>Membership billing</div>
      </WaiverGate>
    );

    expect(screen.getByText("Membership billing")).toBeInTheDocument();
    expect(screen.queryByText("Required waiver")).not.toBeInTheDocument();
  });

  it("records acceptance through the callable before opening the app", async () => {
    const refreshAppUser = mockAuth();
    mockedAcceptCurrentWaiver.mockResolvedValue({ ok: true });

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    fireEvent.change(screen.getByLabelText("Type your full name to sign"), {
      target: { value: "Member A" },
    });
    screen
      .getAllByRole("checkbox")
      .slice(0, 6)
      .forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole("button", { name: "I agree" }));

    await waitFor(() => {
      expect(mockedAcceptCurrentWaiver).toHaveBeenCalledWith({
        acceptedName: "Member A",
        waiverVersion: "2026-30-05",
        acknowledgements: expect.arrayContaining([
          expect.stringContaining("read and understood"),
        ]),
        mediaConsent: false,
      });
    });
    expect(refreshAppUser).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Protected app")).toBeInTheDocument();
  });
});
