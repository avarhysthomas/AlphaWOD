import React from "react";
import {render, screen} from "@testing-library/react";
import Memberships from "./Memberships";

let mockSearchParams = "";
let mockDocumentsApproved = false;
let mockFrontendPurchaseEnabled = false;
let mockLocalJourneyEnabled = true;

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({user: null}),
}));

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
    };
  },
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to, ...props}: {
      children: React.ReactNode;
      to: string;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to} {...props}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams(mockSearchParams)],
  }),
  {virtual: true}
);

describe("Memberships presale presentation", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-19T09:00:00.000Z"));
    mockSearchParams = "";
    mockDocumentsApproved = false;
    mockFrontendPurchaseEnabled = false;
    mockLocalJourneyEnabled = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows £0 today and the launch date without the removed Adult Unlimited offer copy", () => {
    render(<Memberships />);

    const logoLink = screen.getByRole("link", {name: "Zero Alpha home"});
    expect(logoLink).toHaveAttribute("href", "/");
    expect(screen.getByText("Ages 6 to 11")).toBeInTheDocument();
    expect(screen.getByText("£30")).toBeInTheDocument();
    expect(screen.getByText(/Register 2 or more children.*automatic 15% discount/i))
      .toBeInTheDocument();
    expect(screen.getAllByText("/child/mo")).toHaveLength(2);
    expect(screen.getByText("£0 charged")).toBeInTheDocument();
    expect(screen.getAllByText("1 September 2026")).toHaveLength(2);
    expect(screen.queryByText("Zero Alpha App after first payment")).not.toBeInTheDocument();
    expect(screen.queryByText(/discount code during signup for £5 off/i))
      .not.toBeInTheDocument();
    expect(screen.getAllByText(/£0 today · first payment 1 September 2026/i))
      .toHaveLength(4);
  });

  it("keeps the rolling contract disclosure and labels the local test mode", () => {
    render(<Memberships />);

    expect(screen.getByText(/There is no joining fee/i)).toBeInTheDocument();
    expect(screen.queryByText(/Join before opening and nothing is charged today/i))
      .not.toBeInTheDocument();
    expect(screen.getByText(/Local Stripe test mode · no real payments/i))
      .toBeInTheDocument();
  });

  it("keeps an armed production catalogue visibly closed without checkout links", () => {
    mockDocumentsApproved = true;
    mockLocalJourneyEnabled = false;
    render(<Memberships />);

    expect(screen.getByText(/Online membership purchase is currently closed/i))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button", {name: /online purchase closed/i}))
      .toHaveLength(5);
    expect(screen.queryAllByRole("link").filter((link) =>
      link.getAttribute("href")?.startsWith("/memberships/checkout/")
    )).toHaveLength(0);
  });

  it("renders checkout links only when legal and production frontend gates are open", () => {
    mockDocumentsApproved = true;
    mockFrontendPurchaseEnabled = true;
    mockLocalJourneyEnabled = false;
    render(<Memberships />);

    expect(screen.queryByText(/Not open yet/i)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link").filter((link) =>
      link.getAttribute("href")?.startsWith("/memberships/checkout/")
    )).toHaveLength(5);
  });

  it("returns to the standard proration journey after presale closes", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-01T00:00:00.000Z"));
    render(<Memberships />);

    expect(screen.queryByText("£0 charged")).not.toBeInTheDocument();
    expect(screen.queryByText("Zero Alpha App after first payment")).not.toBeInTheDocument();
    expect(screen.getByText("Includes Zero Alpha App access")).toBeInTheDocument();
    expect(screen.queryByText(/discount code during signup for £5 off/i))
      .not.toBeInTheDocument();
    expect(screen.getAllByText(/After opening, all memberships bill on the first/i).length)
      .toBeGreaterThan(0);
  });

  it("explains that Stripe Back preserves checkout without navigating history", () => {
    mockSearchParams = "checkout=cancelled";
    render(<Memberships />);

    const panel = screen.getByRole("status", {name: "Checkout may still be open"});
    expect(panel).toHaveTextContent(/does not cancel or expire the checkout/i);
    expect(panel).toHaveTextContent(/original Stripe tab.*browser’s Back control/i);
    expect(panel).toHaveTextContent(/help confirming its status/i);
    expect(panel).not.toHaveTextContent(/No membership has been created/i);
    expect(screen.queryByText(/Checkout was cancelled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a membership below to try again/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Return to Stripe/i}))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Contact support"}))
      .toHaveAttribute("href", "mailto:support@zeroalphafitness.co.uk");
  });
});
