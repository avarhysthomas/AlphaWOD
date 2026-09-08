import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ClassRoster from "./ClassRoster";
import {
  beginClassCancellation,
  finalizeClassCancellation,
} from "../services/classCancellation";

const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockGetRoster = jest.fn();
const mockAdminAddBooking = jest.fn();
const mockMarkBookingStatus = jest.fn();

const mockAppUser = {
  uid: "admin-1",
  name: "Admin User",
  email: "admin@example.com",
  role: "admin",
  approvalStatus: "approved",
  entitlementStatus: "active",
  entitlementSource: "staff",
  alphaWodAccess: true,
  appAccessTier: "full",
};

jest.mock("../../../firebase", () => ({ db: {} }));

jest.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "admin-1" } }),
}));

jest.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) => {
    if (name === "getClassRoster") return (...args: unknown[]) => mockGetRoster(...args);
    if (name === "adminAddBooking") return (...args: unknown[]) => mockAdminAddBooking(...args);
    if (name === "markBookingStatus") return (...args: unknown[]) => mockMarkBookingStatus(...args);
    throw new Error(`Unexpected callable ${name}`);
  },
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "admin-1", email: "admin@example.com", photoURL: null },
    appUser: mockAppUser,
  }),
}));

jest.mock("../../../components/layout/UserTopNav", () => ({
  getUserNavItems: () => [],
}));

jest.mock("../../../components/ui/UserAvatar", () => ({ name }: { name: string }) => (
  <span>{name.slice(0, 1)}</span>
));

jest.mock("../services/checkin", () => ({ checkInBooking: jest.fn() }));

jest.mock("../services/classCancellation", () => ({
  beginClassCancellation: jest.fn(),
  finalizeClassCancellation: jest.fn(),
}));

jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...rest }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to, ...rest }, children),
    NavLink: ({ children, to }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to }, children),
    useParams: () => ({ classId: "class-1" }),
  }),
  { virtual: true }
);

const mockedBegin = beginClassCancellation as jest.MockedFunction<typeof beginClassCancellation>;
const mockedFinalize = finalizeClassCancellation as jest.MockedFunction<
  typeof finalizeClassCancellation
>;

function classSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: () => true,
    data: () => ({
      title: "Conditioning",
      startTime: { toDate: () => new Date("2026-09-08T17:00:00.000Z") },
      endTime: { toDate: () => new Date("2026-09-08T18:00:00.000Z") },
      status: "scheduled",
      bookingOpen: true,
      ...overrides,
    }),
  };
}

