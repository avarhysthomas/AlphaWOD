import React from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {getPaygCheckoutStatus} from "../services/payg";
import PayAsYouGoSuccess from "./PayAsYouGoSuccess";

jest.mock("../services/payg", () => ({
  getPaygCheckoutStatus: jest.fn(),
  paygErrorMessage: (error: Error) => error.message,
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to, ...props}: React.PropsWithChildren<{to: string}>) => (
      <a href={to} {...props}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams({session_id: "cs_test_payg_confirmation"})],
  }),
  {virtual: true}
);

const mockedStatus = getPaygCheckoutStatus as jest.MockedFunction<
  typeof getPaygCheckoutStatus
>;

describe("PAYG checkout confirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedStatus.mockResolvedValue({ok: true, state: "processing"});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stops indefinite polling with an explicit recovery action", async () => {
    render(<PayAsYouGoSuccess />);
    await act(async () => Promise.resolve());

    for (let attempt = 1; attempt < 7; attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      });
    }

    expect(mockedStatus).toHaveBeenCalledTimes(7);
    expect(screen.getByRole("heading", {name: "Still confirming"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Check again"})).toBeInTheDocument();
    expect(screen.getAllByRole("link", {name: "Contact support"}).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Stripe is confirming the payment/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Check again"}));
    await act(async () => Promise.resolve());
    expect(mockedStatus).toHaveBeenCalledTimes(8);
    expect(screen.getByText(/Stripe is confirming the payment/i)).toBeInTheDocument();
  });

  it("renders a safe support receipt when payment review has no class order", async () => {
    mockedStatus.mockResolvedValue({
      ok: true,
      state: "disputed",
      review: {
        reference: "payg_review_reference",
        supportRequired: true,
      },
    });

    render(<PayAsYouGoSuccess />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", {name: "Booking needs attention"})).toBeInTheDocument();
    expect(screen.getByText(/No class booking can be managed/i)).toBeInTheDocument();
    expect(screen.getByText("payg_review_reference")).toBeInTheDocument();
    expect(screen.queryByRole("link", {name: "Cancel this class"})).not.toBeInTheDocument();
  });
});
