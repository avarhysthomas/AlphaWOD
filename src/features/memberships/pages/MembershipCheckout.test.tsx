import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipCheckout from "./MembershipCheckout";

const mockCreateCheckout = jest.fn();
const mockResolveCheckoutAttempt = jest.fn();
const mockClearCheckoutAttempt = jest.fn();
let mockPlanKey = "adult_unlimited";
let mockLocalJourneyEnabled = false;

jest.mock("../localTestJourney", () => ({
  get LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED() {
    return mockLocalJourneyEnabled;
  },
}));

jest.mock("../services/membership", () => ({
  clearCheckoutAttempt: (...args: unknown[]) => mockClearCheckoutAttempt(...args),
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
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-19T09:00:00.000Z"));
  mockCreateCheckout.mockReset();
  mockResolveCheckoutAttempt.mockReset();
  mockClearCheckoutAttempt.mockReset();
  mockResolveCheckoutAttempt.mockResolvedValue({
    id: "attempt_test",
    fingerprint: "fingerprint_test",
  });
  mockSignedIn = true;
  mockAuthLoading = false;
  mockLocalJourneyEnabled = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function getCheckoutButton() {
  return screen.getByRole("button", {
    name: /Continue to Stripe|Subscribe and pay/i,
  });
}

async function submitAdultCheckout() {
  await userEvent.type(screen.getByLabelText(/^Your full name$/i), "Payer One");
  await userEvent.type(screen.getByLabelText(/Your date of birth/i), "1990-01-01");
  await userEvent.click(screen.getByLabelText(/I have read and accept/i));
  await userEvent.click(screen.getByLabelText(/I expressly request/i));
  await userEvent.type(
    screen.getByLabelText(/Type your full name to sign/i),
    "Payer One"
  );
  await userEvent.click(getCheckoutButton());
}

describe("MembershipCheckout", () => {
  it("keeps checkout closed while the legal documents are drafts", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Checkout closed/i)).toBeInTheDocument();
    expect(getCheckoutButton()).toBeDisabled();
  });

  it("does not start a Stripe session while the flow is closed", async () => {
    renderCheckout("adult_unlimited");

    await userEvent.type(screen.getByLabelText(/^Your full name$/i), "Payer One");
    await userEvent.click(getCheckoutButton());

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
    expect(getCheckoutButton()).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to continue/i)).not.toBeInTheDocument();
  });

  it("tells a signed-out visitor they can claim the purchase afterwards", () => {
    mockSignedIn = false;
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Complete registration and Stripe checkout first/i))
      .toBeInTheDocument();
    expect(screen.getByText(/create a new AlphaWOD account or log in to an existing one/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /sign in first/i})).not.toBeInTheDocument();
  });

  it("explains that an existing account still uses the same payment journey", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/You’re signed in as Payer One/i)).toBeInTheDocument();
    expect(screen.getByText(/same registration and Stripe checkout journey/i))
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
    await userEvent.click(getCheckoutButton());

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

  it("makes the presale charge and service date explicit before Stripe", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText("£0 charged")).toBeInTheDocument();
    expect(screen.getAllByText("1 September 2026")).toHaveLength(2);
    expect(getCheckoutButton()).toHaveAccessibleName("Continue to Stripe — £0 today");
    expect(screen.getByText(/£55 in September, October and November/i))
      .toBeInTheDocument();
    expect(screen.getByLabelText(/Discount code/i)).toBeInTheDocument();
    expect(screen.getByText(/verify and apply your code before opening Stripe/i))
      .toBeInTheDocument();
  });

  it("does not advertise the Adult Unlimited promotion code on other plans", () => {
    renderCheckout("adult_gym");

    expect(screen.queryByText("Existing-member offer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Discount code/i)).not.toBeInTheDocument();
  });

  it("returns to standard prorated checkout after the presale boundary", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-02T09:00:00.000Z"));
    renderCheckout("adult_unlimited");

    expect(screen.queryByText("£0 charged")).not.toBeInTheDocument();
    expect(screen.queryByText("Existing-member offer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Discount code/i)).not.toBeInTheDocument();
    expect(getCheckoutButton()).toHaveAccessibleName("Subscribe and pay");
    expect(screen.getAllByText(/After opening, all memberships bill on the first/i).length)
      .toBeGreaterThan(0);
  });

  it("binds a presale checkout to the payment policy shown on the page", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      expectedBillingMode: "presale_deferred",
      planKey: "adult_unlimited",
    }));
  });

  it("submits a trimmed shared code from the Adult Unlimited presale", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("adult_unlimited");

    await userEvent.type(
      screen.getByLabelText(/Discount code/i),
      "  EXISTING5-TEST  "
    );
    await submitAdultCheckout();

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockResolveCheckoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({promotionCode: "EXISTING5-TEST"}),
      null,
      {payerUid: "payer-1"}
    );
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      promotionCode: "EXISTING5-TEST",
    }));
  });

  it("omits an empty shared code from the checkout request", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("adult_unlimited");

    await userEvent.type(screen.getByLabelText(/Discount code/i), "   ");
    await submitAdultCheckout();

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout.mock.calls[0][0]).not.toHaveProperty("promotionCode");
  });

  it("binds a post-launch checkout to the standard payment policy shown", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-02T09:00:00.000Z"));
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      expectedBillingMode: "standard",
      planKey: "adult_unlimited",
    }));
  });

  it("fails closed and asks for a review when the rendered policy is stale", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockRejectedValue({
      code: "functions/failed-precondition",
      details: {
        reason: "billing_policy_changed",
        expectedBillingMode: "presale_deferred",
        currentBillingMode: "standard",
      },
    });
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    expect(await screen.findByRole("alert")).toHaveTextContent("Payment details changed");
    expect(screen.getByRole("button", {name: "Refresh and review"})).toBeInTheDocument();
    expect(getCheckoutButton()).toBeDisabled();
    expect(mockClearCheckoutAttempt).not.toHaveBeenCalled();
  });

  it("shows a no-charge billing setup error and retires the failed attempt", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockRejectedValue(Object.assign(
      new Error(
        "Stripe could not start checkout because the billing setup needs attention. " +
        "No checkout was created or charged. Please contact us."
      ),
      {
        code: "functions/failed-precondition",
        details: {reason: "stripe_checkout_configuration"},
      }
    ));
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No checkout was created or charged"
    );
    expect(mockClearCheckoutAttempt).toHaveBeenCalledTimes(1);
  });
});