function cancellationResult(
  state: "processing" | "awaiting_payg_refunds" | "ready_to_finalize" | "cancelled" =
    "awaiting_payg_refunds"
) {
  return {
    ok: true as const,
    alreadyFinalized: state === "cancelled",
    operation: {
      id: "class_cancel_op_1",
      classId: "class-1",
      state,
      bookingOpen: false as const,
      memberBookingsReleased: 2,
      activeMemberBookingsRemaining: 0,
      paidPaygGuestCount: 1,
      refundedPaygGuestCount: state === "ready_to_finalize" || state === "cancelled" ? 1 : 0,
      unresolvedPaygGuestCount: state === "ready_to_finalize" || state === "cancelled" ? 0 : 1,
      activeBookingCount: state === "cancelled" ? 0 : 1,
      unpaidHoldCount: 0,
    },
    paygGuests: [
      {
        orderId: "payg_order_1",
        bookingId: "payg_booking_1",
        paymentIntentId: "pi_test_1",
        chargeId: "ch_test_1",
        refundId: state === "ready_to_finalize" || state === "cancelled" ? "re_test_1" : null,
        orderStatus: state === "ready_to_finalize" || state === "cancelled" ? "refunded" : "paid",
        refundStatus: state === "ready_to_finalize" || state === "cancelled" ? "succeeded" : "pending",
        amountPence: 700,
        currency: "gbp",
        confirmationSuppressed: true,
        confirmationResolved: true,
        confirmationDisposition: "suppressed_before_send" as const,
      },
    ],
  };
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
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

describe("whole-class cancellation admin workflow", () => {
  beforeEach(() => {
    mockAppUser.role = "admin";
    mockGetDoc.mockReset();
    mockGetDocs.mockReset();
    mockGetRoster.mockReset();
    mockAdminAddBooking.mockReset();
    mockMarkBookingStatus.mockReset();
    mockedBegin.mockReset();
    mockedFinalize.mockReset();
    jest.spyOn(window, "alert").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetDoc.mockResolvedValue(classSnapshot());
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockGetRoster.mockResolvedValue({
      data: {
        classId: "class-1",
        total: 0,
        checkedInCount: 0,
        attendees: [],
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps cancellation and roster mutations disabled while the durable class state loads", async () => {
    const pendingClass = deferred<ReturnType<typeof classSnapshot>>();
    mockGetDoc.mockReturnValue(pendingClass.promise);

    render(<ClassRoster />);
    await flushUpdates();

    expect(screen.getByText("Verifying the durable class state…")).toBeInTheDocument();
    expect(screen.getByText("Checking class state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add member" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cancel whole class" })).not.toBeInTheDocument();

    await act(async () => {
      pendingClass.resolve(classSnapshot());
      await pendingClass.promise;
    });
    await flushUpdates();

    expect(screen.getByRole("button", { name: "Cancel whole class" })).toBeEnabled();
  });

  it("keeps the explicit start confirmation available after a recoverable begin error", async () => {
    const authoritativeRecheck = deferred<ReturnType<typeof classSnapshot>>();
    mockGetDoc
      .mockResolvedValueOnce(classSnapshot())
      .mockReturnValueOnce(authoritativeRecheck.promise);
    mockedBegin.mockRejectedValueOnce(new Error("network unavailable"));

    render(<ClassRoster />);
    await flushUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Cancel whole class" }));
    expect(
      screen.getByRole("heading", { name: "Freeze this class and start cancellation?" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Freeze bookings and start" }));
    await flushUpdates();

    expect(screen.getByRole("alert")).toHaveTextContent("network unavailable");
    expect(mockedBegin).toHaveBeenCalledWith({ classId: "class-1" });
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    expect(screen.getByText("Checking class state")).toBeInTheDocument();

    await act(async () => {
      authoritativeRecheck.resolve(classSnapshot());
      await authoritativeRecheck.promise;
    });
    await flushUpdates();

    expect(mockGetDoc).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Cancel whole class" })).toBeEnabled();
  });

  it("resumes through the idempotent begin callable once per click and renders only safe PAYG refs", async () => {
    mockGetDoc.mockResolvedValue(
      classSnapshot({
        bookingOpen: false,
        bookingClosedReason: "class_cancellation",
        cancellationOperationId: "class_cancel_op_1",
        cancellationState: "awaiting_payg_refunds",
      })
    );
    const pendingResume = deferred<ReturnType<typeof cancellationResult>>();
    mockedBegin.mockReturnValueOnce(pendingResume.promise);

    render(<ClassRoster />);
    await flushUpdates();

    const resume = screen.getByRole("button", { name: "Resume reconciliation" });
    fireEvent.click(resume);
    fireEvent.click(resume);
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reconciling…" })).toBeDisabled();

    await act(async () => {
      pendingResume.resolve(cancellationResult());
      await pendingResume.promise;
    });
    await flushUpdates();

    expect(screen.getByText("payg_order_1")).toBeInTheDocument();
    expect(screen.getByText("pi_test_1")).toBeInTheDocument();
    expect(screen.getByText("ch_test_1")).toBeInTheDocument();
    expect(screen.getByText("£7.00")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Suppressed before send")).toBeInTheDocument();

    mockedBegin.mockResolvedValueOnce(cancellationResult());
    fireEvent.click(screen.getByRole("button", { name: "Refresh reconciliation" }));
    await flushUpdates();
    expect(mockedBegin).toHaveBeenCalledTimes(2);
    expect(mockedBegin).toHaveBeenLastCalledWith({ classId: "class-1" });
  });

  it("presents finalize refusal blockers and preserves the reconciliation snapshot", async () => {
    mockGetDoc.mockResolvedValue(
      classSnapshot({
        bookingOpen: false,
        bookingClosedReason: "class_cancellation",
        cancellationOperationId: "class_cancel_op_1",
        cancellationState: "ready_to_finalize",
      })
    );
    mockedBegin.mockResolvedValueOnce(cancellationResult("ready_to_finalize"));
    mockedFinalize.mockRejectedValueOnce({
      code: "failed-precondition",
      message: "not ready",
      details: {
        reason: "class_cancellation_not_ready",
        operationId: "class_cancel_op_1",
        blockers: {
          activeBookingCount: 1,
          activeMemberBookingCount: 0,
          activePaygBookingCount: 1,
          malformedActiveBookingCount: 0,
          bookedCount: 1,
          unpaidHoldCount: 0,
          activePaygIntentIds: [],
          unreleasedPaygIntentIds: ["payg_intent_unreleased_1"],
          activePaygLockIds: ["payg_lock_1"],
          unresolvedPaymentReviewIds: [],
          unresolvedPaygOrderIds: ["payg_order_1"],
          unboundPaygOrderIds: ["payg_order_unbound_1"],
          unresolvedConfirmationOrderIds: ["payg_order_confirmation_1"],
          malformedPaygOrderIds: [],
        },
        paygGuests: [
          {
            ...cancellationResult("ready_to_finalize").paygGuests[0],
            refundId: "re_latest_refusal",
            confirmationSuppressed: false,
            confirmationResolved: true,
            confirmationDisposition: "accepted_after_change_corrected",
          },
        ],
      },
    });

    render(<ClassRoster />);
    await flushUpdates();
    fireEvent.click(screen.getByRole("button", { name: "Resume reconciliation" }));
    await flushUpdates();

    fireEvent.click(screen.getByRole("button", { name: "Finalize class cancellation" }));
    expect(
      screen.getByRole("heading", { name: "Permanently mark this class cancelled?" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm final cancellation" }));
    await flushUpdates();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Cancellation cannot be finalized yet");
    expect(alert).toHaveTextContent("Active PAYG bookings: 1");
    expect(alert).toHaveTextContent("Unreleased PAYG intents: payg_intent_unreleased_1");
    expect(alert).toHaveTextContent("Active PAYG capacity locks: payg_lock_1");
    expect(alert).toHaveTextContent("Unresolved PAYG orders: payg_order_1");
    expect(alert).toHaveTextContent("Unbound PAYG orders: payg_order_unbound_1");
    expect(alert).toHaveTextContent(
      "Unresolved PAYG confirmations: payg_order_confirmation_1"
    );
    expect(screen.getByText("payg_order_1")).toBeInTheDocument();
    expect(screen.getByText("re_latest_refusal")).toBeInTheDocument();
    expect(
      screen.getByText("Late confirmation accepted; correction sent")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh reconciliation" })).toBeEnabled();
    expect(mockedFinalize).toHaveBeenCalledTimes(1);
    expect(mockedFinalize).toHaveBeenCalledWith({ classId: "class-1" });
  });

  it("does not render the cancellation controls outside an admin session", async () => {
    mockAppUser.role = "user";

    render(<ClassRoster />);
    await flushUpdates();

    expect(screen.queryByRole("heading", { name: "Class cancellation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel whole class" })).not.toBeInTheDocument();
  });
});
