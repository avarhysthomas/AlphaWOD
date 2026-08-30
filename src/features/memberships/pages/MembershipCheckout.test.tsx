import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipCheckout from "./MembershipCheckout";

const mockCreateCheckout = jest.fn();
const mockResolveCheckoutAttempt = jest.fn();
const mockClearCheckoutAttempt = jest.fn();
let mockPlanKey = "adult_unlimited";
let mockDocumentsApproved = false;
let mockFrontendPurchaseEnabled = false;
let mockLocalJourneyEnabled = false;
let mockConditioningCheckoutEnabled = false;

jest.mock("../purchaseAvailability", () => ({
  get MEMBERSHIP_PURCHASE_AVAILABILITY() {
    const publicPurchaseEnabled =
      mockDocumentsApproved && mockFrontendPurchaseEnabled;
    return {
      documentsApproved: mockDocumentsApproved,
      frontendPurchaseEnabled: mockFrontendPurchaseEnabled,
      localTestJourneyEnabled: mockLocalJourneyEnabled,
      publicPurchaseEnabled,
      checkoutEnabled: publicPurchaseEnabled || mockLocalJourneyEnabled,
      conditioningCheckoutEnabled: mockConditioningCheckoutEnabled &&
        (publicPurchaseEnabled || mockLocalJourneyEnabled),
    };
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
  mockDocumentsApproved = false;
  mockFrontendPurchaseEnabled = false;
  mockLocalJourneyEnabled = false;
  mockConditioningCheckoutEnabled = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function getCheckoutButton() {
  return screen.getByRole("button", {
    name: /Continue to Stripe|Subscribe and pay|Online purchase closed/i,
  });
}

async function submitAdultCheckout() {
  await userEvent.type(screen.getByLabelText(/^Your full name$/i), "Payer One");
  await userEvent.type(screen.getByLabelText(/Your date of birth/i), "1990-01-01");
  await acceptAllCheckoutStatements();
  await userEvent.type(
    screen.getByLabelText(/Type your full name to sign/i),
    "Payer One"
  );
  await userEvent.click(getCheckoutButton());
}

async function acceptAllCheckoutStatements() {
  for (const checkbox of screen.getAllByRole("checkbox")) {
    if (!(checkbox as HTMLInputElement).checked) {
      await userEvent.click(checkbox);
    }
  }
}

function structuredCheckoutFailure(
  reason: "checkout_in_progress" | "checkout_processing" | "membership_exists"
) {
  return Object.assign(new Error(`RAW ${reason} server message`), {
    code: "functions/failed-precondition",
    details: {reason},
  });
}

describe("MembershipCheckout", () => {
  it("presents Conditioning as a flexible weekly allowance without a slot selector", () => {
    renderCheckout("adult_conditioning");

    expect(screen.getByRole("heading", {name: "Book any two each week"}))
      .toBeInTheDocument();
    expect(screen.getByText(/up to two eligible Conditioning classes.*Monday–Sunday/i))
      .toBeInTheDocument();
    expect(screen.getByText(/choices are not fixed/i)).toBeInTheDocument();
    const timetable = screen.getByRole("list", {
      name: "Eligible Conditioning timetable",
    });
    expect(timetable).toHaveTextContent("Monday");
    expect(timetable).toHaveTextContent("06:00");
    expect(timetable).toHaveTextContent("Tuesday");
    expect(timetable).toHaveTextContent("Thursday");
    expect(timetable).toHaveTextContent("18:00");
    expect(timetable).toHaveTextContent("Friday");
    expect(timetable).toHaveTextContent("05:30");
    expect(screen.queryByText(/of 2 selected/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Monday.*06:00/i}))
      .not.toBeInTheDocument();
  });

  it("submits Conditioning checkout without fixed slot purchase data", async () => {
    mockLocalJourneyEnabled = true;
    mockConditioningCheckoutEnabled = true;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("adult_conditioning");

    await submitAdultCheckout();

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      planKey: "adult_conditioning",
      checkoutSchemaVersion: 6,
    }));
    expect(mockCreateCheckout.mock.calls[0][0])
      .not.toHaveProperty("selectedConditioningSlots");
    expect(mockResolveCheckoutAttempt.mock.calls[0][0])
      .not.toHaveProperty("selectedConditioningSlots");
  });

  it("keeps checkout closed when the legal publication source gate is disabled", () => {
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

  it("keeps an armed production checkout closed after legal publication", () => {
    mockDocumentsApproved = true;
    renderCheckout("adult_unlimited");

    expect(screen.getByText(/Online membership purchase is currently closed/i))
      .toBeInTheDocument();
    expect(getCheckoutButton()).toHaveAccessibleName("Online purchase closed");
    expect(getCheckoutButton()).toBeDisabled();
    expect(screen.getByText(/No payment can be started from this page/i))
      .toBeInTheDocument();
  });

  it("opens production presentation only when both public gates are open", () => {
    mockDocumentsApproved = true;
    mockFrontendPurchaseEnabled = true;
    renderCheckout("adult_unlimited");

    expect(screen.queryByText(/Checkout closed/i)).not.toBeInTheDocument();
    expect(getCheckoutButton()).toHaveAccessibleName("Continue to Stripe — £0 today");
  });

  it("waits for Auth to resolve before fixing the checkout identity", () => {
    mockLocalJourneyEnabled = true;
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
    expect(screen.getByLabelText(/Child 1 full name/i)).toHaveAttribute(
      "autocomplete",
      "off"
    );
    expect(screen.getByLabelText(/Child 1 date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Relationship to child/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/named child.*parent or legal guardian or otherwise/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Type the paying adult’s full name to sign/i))
      .toBeInTheDocument();
  });

  it("never offers the guardian section on an adult plan", () => {
    renderCheckout("adult_unlimited");

    expect(screen.queryByText("Paying adult")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Add another child/i}))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", {name: /Monthly price/i}))
      .not.toBeInTheDocument();
    expect(screen.getByText(/Adult memberships can only be purchased for yourself/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(/I am the participant/i)).not.toBeInTheDocument();
  });

  it("shows only the immutable documents and separate statements for the signer role", () => {
    renderCheckout("adult_unlimited");

    expect(screen.getByText("Adult Participant Waiver and Risk Acknowledgement"))
      .toBeInTheDocument();
    expect(screen.queryByText("Parent/Guardian Consent and Youth Membership Addendum"))
      .not.toBeInTheDocument();
    expect(screen.getAllByRole("link", {name: /versioned plain-text copy/i}))
      .toHaveLength(4);
    expect(screen.getByLabelText(/I have read and agree to the Membership Terms/i))
      .not.toBeChecked();
    expect(screen.getByLabelText(/I acknowledge that I have received and read the Privacy Notice/i))
      .not.toBeChecked();
    expect(screen.getByLabelText(/I confirm that I am the named participant/i))
      .not.toBeChecked();
    expect(screen.getByLabelText(/I authorise the amount Stripe shows today/i))
      .not.toBeChecked();
    expect(screen.getByLabelText(/I expressly request/i)).not.toBeChecked();
  });

  it("uses the guardian addendum instead of an adult waiver for youth checkout", () => {
    renderCheckout("youth_youngstars");

    const planHeading = screen.getByRole("heading", {
      level: 1,
      name: "MINI ALPHAS - 10 & Under",
    });
    expect(planHeading).not.toHaveClass("uppercase");
    expect(screen.getByText("Parent/Guardian Consent and Youth Membership Addendum"))
      .toBeInTheDocument();
    expect(screen.queryByText("Adult Participant Waiver and Risk Acknowledgement"))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText(/I confirm that I am aged 18 or over.*named child/i))
      .not.toBeChecked();
    expect(screen.getByLabelText(/I have read and agree to the Parent\/Guardian Consent/i))
      .not.toBeChecked();
  });

  it("accepts a six-year-old on TEEN ALPHAS - 11 & UP without an age-band gate", async () => {
    renderCheckout("youth_teenstars");

    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    const dateOfBirth = sixYearsAgo.toISOString().slice(0, 10);
    const dateInput = screen.getByLabelText(/Child 1 date of birth/i);

    await userEvent.type(dateInput, dateOfBirth);

    expect(dateInput).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Child 1 age 6")).toBeInTheDocument();
    expect(screen.queryByText(/eligible for TEEN ALPHAS - 11 & UP|TEEN ALPHAS - 11 & UP is for ages/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /Switch to/i})).not.toBeInTheDocument();
  });

  it("continues to reject a future youth date of birth", async () => {
    renderCheckout("youth_teenstars");

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateInput = screen.getByLabelText(/Child 1 date of birth/i);

    await userEvent.type(dateInput, tomorrow.toISOString().slice(0, 10));

    expect(dateInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Enter a valid date of birth that is not in the future/i))
      .toBeInTheDocument();
  });

  it.each([
    ["youth_youngstars", "£60.00", "£9.00", "£51.00"],
    ["youth_teenstars", "£70.00", "£10.50", "£59.50"],
  ])(
    "applies the automatic family discount to two children on %s",
    async (planKey, standardTotal, saving, discountedTotal) => {
      renderCheckout(planKey);

      expect(screen.getByRole("region", {name: "Monthly price for 1 child"}))
        .toHaveTextContent(/Add a second child.*15% off/i);
      await userEvent.click(screen.getByRole("button", {name: "Add another child"}));

      const summary = screen.getByRole("region", {
        name: "Monthly price for 2 children",
      });
      expect(within(summary).getByText(standardTotal)).toBeInTheDocument();
      expect(within(summary).getByText(`−${saving}`)).toBeInTheDocument();
      expect(within(summary).getByText(discountedTotal)).toBeInTheDocument();
      expect(summary).toHaveTextContent(/automatic 15% family discount.*full monthly subtotal/i);
      expect(screen.getByLabelText(/Relationship to children/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/each named child.*each of them/i)).toBeInTheDocument();
    }
  );

  it("accepts a Mini-recommended additional child on TEEN ALPHAS - 11 & UP", async () => {
    mockLocalJourneyEnabled = true;
    renderCheckout("youth_teenstars");

    const fourteenYearsAgo = new Date();
    fourteenYearsAgo.setFullYear(fourteenYearsAgo.getFullYear() - 14);
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);

    await userEvent.type(
      screen.getByLabelText(/Child 1 date of birth/i),
      fourteenYearsAgo.toISOString().slice(0, 10)
    );
    await userEvent.click(screen.getByRole("button", {name: "Add another child"}));
    const childTwoDate = screen.getByLabelText(/Child 2 date of birth/i);
    await userEvent.type(childTwoDate, sixYearsAgo.toISOString().slice(0, 10));

    expect(childTwoDate).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Child 2 age 6")).toBeInTheDocument();
    expect(screen.queryByText(/eligible for TEEN ALPHAS - 11 & UP|TEEN ALPHAS - 11 & UP is for ages/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /Switch to/i})).not.toBeInTheDocument();
  });

  it("caps one youth checkout at ten children", async () => {
    renderCheckout("youth_youngstars");

    for (let childNumber = 2; childNumber <= 10; childNumber += 1) {
      await userEvent.click(screen.getByRole("button", {name: "Add another child"}));
    }

    expect(screen.getByText("10 of 10 children")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Maximum children added"}))
      .toBeDisabled();
    expect(screen.getAllByRole("group", {name: /Child \d+ details/i})).toHaveLength(10);
  });

  it("requires fresh acceptance when the number of children changes", async () => {
    renderCheckout("youth_youngstars");

    await acceptAllCheckoutStatements();
    expect(screen.getAllByRole("checkbox").every((checkbox) =>
      (checkbox as HTMLInputElement).checked
    )).toBe(true);

    await userEvent.click(screen.getByRole("button", {name: "Add another child"}));

    expect(screen.getAllByRole("checkbox").every((checkbox) =>
      !(checkbox as HTMLInputElement).checked
    )).toBe(true);
    expect(screen.getByLabelText(/future recurring monthly payments for 2 MINI ALPHAS - 10 & Under participants/i))
      .not.toBeChecked();
  });

  it("requires fresh acceptance when a named child's details change", async () => {
    renderCheckout("youth_youngstars");

    await userEvent.type(screen.getByLabelText(/Child 1 full name/i), "Alex Child");
    await acceptAllCheckoutStatements();
    expect(screen.getAllByRole("checkbox").every((checkbox) =>
      (checkbox as HTMLInputElement).checked
    )).toBe(true);

    await userEvent.type(screen.getByLabelText(/Child 1 full name/i), " Junior");

    expect(screen.getAllByRole("checkbox").every((checkbox) =>
      !(checkbox as HTMLInputElement).checked
    )).toBe(true);
  });

  it("requires fresh acceptance when the selected youth programme changes", async () => {
    const view = renderCheckout("youth_youngstars");

    await acceptAllCheckoutStatements();
    expect(screen.getAllByRole("checkbox").every((checkbox) =>
      (checkbox as HTMLInputElement).checked
    )).toBe(true);
    expect(screen.getByLabelText(/standard monthly price is £30\.00/i)).toBeChecked();

    mockPlanKey = "youth_teenstars";
    view.rerender(<MembershipCheckout />);

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").every((checkbox) =>
        !(checkbox as HTMLInputElement).checked
      )).toBe(true);
    });
    expect(screen.getByLabelText(/standard monthly price is £35\.00/i)).not.toBeChecked();
    expect(mockClearCheckoutAttempt).toHaveBeenCalledWith();
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
    expect(screen.getByText(/create a new Zero Alpha App account or log in to an existing one/i))
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

    expect(screen.getByText(/You do not need a Zero Alpha App account/i)).toBeInTheDocument();
    expect(screen.getByText(/return to a simple confirmation page/i)).toBeInTheDocument();
    expect(screen.queryByText(/create a new Zero Alpha App account/i)).not.toBeInTheDocument();
  });

  it("submits the paying adult and child as distinct youth records", async () => {
    mockLocalJourneyEnabled = true;
    mockSignedIn = false;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("youth_teenstars");

    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    const dateOfBirth = sixYearsAgo.toISOString().slice(0, 10);

    await userEvent.type(
      screen.getByLabelText(/^Paying adult’s full name$/i),
      "Ava Parent"
    );
    await userEvent.type(screen.getByLabelText(/Relationship to child/i), "Parent");
    await userEvent.click(
      screen.getByLabelText(/I confirm that I am aged 18 or over.*named child/i)
    );
    await userEvent.type(screen.getByLabelText(/Child 1 full name/i), "Alex Child");
    await userEvent.type(screen.getByLabelText(/Child 1 date of birth/i), dateOfBirth);
    await acceptAllCheckoutStatements();
    await userEvent.type(
      screen.getByLabelText(/Type the paying adult’s full name to sign/i),
      "Ava Parent"
    );
    await userEvent.click(getCheckoutButton());

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      planKey: "youth_teenstars",
      checkoutSchemaVersion: 6,
      participantFullName: "Alex Child",
      participantDateOfBirth: dateOfBirth,
      participantIsPayer: false,
      guardianFullName: "Ava Parent",
      guardianRelationship: "Parent",
      signedName: "Ava Parent",
      acceptedStatementIds: [
        "membership_contract",
        "privacy_notice",
        "guardian_authority",
        "guardian_youth_addendum",
        "recurring_payment_authority",
        "immediate_performance",
      ],
    }));
    expect(mockCreateCheckout.mock.calls[0][0]).not.toHaveProperty(
      "additionalParticipants"
    );
  });

  it("submits an additional six-year-old on TEEN ALPHAS - 11 & UP", async () => {
    mockLocalJourneyEnabled = true;
    mockSignedIn = false;
    mockCreateCheckout.mockResolvedValue({sessionUrl: ""});
    renderCheckout("youth_teenstars");

    const fourteenYearsAgo = new Date();
    fourteenYearsAgo.setFullYear(fourteenYearsAgo.getFullYear() - 14);
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    const firstDateOfBirth = fourteenYearsAgo.toISOString().slice(0, 10);
    const secondDateOfBirth = sixYearsAgo.toISOString().slice(0, 10);

    await userEvent.click(screen.getByRole("button", {name: "Add another child"}));
    await userEvent.type(
      screen.getByLabelText(/^Paying adult’s full name$/i),
      "Ava Parent"
    );
    await userEvent.type(screen.getByLabelText(/Relationship to children/i), "Parent");
    await userEvent.type(screen.getByLabelText(/Child 1 full name/i), "Alex Child");
    await userEvent.type(screen.getByLabelText(/Child 1 date of birth/i), firstDateOfBirth);
    await userEvent.type(screen.getByLabelText(/Child 2 full name/i), "Sam Child");
    await userEvent.type(screen.getByLabelText(/Child 2 date of birth/i), secondDateOfBirth);
    await acceptAllCheckoutStatements();
    await userEvent.type(
      screen.getByLabelText(/Type the paying adult’s full name to sign/i),
      "Ava Parent"
    );
    await userEvent.click(getCheckoutButton());

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    expect(mockResolveCheckoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSchemaVersion: 6,
        planKey: "youth_teenstars",
        participantFullName: "Alex Child",
        participantDateOfBirth: firstDateOfBirth,
        additionalParticipants: [{
          fullName: "Sam Child",
          dateOfBirth: secondDateOfBirth,
        }],
      }),
      null,
      {payerUid: null}
    );
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      checkoutSchemaVersion: 6,
      checkoutAttemptId: "attempt_test",
      participantFullName: "Alex Child",
      additionalParticipants: [{
        fullName: "Sam Child",
        dateOfBirth: secondDateOfBirth,
      }],
    }));
  });

  it("redirects an unknown plan back to the catalogue", () => {
    renderCheckout("commercial");
    expect(screen.getByText("redirected:/memberships")).toBeInTheDocument();
  });

  it("shows the simplified Discount Code field during the Adult Unlimited presale", () => {
    mockLocalJourneyEnabled = true;
    renderCheckout("adult_unlimited");

    expect(screen.getByText("£0 charged")).toBeInTheDocument();
    expect(screen.getAllByText("1 September 2026")).toHaveLength(2);
    expect(getCheckoutButton()).toHaveAccessibleName("Continue to Stripe — £0 today");
    expect(screen.getByLabelText("Discount Code")).toBeInTheDocument();
    expect(screen.queryByText("Existing-member offer")).not.toBeInTheDocument();
    expect(screen.queryByText(/£55 in September, October and November/i))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/verify and apply your code before opening Stripe/i))
      .not.toBeInTheDocument();
  });

  it("does not advertise the Adult Unlimited promotion code on other plans", () => {
    renderCheckout("adult_gym");

    expect(screen.queryByText("Existing-member offer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Discount code/i)).not.toBeInTheDocument();
  });

  it("explains the banking-app handoff before checkout", () => {
    renderCheckout("adult_gym");

    expect(screen.getByText(/Your bank may open its app to approve/i))
      .toHaveTextContent(/Keep this browser tab open/i);
    expect(screen.getByText(/Your bank may open its app to approve/i))
      .toHaveTextContent(/Don’t restart checkout on another phone/i);
  });

  it("returns to standard prorated checkout after the presale boundary", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-02T09:00:00.000Z"));
    mockLocalJourneyEnabled = true;
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

  it("shows a privacy-safe checkout conflict without retiring its verifier", async () => {
    const reload = jest.spyOn(window.history, "go").mockImplementation(() => undefined);
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockRejectedValue(
      structuredCheckoutFailure("checkout_in_progress")
    );
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    const panel = await screen.findByRole("alert", {name: "Checkout unavailable"});
    expect(panel).toHaveFocus();
    expect(panel).toHaveTextContent(/checkout or membership setup already exists/i);
    expect(panel).toHaveTextContent(/approval in your banking app/i);
    expect(panel).toHaveTextContent(/Do not start it again on another phone/i);
    expect(panel).toHaveTextContent(/original browser tab and your email/i);
    expect(panel).not.toHaveTextContent(/No membership has been created/i);
    expect(screen.queryByText(/RAW checkout_in_progress server message/i))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Contact support"}))
      .toHaveAttribute("href", "mailto:support@zeroalphafitness.co.uk");
    await userEvent.click(screen.getByRole("button", {name: "Check again"}));
    expect(reload).toHaveBeenCalledWith(0);
    const blockedSubmit = screen.getByRole("button", {
      name: "Checkout unavailable",
    });
    expect(blockedSubmit).toBeDisabled();
    await userEvent.click(blockedSubmit);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockClearCheckoutAttempt).not.toHaveBeenCalled();
  });

  it("shows checkout processing as a non-retryable membership-status route", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockRejectedValue(
      structuredCheckoutFailure("checkout_processing")
    );
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    const panel = await screen.findByRole("status", {name: "Checkout submitted"});
    expect(panel).toHaveFocus();
    expect(panel).toHaveTextContent(/Do not start another checkout/i);
    expect(screen.queryByText(/RAW checkout_processing server message/i))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Check membership status"}))
      .toHaveAttribute("href", "/account/membership");
    expect(screen.getByRole("button", {name: "Checkout confirmation pending"}))
      .toBeDisabled();
    expect(mockClearCheckoutAttempt).not.toHaveBeenCalled();
  });

  it("routes a signed-in customer with an existing membership to management", async () => {
    mockLocalJourneyEnabled = true;
    mockCreateCheckout.mockRejectedValue(
      structuredCheckoutFailure("membership_exists")
    );
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    const panel = await screen.findByRole("alert", {name: "Membership already set up"});
    expect(panel).toHaveTextContent(/active or scheduled membership/i);
    expect(screen.queryByText(/RAW membership_exists server message/i))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Manage membership"}))
      .toHaveAttribute("href", "/account/membership");
    expect(screen.getByRole("link", {name: "Contact support"}))
      .toHaveAttribute("href", "mailto:support@zeroalphafitness.co.uk");
    expect(screen.getByRole("button", {name: "Membership already set up"}))
      .toBeDisabled();
  });

  it("offers support rather than account management to a signed-out existing member", async () => {
    mockLocalJourneyEnabled = true;
    mockSignedIn = false;
    mockCreateCheckout.mockRejectedValue(
      structuredCheckoutFailure("membership_exists")
    );
    renderCheckout("adult_unlimited");

    await submitAdultCheckout();

    await screen.findByRole("alert", {name: "Membership already set up"});
    expect(screen.queryByRole("link", {name: "Manage membership"}))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Contact support"}))
      .toHaveAttribute("href", "mailto:support@zeroalphafitness.co.uk");
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
