import React from "react";
import {render, screen} from "@testing-library/react";
import Memberships from "./Memberships";

let mockSearchParams = "";

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({user: null}),
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to}: {children: React.ReactNode; to: string}) => (
      <a href={to}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams(mockSearchParams)],
  }),
  {virtual: true}
);

describe("Memberships presale presentation", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-19T09:00:00.000Z"));
    mockSearchParams = "";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows £0 today, the launch date, and the Adult Unlimited code offer", () => {
    render(<Memberships />);

    expect(screen.getByText("£0 charged")).toBeInTheDocument();
    expect(screen.getAllByText("1 September 2026")).toHaveLength(2);
    expect(screen.getByText("AlphaWOD after first payment")).toBeInTheDocument();
    expect(screen.getByText(/personal code during signup for £5 off/i)).toBeInTheDocument();
    expect(screen.getAllByText(/£0 today · first payment 1 September 2026/i))
      .toHaveLength(4);
  });

  it("returns to the standard proration journey after presale closes", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-01T00:00:00.000Z"));
    render(<Memberships />);

    expect(screen.queryByText("£0 charged")).not.toBeInTheDocument();
    expect(screen.queryByText("AlphaWOD after first payment")).not.toBeInTheDocument();
    expect(screen.getByText("Includes AlphaWOD access")).toBeInTheDocument();
    expect(screen.queryByText(/personal code during signup for £5 off/i))
      .not.toBeInTheDocument();
    expect(screen.getAllByText(/After opening, all memberships bill on the first/i).length)
      .toBeGreaterThan(0);
  });

  it("says a cancelled Stripe checkout saved no payment method", () => {
    mockSearchParams = "checkout=cancelled";
    render(<Memberships />);

    expect(screen.getByText(/no payment method was saved/i)).toBeInTheDocument();
  });
});
