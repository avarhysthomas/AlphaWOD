import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import Schedule, {
  computeBookingClosesAt,
  scheduleWindowWithSaturdayCutover,
} from "./Schedule";

const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockBookClass = jest.fn();
const mockCancelBooking = jest.fn();
const mockUser = {
  uid: "member-1",
  email: "member@example.com",
  photoURL: null,
};
const mockAppUser = {
  uid: "member-1",
  name: "Conditioning Member",
  email: "member@example.com",
  role: "user",
  approvalStatus: "approved",
  entitlementStatus: "active",
  entitlementSource: "stripe",
  alphaWodAccess: true,
  appAccessTier: "limited",
  entitlementPlanKey: "adult_conditioning",
  entitlementWeeklyBookingLimit: 2,
  entitlementClassSlots: [
    "monday_0600",
    "tuesday_1800",
    "thursday_1800",
    "friday_0530",
  ],
  strengthBlock: "none",
};

jest.mock("../../../firebase", () => ({ db: {} }));

jest.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  query: (ref: { path: string }) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  Timestamp: class MockTimestamp {
    private readonly value: Date;

    constructor(value: Date) {
      this.value = value;
    }

    static fromDate(value: Date) {
      return new this(value);
    }

    toDate() {
      return this.value;
    }
  },
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    appUser: mockAppUser,
  }),
}));

jest.mock("../../../components/layout/UserTopNav", () => ({
  getUserNavItems: () => [],
}));

jest.mock("../services/bookings", () => ({
  bookClass: (...args: unknown[]) => mockBookClass(...args),
  cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...rest }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to, ...rest }, children),
    NavLink: ({ children, to }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to }, children),
    useNavigate: () => jest.fn(),
  }),
  { virtual: true }
);

const classData = {
  title: "Conditioning",
  timezone: "Europe/London",
  startTime: Timestamp.fromDate(new Date("2026-09-08T17:00:00.000Z")),
  endTime: Timestamp.fromDate(new Date("2026-09-08T18:00:00.000Z")),
  coachName: "Coach One",
  location: "Zero Alpha Fitness",
  capacity: 12,
  bookedCount: 0,
  status: "scheduled" as const,
  conditioningSlotKey: "tuesday_1800" as const,
};

function firestoreSnapshot(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: rows.map(({ id, data }) => ({ id, data: () => data })),
  };
}

function classesSnapshot() {
  return firestoreSnapshot([{ id: "class-1", data: classData }]);
}

function bookingsSnapshot(booked: boolean) {
  return firestoreSnapshot(
    booked
      ? [
          {
            id: "booking-1",
            data: {
              classId: "class-1",
              userId: "member-1",
              status: "booked",
              conditioningQuotaWeekKey: "2026-09-07",
              conditioningQuotaWeeklyLimit: 2,
            },
          },
        ]
      : []
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushUpdates() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  });
}

describe("member schedule hardening", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-08T09:00:00.000Z"));
    jest.spyOn(window, "alert").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetDocs.mockReset();
    mockGetDoc.mockReset();
    mockBookClass.mockReset();
    mockCancelBooking.mockReset();
    mockGetDoc.mockResolvedValue({ data: () => ({ strengthBlocksEnabled: true }) });
    mockBookClass.mockResolvedValue({ data: { success: true } });
    mockCancelBooking.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not present an unverified booking state while bookings are loading", async () => {
    const bookings = deferred<ReturnType<typeof firestoreSnapshot>>();
    mockGetDocs.mockImplementation((ref: { path: string }) =>
      ref.path === "classes" ? Promise.resolve(classesSnapshot()) : bookings.promise
    );

    render(<Schedule />);
    await flushUpdates();

    expect(screen.getByText("Checking booking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking booking…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Book session" })).not.toBeInTheDocument();

    await act(async () => {
      bookings.resolve(bookingsSnapshot(true));
      await bookings.promise;
    });
    await flushUpdates();

    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeEnabled();
    expect(screen.getByText(/1 of 2 booked · 1 remaining/i)).toBeInTheDocument();
  });

  it("shows a truthful schedule error and retries instead of claiming there are no sessions", async () => {
    const classFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(classesSnapshot());
    mockGetDocs.mockImplementation((ref: { path: string }) =>
      ref.path === "classes" ? classFetch() : Promise.resolve(bookingsSnapshot(false))
    );

    render(<Schedule />);
    await flushUpdates();

    expect(screen.getByRole("heading", { name: "Schedule unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("No sessions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry schedule" }));
    await flushUpdates();

    expect(screen.getByRole("button", { name: "Book session" })).toBeEnabled();
    expect(classFetch).toHaveBeenCalledTimes(2);
  });

  it("pauses booking actions on a booking-read error and makes the read retryable", async () => {
    const bookingFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(bookingsSnapshot(true));
    mockGetDocs.mockImplementation((ref: { path: string }) =>
      ref.path === "classes" ? Promise.resolve(classesSnapshot()) : bookingFetch()
    );

    render(<Schedule />);
    await flushUpdates();

    expect(screen.getByRole("button", { name: "Retry booking status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Booking unavailable" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry booking status" }));
    await flushUpdates();

    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeEnabled();
    expect(bookingFetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes and announces the server-confirmed allowance after booking and cancellation", async () => {
    const bookingFetch = jest
      .fn()
      .mockResolvedValueOnce(bookingsSnapshot(false))
      .mockResolvedValueOnce(bookingsSnapshot(true))
      .mockResolvedValueOnce(bookingsSnapshot(false));
    mockGetDocs.mockImplementation((ref: { path: string }) =>
      ref.path === "classes" ? Promise.resolve(classesSnapshot()) : bookingFetch()
    );

    render(<Schedule />);
    await flushUpdates();

    expect(screen.getByText(/0 of 2 booked · 2 remaining/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book session" }));
    await flushUpdates();

    expect(screen.getByText(/1 of 2 booked · 1 remaining/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Booked Conditioning\. 1 of 2 Conditioning bookings used; 1 remaining/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    await flushUpdates();

    expect(screen.getByText(/0 of 2 booked · 2 remaining/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Cancelled Conditioning\. 0 of 2 Conditioning bookings used; 2 remaining/i)
    ).toBeInTheDocument();
    expect(mockBookClass).toHaveBeenCalledTimes(1);
    expect(mockCancelBooking).toHaveBeenCalledTimes(1);
    expect(bookingFetch).toHaveBeenCalledTimes(3);
  });
});

describe("London-time schedule rules", () => {
  it("uses the class timezone for the 18:00 booking cutoff", () => {
    const classStart = Timestamp.fromDate(new Date("2026-09-08T17:00:00.000Z"));
    expect(computeBookingClosesAt(classStart, "Europe/London")?.toISOString()).toBe(
      "2026-09-08T14:00:00.000Z"
    );
  });

  it("cuts over at Saturday 10:00 London time across the autumn DST boundary", () => {
    const before = scheduleWindowWithSaturdayCutover(
      new Date("2026-10-24T08:59:00.000Z")
    );
    const after = scheduleWindowWithSaturdayCutover(
      new Date("2026-10-24T09:00:00.000Z")
    );

    expect(before.fromDayKey).toBe("2026-10-19");
    expect(before.from.toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(before.showNextWeek).toBe(false);
    expect(after.fromDayKey).toBe("2026-10-26");
    expect(after.from.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(after.showNextWeek).toBe(true);
  });
});
