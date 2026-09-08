import React from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {
  clearPendingPaygCheckout,
  getPaygCheckoutStatus,
  readPendingPaygCheckout,
} from "../services/payg";
import PayAsYouGoSuccess from "./PayAsYouGoSuccess";

jest.mock("../services/payg", () => ({
  clearPendingPaygCheckout: jest.fn(),
  getPaygCheckoutStatus: jest.fn(),
  paygErrorMessage: (error: Error) => error.message,
  readPendingPaygCheckout: jest.fn(),
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
const mockedClearPendingCheckout = clearPendingPaygCheckout as jest.MockedFunction<
  typeof clearPendingPaygCheckout
>;
const mockedReadPendingCheckout = readPendingPaygCheckout as jest.MockedFunction<
  typeof readPendingPaygCheckout
>;

const matchingPendingCheckout = {
  checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
  sessionUrl: "https://checkout.stripe.test/c/pay/cs_test_payg_confirmation",
  sessionId: "cs_test_payg_confirmation",
  holdExpiresAt: "2099-09-01T10:00:00.000Z",
  class: {
    classId: "class-1",
    title: "Conditioning",
    startTime: "2099-09-07T17:00:00.000Z",
    endTime: "2099-09-07T18:00:00.000Z",
    timezone: "Europe/London",
    location: "Zero Alpha Fitness",
  },
};

describe("PAYG checkout confirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedStatus.mockResolvedValue({ok: true, state: "processing"});
    mockedReadPendingCheckout.mockReturnValue(matchingPendingCheckout);
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
    expect(mockedClearPendingCheckout).toHaveBeenCalledTimes(1);
  });

  it("lets the customer retry a transient status error without creating another checkout", async () => {
    mockedStatus
      .mockRejectedValueOnce(new Error("We could not check that payment yet."))
      .mockResolvedValueOnce({ok: true, state: "processing"});

    render(<PayAsYouGoSuccess />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("We could not check that payment yet.");
    expect(screen.getByRole("button", {name: "Try checking again"})).toBeInTheDocument();
    expect(mockedClearPendingCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Try checking again"}));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Stripe is confirming the payment/i)).toBeInTheDocument();
    expect(mockedClearPendingCheckout).not.toHaveBeenCalled();
  });

  it("does not clear a newer pending checkout when viewing an older terminal receipt", async () => {
    mockedStatus.mockResolvedValue({
      ok: true,
      state: "disputed",
      review: {
        reference: "older_terminal_receipt",
        supportRequired: true,
      },
    });
    mockedReadPendingCheckout.mockReturnValue({
      ...matchingPendingCheckout,
      sessionId: "cs_test_newer_pending_checkout",
      sessionUrl: "https://checkout.stripe.test/c/pay/cs_test_newer_pending_checkout",
    });

    render(<PayAsYouGoSuccess />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("older_terminal_receipt")).toBeInTheDocument();
    expect(mockedReadPendingCheckout).toHaveBeenCalledTimes(1);
    expect(mockedClearPendingCheckout).not.toHaveBeenCalled();
  });
});
