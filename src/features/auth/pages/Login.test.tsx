import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { sendEmailVerification, signInWithEmailAndPassword } from "firebase/auth";
import { readPendingClaim } from "../../memberships/services/membership";
import Login from "./Login";

const mockNavigate = jest.fn();
let mockSearch = "";
let mockLocationState: unknown = null;

jest.mock("firebase/auth", () => ({
  sendEmailVerification: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
}));
jest.mock("../../../firebaseApp", () => ({ auth: {} }));
jest.mock("../../memberships/services/membership", () => ({
  readPendingClaim: jest.fn(),
}));
jest.mock("../components/AuthShell", () => ({ children }: { children: React.ReactNode }) => (
  <div>{children}</div>
));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to}: {children: React.ReactNode; to: string}) => <a href={to}>{children}</a>,
    useNavigate: () => mockNavigate,
    useLocation: () => ({state: mockLocationState}),
    useSearchParams: () => [new URLSearchParams(mockSearch)],
  }),
  { virtual: true }
);

const mockedSignIn = signInWithEmailAndPassword as jest.MockedFunction<
  typeof signInWithEmailAndPassword
>;
const mockedReadPendingClaim = readPendingClaim as jest.MockedFunction<typeof readPendingClaim>;
const mockedSendVerification = sendEmailVerification as jest.MockedFunction<
  typeof sendEmailVerification
>;

describe("Login membership recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = "";
    mockLocationState = null;
    mockedSignIn.mockResolvedValue({user: {emailVerified: true}} as Awaited<
      ReturnType<typeof signInWithEmailAndPassword>
    >);
    mockedSendVerification.mockResolvedValue(undefined);
    mockedReadPendingClaim.mockReturnValue(null);
  });

  async function submitLogin() {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));
  }

  it("routes a returning buyer to the membership page when checkout is pending", async () => {
    mockedReadPendingClaim.mockReturnValue("cs_pending");
    render(<Login />);

    await submitLogin();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/account/membership", { replace: true })
    );
  });

  it("preserves the normal post-login route without a pending checkout", async () => {
    render(<Login />);

    await submitLogin();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/schedule", { replace: true })
    );
  });

  it("sends verification and opens membership recovery from the confirmation email", async () => {
    mockSearch = "membership=1";
    mockedSignIn.mockResolvedValue({user: {emailVerified: false}} as Awaited<
      ReturnType<typeof signInWithEmailAndPassword>
    >);
    render(<Login />);

    await submitLogin();

    await waitFor(() => expect(mockedSendVerification).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith("/account/membership", {replace: true});
  });

  it("returns to verified-email recovery after the protected route requested sign-in", async () => {
    mockLocationState = {
      from: {
        pathname: "/account/membership",
        search: "?claim=email",
        hash: "",
      },
    };
    render(<Login />);

    await submitLogin();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      "/account/membership?claim=email",
      {replace: true}
    ));
  });
});
