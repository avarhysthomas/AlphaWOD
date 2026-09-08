import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAuth } from "../../../context/AuthContext";
import {
  CHECKOUT_DOCUMENTS,
  resolveCheckoutAcceptanceStatements,
} from "../../../lib/membershipPlans";
import { acceptCurrentWaiver } from "../services/account";
import WaiverGate, {shouldBypassWaiverForLocalTestUser} from "./WaiverGate";

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
const adultWaiver = CHECKOUT_DOCUMENTS.adultWaiver;
const adultWaiverAcceptance = resolveCheckoutAcceptanceStatements(
  "adult_unlimited"
).find(({id}) => id === "adult_participant_waiver")!;

const baseUser = {
  uid: "member-a",
  email: "member@example.com",
  displayName: "Member A",
} as any;

function mockAuth(
  overrides: Record<string, unknown> = {},
  userOverrides: Record<string, unknown> = {}
) {
  const activeUser = {...baseUser, ...userOverrides};
  const refreshAppUser = jest.fn().mockResolvedValue(undefined);
  mockedUseAuth.mockReturnValue({
    user: activeUser,
    appUser: {
      uid: activeUser.uid,
      email: activeUser.email,
      name: activeUser.displayName,
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

function completeWaiverForm() {
  fireEvent.change(screen.getByLabelText("Type your full name to sign"), {
    target: { value: "Member A" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", {name: "I agree"}));
}

describe("WaiverGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("limits the synthetic-user bypass to the development emulator", () => {
    expect(shouldBypassWaiverForLocalTestUser({
      nodeEnv: "development",
      useEmulators: "true",
      email: " DEV-MEMBER@ZEROALPHA.TEST ",
    })).toBe(true);
    expect(shouldBypassWaiverForLocalTestUser({
      nodeEnv: "production",
      useEmulators: "true",
      email: "dev-member@zeroalpha.test",
    })).toBe(false);
    expect(shouldBypassWaiverForLocalTestUser({
      nodeEnv: "development",
      useEmulators: "false",
      email: "dev-member@zeroalpha.test",
    })).toBe(false);
    expect(shouldBypassWaiverForLocalTestUser({
      nodeEnv: "development",
      useEmulators: "true",
      email: "member@example.com",
    })).toBe(false);
  });

  it("does not trust a localStorage acceptance flag", () => {
    mockAuth();
    window.localStorage.setItem(
      `zaf-waiver-accepted:member-a:${adultWaiver.version}`,
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
      waiverAcceptedVersion: adultWaiver.version,
      waiverAcceptedAt: {seconds: 1},
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

  it("records the canonical acceptance through the callable before opening the app", async () => {
    const refreshAppUser = mockAuth();
    mockedAcceptCurrentWaiver.mockResolvedValue({ok: true});

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByRole("document", {name: adultWaiver.title}).textContent)
      .toBe(adultWaiver.content);
    expect(screen.getByRole("link", {name: "Open the permanent text copy"}))
      .toHaveAttribute("href", adultWaiver.publicUrl);
    expect(screen.queryByText(/media and testimonial usage/i))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("Type your full name to sign"))
      .toHaveAttribute("maxlength", "160");

    completeWaiverForm();

    await waitFor(() => {
      expect(mockedAcceptCurrentWaiver).toHaveBeenCalledWith({
        acceptedName: "Member A",
        waiverVersion: adultWaiver.version,
        acknowledgements: [adultWaiverAcceptance.statement],
        mediaConsent: false,
      });
    });
    expect(refreshAppUser).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Protected app")).toBeInTheDocument();
  });

  it("explains how to recover when the server requires a newer waiver", async () => {
    const refreshAppUser = mockAuth();
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedAcceptCurrentWaiver.mockRejectedValue(
      Object.assign(new Error("The current waiver changed"), {
        code: "functions/failed-precondition",
      })
    );

    render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );
    completeWaiverForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/waiver was updated while the page was open/i);
    expect(alert).toHaveTextContent(/Refresh the page.*sign again/i);
    expect(screen.getByLabelText("Type your full name to sign"))
      .toHaveValue("Member A");
    expect(screen.getByRole("button", {name: "I agree"})).toBeEnabled();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
    expect(refreshAppUser).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("resets draft input, acknowledgements and errors when the active UID changes", async () => {
    mockAuth();
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedAcceptCurrentWaiver.mockRejectedValue(
      Object.assign(new Error("The current waiver changed"), {
        code: "functions/failed-precondition",
      })
    );

    const view = render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );
    completeWaiverForm();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Type your full name to sign")).toHaveValue("Member A");
    expect(screen.getByRole("checkbox")).toBeChecked();

    mockAuth({}, {
      uid: "member-b",
      email: "member-b@example.com",
      displayName: "Member B",
    });
    view.rerender(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByLabelText("Type your full name to sign")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "I agree"})).toBeDisabled();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("ignores an old UID's in-flight acceptance when another user becomes active", async () => {
    let resolveAcceptance!: (value: {ok: true}) => void;
    const acceptance = new Promise<{ok: true}>((resolve) => {
      resolveAcceptance = resolve;
    });
    const refreshA = mockAuth();
    mockedAcceptCurrentWaiver.mockReturnValue(acceptance);

    const view = render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );
    completeWaiverForm();
    await waitFor(() => expect(mockedAcceptCurrentWaiver).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", {name: "Saving agreement..."})).toBeDisabled();

    const refreshB = mockAuth({}, {
      uid: "member-b",
      email: "member-b@example.com",
      displayName: "Member B",
    });
    view.rerender(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByLabelText("Type your full name to sign")).toHaveValue("");
    expect(screen.getByRole("button", {name: "I agree"})).toBeDisabled();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();

    await act(async () => {
      resolveAcceptance({ok: true});
      await acceptance;
    });

    expect(refreshA).not.toHaveBeenCalled();
    expect(refreshB).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Type your full name to sign")).toHaveValue("");
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
  });

  it("does not carry an already-signed session UID into the next account", async () => {
    mockAuth();
    mockedAcceptCurrentWaiver.mockResolvedValue({ok: true});

    const view = render(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );
    completeWaiverForm();
    expect(await screen.findByText("Protected app")).toBeInTheDocument();

    mockAuth({}, {
      uid: "member-b",
      email: "member-b@example.com",
      displayName: "Member B",
    });
    view.rerender(
      <WaiverGate>
        <div>Protected app</div>
      </WaiverGate>
    );

    expect(screen.getByText("Required waiver")).toBeInTheDocument();
    expect(screen.queryByText("Protected app")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type your full name to sign")).toHaveValue("");
  });
});
