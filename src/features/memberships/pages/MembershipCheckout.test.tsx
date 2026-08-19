import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipCheckout from "./MembershipCheckout";

const mockCreateCheckout = jest.fn();
const mockResolveCheckoutAttempt = jest.fn();
let mockPlanKey = "adult_unlimited";
let mockLocalJourneyEnabled = false;

jest.mock("../localTestJourney", () => ({
  get LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED() {
    return mockLocalJourneyEnabled;
  },
}));

jest.mock("../services/membership", () => ({
  clearCheckoutAttempt: jest.fn(),
  resolveCheckoutAttempt: (...args: unknown[]) => mockResolveCheckoutAttempt(...args),
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
  mockResolveCheckoutAttempt.mockReset();
  mockResolveCheckoutAttempt.mockResolvedValue({
    id: "attempt_test",
    fingerprint: "fingerprint_test",
  });
  mockSignedIn = true;
  mockAuthLoading = false;
  mockLocalJourneyEnabled = false;
});

describe("MembershipCheckout", () => {
  it("keeps checkout closed while the legal documents are drafts", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Checkout closed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subscribe and pay/i })).toBeDisabled();
  });

  it("does not start a Stripe session while the flow is closed", async () => {
    renderCheckout("adult_unlimited");

    await userEvent.type(screen.getByLabelText(/^Your full name$/i), "Payer One");
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

    const payingAdult = screen.getByText("Paying adult");
    const childDetails = screen.getByText("Child details");

    expect(payingAdult).toBeInTheDocument();
    expect(childDetails).toBeInTheDocument();
    expect(payingAdult.compareDocumentPosition(childDetails) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText(/^Paying adult’s full name$/i)).toHaveAttribute(
      "autocomplete",
      "name"
    );
    expect(screen.getByLabelText(/Child’s full name/i)).toHaveAttribute(
      "autocomplete",
      "off"
    );
    expect(screen.getByLabelText(/Child’s date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Relationship to child/i)).toBeInTheDocument();
    expect(
      screen.getByText(/this child’s parent or legal guardian, or an adult/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Type the paying adult’s full name to sign/i))
      .toBeInTheDocument();
  });

  it("never offers the guardian section on an adult plan", () => {
    renderCheckout("adult_unlimited");

    expect(screen.queryByText("Paying adult")).not.toBeInTheDocument();
    expect(screen.getByText(/Adult memberships can only be purchased for yourself/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(/I am the participant/i)).not.toBeInTheDocument();
  });

  it("warns when the date of birth falls outside the plan's age band", async () => {
    renderCheckout("youth_teenstars");

    // Age 8 against the Teenstars 12-16 band.
    const eightYearsAgo = new Date();
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);
    const iso = eightYearsAgo.toISOString().slice(0, 10);

    await userEvent.type(screen.getByLabelText(/Child’s date of birth/i), iso);

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

    await userEvent.type(screen.getByLabelText(/Child’s date of birth/i), iso);

    expect(screen.queryByText(/is for ages 12 to 16/i)).not.toBeInTheDocument();
    expect(screen.getByText("Child age 14")).toBeInTheDocument();
  });

  it("lets a signed-out visitor reach the purchase form without signing in", () => {
    mockSignedIn = false;
    renderCheckout("adult_unlimited");

    // Membership comes before sign-up: the form itself must be reachable.
    expect(screen.getByLabelText(/^Your full name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your date of birth/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subscribe and pay/i })).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to continue/i)).not.toBeInTheDocument();
  });

  it("tells a signed-out visitor they can claim the purchase afterwards", () => {
    mockSignedIn = false;
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Complete your registration and payment first/i))
      .toBeInTheDocument();
    expect(screen.getByText(/create a new AlphaWOD account or log in to an existing one/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /sign in first/i})).not.toBeInTheDocument();
  });

  it("explains that an existing account still uses the same payment journey", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/You’re signed in as Payer One/i)).toBeInTheDocument();
    expect(screen.getByText(/same registration and Stripe payment journey/i))
      .toBeInTheDocument();
  });

  it("keeps non-AlphaWOD plans account-free and promises a simple confirmation", () => {
    mockSignedIn = false;
    renderCheckout("adult_gym");

    expect(screen.getByText(/You do not need an AlphaWOD account/i)).toBeInTheDocument();
    expect(screen.getByText(/return to a simple confirmation page/i)).toBeInTheDocument();
    expect(screen.queryByText(/create a new AlphaWOD account/i)).not.toBeInTheDocument();
  });

  it("submits the paying adult and child as distinct youth records", async () => {
    mockLocalJourneyEnabled = true;
    mockSignedIn = false;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("youth_teenstars");

    const fourteenYearsAgo = new Date();
    fourteenYearsAgo.setFullYear(fourteenYearsAgo.getFullYear() - 14);
    const dateOfBirth = fourteenYearsAgo.toISOString().slice(0, 10);

    await userEvent.type(
      screen.getByLabelText(/^Paying adult’s full name$/i),
      "Ava Parent"
    );
    await userEvent.type(screen.getByLabelText(/Relationship to child/i), "Parent");
    await userEvent.click(
      screen.getByLabelText(/I confirm I am this child’s parent or legal guardian/i)
    );
    await userEvent.type(screen.getByLabelText(/Child’s full name/i), "Alex Child");
    await userEvent.type(screen.getByLabelText(/Child’s date of birth/i), dateOfBirth);
    await userEvent.click(screen.getByLabelText(/I have read and accept/i));
    await userEvent.click(screen.getByLabelText(/I expressly request/i));
    await userEvent.type(
      screen.getByLabelText(/Type the paying adult’s full name to sign/i),
      "Ava Parent"
    );
    await userEvent.click(screen.getByRole("button", {name: /Subscribe and pay/i}));

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      planKey: "youth_teenstars",
      participantFullName: "Alex Child",
      participantDateOfBirth: dateOfBirth,
      participantIsPayer: false,
      guardianFullName: "Ava Parent",
      guardianRelationship: "Parent",
      guardianConfirmsAuthority: true,
      signedName: "Ava Parent",
    }));
  });

  it("redirects an unknown plan back to the catalogue", () => {
    renderCheckout("commercial");
    expect(screen.getByText("redirected:/memberships")).toBeInTheDocument();
  });
});
