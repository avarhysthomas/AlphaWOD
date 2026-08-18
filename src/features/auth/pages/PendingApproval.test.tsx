import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PendingApproval from "./PendingApproval";
import { bootstrapUserProfile } from "../services/account";

const refreshAppUser = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
jest.mock("../services/account", () => ({
  bootstrapUserProfile: jest.fn(),
}));
jest.mock("../../../components/ui/LogoutButton", () => () => <button>Log out</button>);

const mockedBootstrap = bootstrapUserProfile as jest.MockedFunction<typeof bootstrapUserProfile>;

describe("PendingApproval recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshAppUser.mockResolvedValue(undefined);
    mockedBootstrap.mockResolvedValue({ ok: true });
  });

  it("lets an authenticated account retry a missing server profile", async () => {
    mockUseAuth.mockReturnValue({
      user: { displayName: "Member A" },
      appUser: { profileExists: false, email: "member@example.com" },
      refreshAppUser,
    });
    render(<PendingApproval />);

    fireEvent.click(screen.getByRole("button", { name: "Finish account setup" }));

    await waitFor(() => expect(mockedBootstrap).toHaveBeenCalledWith("Member A"));
    expect(refreshAppUser).toHaveBeenCalledTimes(1);
  });

  it("does not bootstrap when the server profile is merely unavailable", async () => {
    mockUseAuth.mockReturnValue({
      user: { displayName: "Member A" },
      appUser: { profileExists: undefined, email: "member@example.com" },
      refreshAppUser,
    });
    render(<PendingApproval />);

    fireEvent.click(screen.getByRole("button", { name: "Retry verification" }));

    await waitFor(() => expect(refreshAppUser).toHaveBeenCalledTimes(1));
    expect(mockedBootstrap).not.toHaveBeenCalled();
  });
});
