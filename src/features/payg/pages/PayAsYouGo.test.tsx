import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {
  clearPendingPaygCheckout,
  createPaygCheckoutAttemptId,
  createPaygCheckoutSession,
  getPublicPaygSchedule,
  readPendingPaygCheckout,
} from "../services/payg";
import PayAsYouGo from "./PayAsYouGo";

let mockSearchParams = "";

jest.mock("../services/payg", () => ({
  clearPendingPaygCheckout: jest.fn(),
  createPaygCheckoutAttemptId: jest.fn(() => "12345678-1234-4123-8123-123456789abc"),
  createPaygCheckoutSession: jest.fn(),
  getPublicPaygSchedule: jest.fn(),
  paygErrorMessage: (error: Error) => error.message,
  readPendingPaygCheckout: jest.fn(() => null),
  rememberPendingPaygCheckout: jest.fn(),
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to, ...props}: React.PropsWithChildren<{to: string}>) => (
      <a href={to} {...props}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams(mockSearchParams)],
  }),
  {virtual: true}
);

const mockedSchedule = getPublicPaygSchedule as jest.MockedFunction<typeof getPublicPaygSchedule>;
const mockedCheckout = createPaygCheckoutSession as jest.MockedFunction<typeof createPaygCheckoutSession>;
const mockedPendingCheckout = readPendingPaygCheckout as jest.MockedFunction<
  typeof readPendingPaygCheckout
>;
const mockedClearPendingCheckout = clearPendingPaygCheckout as jest.MockedFunction<
  typeof clearPendingPaygCheckout
>;

const openSchedule = {
  ok: true as const,
  available: true,
  checkoutAvailable: true,
  offering: {
    key: "adult_payg_class" as const,
    displayName: "Adult Pay as You Go Class" as const,
    amountPence: 750 as const,
    currency: "gbp" as const,
    cancellationCutoffHours: 24 as const,
  },
  legal: {
    waiver: {version: "PAYG-WAIVER-1", publicUrl: "/legal/payg/waiver.txt"},
    terms: {version: "PAYG-TERMS-1", publicUrl: "/legal/payg/terms.txt"},
  },
  classes: [
    {
      classId: "class_available",
      title: "Conditioning",
      startTime: "2026-09-07T05:00:00.000Z",
      endTime: "2026-09-07T06:00:00.000Z",
      timezone: "Europe/London",
      coachName: "Coach Ava",
      location: "Unit 3",
      spacesRemaining: 4,
      availability: "available" as const,
    },
    {
      classId: "class_unavailable",
      title: "Youth session",
      startTime: "2026-09-07T17:00:00.000Z",
      endTime: "2026-09-07T18:00:00.000Z",
      timezone: "Europe/London",
      coachName: null,
      location: "Unit 3",
      spacesRemaining: 0,
      availability: "unavailable" as const,
    },
  ],
};

