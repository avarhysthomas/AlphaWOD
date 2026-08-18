import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipCheckout from "./MembershipCheckout";

const mockCreateCheckout = jest.fn();
let mockPlanKey = "adult_unlimited";

jest.mock("../services/membership", () => ({
  clearCheckoutAttempt: jest.fn(),
  resolveCheckoutAttempt: jest.fn(async () => ({
    id: "attempt_test",
    fingerprint: "fingerprint_test",
  })),
  createMembershipCheckoutSession: (...args: unknown[]) => mockCreateCheckout(...args),
}));

let mockSignedIn = true;
let mockAuthLoading = false;

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () =>
    mockSignedIn
      ? {
          user: { uid: "payer-1", displayName: "Payer One", email: "payer@example.com" },
          appUser: { uid: "payer-1", name: "Payer One" },
          loading: mockAuthLoading,
          refreshAppUser: jest.fn(),
        }
      : {
          user: null,
          appUser: null,
          loading: mockAuthLoading,
          refreshAppUser: jest.fn(),
        },
}));

// react-router-dom v7 is ESM-only and CRA's jest can't resolve it. The page
// only uses Link, Navigate and useParams.
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...rest }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to, ...rest }, children),
    Navigate: ({ to }: { to: string }) =>
      require("react").createElement("div", null, `redirected:${to}`),
    useParams: () => ({ planKey: mockPlanKey }),
  }),
  { virtual: true }
);

function renderCheckout(planKey: string) {
  mockPlanKey = planKey;
  return render(<MembershipCheckout />);
}

beforeEach(() => {
  mockCreateCheckout.mockReset();
  mockSignedIn = true;
  mockAuthLoading = false;
});

describe("MembershipCheckout", () => {
  it("keeps checkout closed while the legal documents are drafts", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Checkout closed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subscribe and pay/i })).toBeDisabled();
  });

  it("does not start a Stripe session while the flow is closed", async () => {
    renderCheckout("adult_unlimited");

    await userEvent.type(screen.getByLabelText(/Participant full name/i), "Payer One");
    await userEvent.click(screen.getByRole("button", { name: /Subscribe and pay/i }));

    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("waits for Auth to resolve before fixing the checkout identity", () => {
    mockAuthLoading = true;
    renderCheckout("adult_unlimited");

    expect(screen.getByRole("button", { name: /Checking account/i })).toBeDisabled();
  });

  it("asks a youth purchase for guardian details and authority", () => {
    renderCheckout("youth_teenstars");

    expect(screen.getByText("Parent or guardian")).toBeInTheDocument();
    expect(screen.getByLabelText(/Relationship to participant/i)).toBeInTheDocument();
    expect(
      screen.getByText(/parent or legal guardian, or an adult with lawful authority/i)
    ).toBeInTheDocument();
  });

  it("never offers the guardian section on an adult plan", () => {
    renderCheckout("adult_unlimited");

    expect(screen.queryByText("Parent or guardian")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/I am the participant/i)).toBeInTheDocument();
  });

  it("warns when the date of birth falls outside the plan's age band", async () => {
    renderCheckout("youth_teenstars");

    // Age 8 against the Teenstars 12-16 band.
    const eightYearsAgo = new Date();
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);
    const iso = eightYearsAgo.toISOString().slice(0, 10);

    await userEvent.type(screen.getByLabelText(/Participant date of birth/i), iso);

    expect(screen.getByText(/is for ages 12 to 16/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Switch to HYROX Youngstars/i })
    ).toHaveAttribute("href", "/memberships/checkout/youth_youngstars");
  });

  it("accepts a date of birth inside the plan's age band", async () => {
    renderCheckout("youth_teenstars");

    const fourteenYearsAgo = new Date();
    fourteenYearsAgo.setFullYear(fourteenYearsAgo.getFullYear() - 14);
    const iso = fourteenYearsAgo.toISOString().slice(0, 10);

    await userEvent.type(screen.getByLabelText(/Participant date of birth/i), iso);

    expect(screen.queryByText(/is for ages 12 to 16/i)).not.toBeInTheDocument();
    expect(screen.getByText("Age 14")).toBeInTheDocument();
  });

  it("lets a signed-out visitor reach the purchase form without signing in", () => {
    mockSignedIn = false;
    renderCheckout("adult_unlimited");

    // Membership comes before sign-up: the form itself must be reachable.
    expect(screen.getByLabelText(/Participant full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Participant date of birth/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subscribe and pay/i })).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to continue/i)).not.toBeInTheDocument();
  });

  it("tells a signed-out visitor they can claim the purchase afterwards", () => {
    mockSignedIn = false;
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/You do not need an account to join/i)).toBeInTheDocument();
  });

  it("redirects an unknown plan back to the catalogue", () => {
    renderCheckout("commercial");
    expect(screen.getByText("redirected:/memberships")).toBeInTheDocument();
  });
});
