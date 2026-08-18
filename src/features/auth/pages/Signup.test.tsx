import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import { readPendingClaim } from "../../memberships/services/membership";
import { bootstrapUserProfile } from "../services/account";
import Signup from "./Signup";

const mockNavigate = jest.fn();
let mockSearch = "";

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: jest.fn(),
  sendEmailVerification: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock("../../../firebase", () => ({ auth: {} }));
jest.mock("../../memberships/services/membership", () => ({
  readPendingClaim: jest.fn(),
}));
jest.mock("../services/account", () => ({
  bootstrapUserProfile: jest.fn(),
}));
jest.mock(
  "../components/AuthShell",
  () => ({
    children,
    description,
  }: {
    children: React.ReactNode;
    description: string;
  }) => (
    <div>
      <p>{description}</p>
      {children}
    </div>
  )
);
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(mockSearch)],
  }),
  { virtual: true }
);

const mockedCreateUser = createUserWithEmailAndPassword as jest.MockedFunction<
  typeof createUserWithEmailAndPassword
>;
const mockedUpdateProfile = updateProfile as jest.MockedFunction<typeof updateProfile>;
const mockedReadPendingClaim = readPendingClaim as jest.MockedFunction<typeof readPendingClaim>;
const mockedBootstrap = bootstrapUserProfile as jest.MockedFunction<typeof bootstrapUserProfile>;
const mockedSendVerification = sendEmailVerification as jest.MockedFunction<
  typeof sendEmailVerification
>;

describe("Signup membership recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = "";
    mockedCreateUser.mockResolvedValue({ user: {emailVerified: false} } as Awaited<
      ReturnType<typeof createUserWithEmailAndPassword>
    >);
    mockedSendVerification.mockResolvedValue(undefined);
    mockedUpdateProfile.mockResolvedValue(undefined);
    mockedBootstrap.mockResolvedValue({ ok: true });
    mockedReadPendingClaim.mockReturnValue(null);
  });

  async function submitSignup() {
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Buyer One" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
  }

  it("routes a new buyer to the membership page when checkout is pending", async () => {
    mockedReadPendingClaim.mockReturnValue("cs_pending");
    render(<Signup />);

    expect(screen.getByText(/securely link the membership you just purchased/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting screen until an admin approves/i)).not.toBeInTheDocument();

    await submitSignup();

    await waitFor(() => expect(mockedBootstrap).toHaveBeenCalledWith("Buyer One"));
    expect(mockNavigate).toHaveBeenCalledWith("/account/membership");
  });

  it("preserves the approval route for an ordinary sign-up", async () => {
    render(<Signup />);

    expect(screen.getByText(/waiting screen until an admin approves/i)).toBeInTheDocument();

    await submitSignup();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/pending-approval"));
  });

  it("starts verified-email recovery when opened from the confirmation email", async () => {
    mockSearch = "membership=1";
    render(<Signup />);

    await submitSignup();

    await waitFor(() => expect(mockedSendVerification).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith("/account/membership");
  });
});