describe("Pay As You Go timetable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = "";
    mockedPendingCheckout.mockReturnValue(null);
    window.history.replaceState({}, "", "/pay-as-you-go");
    (createPaygCheckoutAttemptId as jest.Mock).mockReturnValue(
      "12345678-1234-4123-8123-123456789abc"
    );
    mockedSchedule.mockResolvedValue(openSchedule);
    mockedCheckout.mockRejectedValue(new Error("stop before redirect"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts with the live session rows, locks unavailable rows and binds one class to checkout", async () => {
    render(<PayAsYouGo />);

    expect(await screen.findByRole("heading", {name: "Choose your class"})).toBeInTheDocument();
    const available = await screen.findByRole("button", {name: /Conditioning/i});
    const unavailable = screen.getByRole("button", {name: /Youth session/i});
    expect(available).toHaveAccessibleName(/4 spaces left/i);
    expect(unavailable).toHaveAccessibleName(/Not available for PAYG/i);
    expect(unavailable).toBeDisabled();

    fireEvent.click(available);
    expect(available).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Payment is for this named class, not a reusable credit/i))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Continue"}))
      .toHaveAttribute("aria-controls", "payg-details");
    expect(screen.getByText(/Mon,? 7 Sept · 06:00/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Full name"), {target: {value: "Guest Athlete"}});
    fireEvent.change(screen.getByLabelText("Date of birth"), {target: {value: "1990-01-01"}});
    fireEvent.change(screen.getByLabelText("Email"), {target: {value: "guest@example.com"}});
    const optionalPhone = screen.getByLabelText(/Mobile number/i);
    expect(optionalPhone).not.toBeRequired();
    fireEvent.change(optionalPhone, {target: {value: "+447700900000"}});
    fireEvent.click(screen.getByLabelText(/aged 18 or over/i));
    fireEvent.click(screen.getByLabelText(/adult participant waiver/i));
    fireEvent.click(screen.getByLabelText(/Pay As You Go terms/i));
    fireEvent.click(screen.getByLabelText(/cannot be transferred or rescheduled/i));
    fireEvent.click(screen.getByRole("button", {name: "Reserve and pay £7.50"}));

    await waitFor(() => expect(mockedCheckout).toHaveBeenCalledWith({
      checkoutSchemaVersion: 1,
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      classId: "class_available",
      attendee: {fullName: "Guest Athlete", dateOfBirth: "1990-01-01"},
      contact: {email: "guest@example.com", phone: "+447700900000"},
      acceptances: {
        adultConfirmed: true,
        waiverAccepted: true,
        termsAccepted: true,
        cancellationPolicyAccepted: true,
        waiverVersion: "PAYG-WAIVER-1",
        termsVersion: "PAYG-TERMS-1",
      },
    }));
  });

  it("does not collect a phone number when the guest leaves the optional field blank", async () => {
    render(<PayAsYouGo />);

    fireEvent.click(await screen.findByRole("button", {name: /Conditioning/i}));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: {value: "Guest Athlete"},
    });
    fireEvent.change(screen.getByLabelText("Date of birth"), {
      target: {value: "1990-01-01"},
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: {value: "guest@example.com"},
    });
    expect(screen.getByLabelText(/Mobile number/i)).toHaveValue("");
    fireEvent.click(screen.getByLabelText(/aged 18 or over/i));
    fireEvent.click(screen.getByLabelText(/adult participant waiver/i));
    fireEvent.click(screen.getByLabelText(/Pay As You Go terms/i));
    fireEvent.click(screen.getByLabelText(/cannot be transferred or rescheduled/i));
    fireEvent.click(screen.getByRole("button", {name: "Reserve and pay £7.50"}));

    await waitFor(() => expect(mockedCheckout).toHaveBeenCalled());
    expect(mockedCheckout.mock.calls[0][0].contact).toEqual({
      email: "guest@example.com",
    });
  });

  it("shows one Monday-to-Sunday week at a time and keeps empty weeks navigable", async () => {
    mockedSchedule.mockResolvedValueOnce({
      ...openSchedule,
      classes: [
        ...openSchedule.classes,
        {
          classId: "class_later",
          title: "Engine",
          startTime: "2026-09-21T17:00:00.000Z",
          endTime: "2026-09-21T18:00:00.000Z",
          timezone: "Europe/London",
          coachName: "Coach Jaimie",
          location: "Main Floor",
          spacesRemaining: 8,
          availability: "available" as const,
        },
      ],
    });
    render(<PayAsYouGo />);

    expect(await screen.findByRole("heading", {name: "7–13 Sept 2026"}))
      .toBeInTheDocument();
    const firstWeekSession = screen.getByRole("button", {name: /Conditioning/i});
    expect(screen.queryByRole("button", {name: /Engine/i})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "No previous timetable week"}))
      .toBeDisabled();

    fireEvent.click(firstWeekSession);
    expect(screen.getByRole("button", {name: "Continue"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: /Show next week/i}));

    expect(screen.getByRole("heading", {name: "14–20 Sept 2026"}))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "No sessions this week"}))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Continue"})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: /Show next week/i}));
    expect(screen.getByRole("heading", {name: "21–27 Sept 2026"}))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Engine/i})).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Conditioning/i})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "No next timetable week"}))
      .toBeDisabled();
  });

  it("keeps checkout closed when the backend withholds legal release metadata", async () => {
    mockedSchedule.mockResolvedValueOnce({
      ...openSchedule,
      checkoutAvailable: false,
      legal: null,
    });
    render(<PayAsYouGo />);

    expect(await screen.findByText("Checkout not open yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Reserve and pay/i})).not.toBeInTheDocument();
  });

  it("recovers the same held checkout after the guest returns from Stripe", async () => {
    mockSearchParams = "checkout=cancelled";
    window.history.replaceState({}, "", "/pay-as-you-go?checkout=cancelled");
    mockedPendingCheckout.mockReturnValue({
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      sessionUrl: "https://checkout.stripe.test/c/pay/cs_test_pending_123",
      sessionId: "cs_test_pending_123",
      holdExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      class: {
        classId: "class_available",
        title: "Conditioning",
        startTime: "2026-09-07T05:00:00.000Z",
        endTime: "2026-09-07T06:00:00.000Z",
        timezone: "Europe/London",
        location: "Unit 3",
      },
    });

    render(<PayAsYouGo />);

    expect(await screen.findByText("Payment was not completed")).toBeInTheDocument();
    expect(await screen.findByRole("button", {name: /Return to secure payment/i}))
      .toBeInTheDocument();
    await waitFor(() => expect(
      screen.getByRole("button", {name: /Conditioning, Held for you/i})
    ).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("button", {name: /Reserve and pay/i}))
      .not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("expires a live hold in place, clears recovery state and unlocks the timetable", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T09:00:00.000Z"));
    mockedSchedule.mockResolvedValueOnce({
      ...openSchedule,
      classes: [
        ...openSchedule.classes,
        {
          classId: "class_later",
          title: "Engine",
          startTime: "2026-09-21T17:00:00.000Z",
          endTime: "2026-09-21T18:00:00.000Z",
          timezone: "Europe/London",
          coachName: "Coach Jaimie",
          location: "Main Floor",
          spacesRemaining: 8,
          availability: "available" as const,
        },
      ],
    });
    mockedPendingCheckout.mockReturnValue({
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      sessionUrl: "https://checkout.stripe.test/c/pay/cs_test_pending_123",
      sessionId: "cs_test_pending_123",
      holdExpiresAt: "2026-09-01T09:00:01.000Z",
      class: {
        classId: "class_available",
        title: "Conditioning",
        startTime: "2026-09-07T05:00:00.000Z",
        endTime: "2026-09-07T06:00:00.000Z",
        timezone: "Europe/London",
        location: "Unit 3",
      },
    });

    render(<PayAsYouGo />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", {name: /Conditioning, Held for you/i}))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", {
      name: "Finish the held checkout before changing week",
    })).toHaveLength(2);
    expect(screen.getByRole("button", {name: /Return to secure payment/i}))
      .toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockedClearPendingCheckout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", {name: /Return to secure payment/i}))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: /Conditioning, 4 spaces left/i}))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", {name: /Show next week/i})).toBeEnabled();
  });

  it("offers an in-place retry after a transient timetable failure", async () => {
    mockedSchedule
      .mockRejectedValueOnce(new Error("Temporary network failure"))
      .mockResolvedValueOnce(openSchedule);

    render(<PayAsYouGo />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Try loading the timetable again",
    }));

    expect(await screen.findByRole("button", {name: /Conditioning/i}))
      .toBeInTheDocument();
    expect(mockedSchedule).toHaveBeenCalledTimes(2);
  });
});
