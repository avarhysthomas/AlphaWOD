import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {
  createPaygCheckoutAttemptId,
  createPaygCheckoutSession,
  getPublicPaygSchedule,
} from "../services/payg";
import PayAsYouGo from "./PayAsYouGo";

jest.mock("../services/payg", () => ({
  createPaygCheckoutAttemptId: jest.fn(() => "12345678-1234-4123-8123-123456789abc"),
  createPaygCheckoutSession: jest.fn(),
  getPublicPaygSchedule: jest.fn(),
  paygErrorMessage: (error: Error) => error.message,
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({children, to, ...props}: React.PropsWithChildren<{to: string}>) => (
      <a href={to} {...props}>{children}</a>
    ),
  }),
  {virtual: true}
);

const mockedSchedule = getPublicPaygSchedule as jest.MockedFunction<typeof getPublicPaygSchedule>;
const mockedCheckout = createPaygCheckoutSession as jest.MockedFunction<typeof createPaygCheckoutSession>;

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
    (createPaygCheckoutAttemptId as jest.Mock).mockReturnValue(
      "12345678-1234-4123-8123-123456789abc"
    );
    mockedSchedule.mockResolvedValue(openSchedule);
    mockedCheckout.mockRejectedValue(new Error("stop before redirect"));
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
    fireEvent.change(screen.getByLabelText(/Mobile number/i), {target: {value: "+447700900000"}});
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
});
