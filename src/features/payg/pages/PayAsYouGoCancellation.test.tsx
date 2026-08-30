import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  getPaygCancellationPreview,
  requestPaygCancellation,
} from "../services/payg";
import PayAsYouGoCancellation from "./PayAsYouGoCancellation";

jest.mock("../services/payg", () => ({
  getPaygCancellationPreview: jest.fn(),
  requestPaygCancellation: jest.fn(),
  paygErrorMessage: (error: Error) => error.message,
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...props }: React.PropsWithChildren<{ to: string }>) => (
      <a href={to} {...props}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams({ token: "signed-token" })],
  }),
  { virtual: true }
);

const mockedPreview = getPaygCancellationPreview as jest.MockedFunction<
  typeof getPaygCancellationPreview
>;
const mockedCancellation = requestPaygCancellation as jest.MockedFunction<
  typeof requestPaygCancellation
>;

const preview = {
  ok: true as const,
  currentOrderState: "confirmed" as const,
  class: {
    classId: "class_tuesday",
    title: "Adult Conditioning",
    startTime: "2026-09-08T17:00:00.000Z",
    endTime: "2026-09-08T18:00:00.000Z",
    timezone: "Europe/London",
    location: "Zero Alpha Fitness",
  },
  cancellationCutoffAt: "2026-09-07T17:00:00.000Z",
  refundEligibleNow: true,
};

describe("PAYG cancellation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPreview.mockResolvedValue(preview);
    mockedCancellation.mockResolvedValue({
      ok: true,
      outcome: "refund_pending",
      refundEligible: true,
      capacityReleased: true,
    });
  });

  it("shows the server-verified class and refund position before cancellation", async () => {
    render(<PayAsYouGoCancellation />);

    expect(await screen.findByText("Refund available now")).toBeInTheDocument();
    expect(screen.getByText("Adult Conditioning")).toBeInTheDocument();
    expect(screen.getByText(/Cancel by Monday 7 September/)).toBeInTheDocument();
    expect(mockedCancellation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(await screen.findByText(/eligible refund is being processed/i)).toBeInTheDocument();
    expect(mockedCancellation).toHaveBeenCalledWith("signed-token");
  });

  it("does not offer a second cancellation for a terminal booking", async () => {
    mockedPreview.mockResolvedValue({
      ...preview,
      currentOrderState: "refunded",
      refundEligibleNow: false,
    });

    render(<PayAsYouGoCancellation />);

    expect(await screen.findByText(/payment has been refunded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm cancellation" })).not.toBeInTheDocument();
  });
});
