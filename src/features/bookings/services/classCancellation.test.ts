import { getFunctions, httpsCallable } from "firebase/functions";
import {
  beginClassCancellation,
  finalizeClassCancellation,
} from "./classCancellation";

const mockInvoke = jest.fn();

jest.mock("firebase/functions", () => ({
  getFunctions: jest.fn(() => ({ region: "europe-west1" })),
  httpsCallable: jest.fn(() => (...args: unknown[]) => mockInvoke(...args)),
}));

const mockedGetFunctions = getFunctions as jest.MockedFunction<typeof getFunctions>;
const mockedHttpsCallable = httpsCallable as jest.MockedFunction<typeof httpsCallable>;

const result = {
  ok: true as const,
  alreadyFinalized: false,
  operation: {
    id: "class_cancel_op_1",
    classId: "class-1",
    state: "ready_to_finalize" as const,
    bookingOpen: false as const,
    memberBookingsReleased: 1,
    activeMemberBookingsRemaining: 0,
    paidPaygGuestCount: 0,
    refundedPaygGuestCount: 0,
    unresolvedPaygGuestCount: 0,
    activeBookingCount: 0,
    unpaidHoldCount: 0,
  },
  paygGuests: [],
};

describe("class cancellation callable bindings", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockedGetFunctions.mockReset();
    mockedHttpsCallable.mockReset();
    mockedGetFunctions.mockReturnValue({ region: "europe-west1" } as any);
    mockedHttpsCallable.mockImplementation(
      () => ((...args: unknown[]) => mockInvoke(...args)) as any
    );
    mockInvoke.mockResolvedValue({ data: result });
  });

  it("binds begin to the europe-west1 admin callable", async () => {
    await expect(beginClassCancellation({ classId: "class-1" })).resolves.toEqual(result);

    expect(mockedGetFunctions).toHaveBeenCalledWith(undefined, "europe-west1");
    expect(mockedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "beginClassCancellation"
    );
    expect(mockInvoke).toHaveBeenCalledWith({ classId: "class-1" });
  });

  it("binds finalize to the europe-west1 admin callable", async () => {
    await expect(finalizeClassCancellation({ classId: "class-1" })).resolves.toEqual(result);

    expect(mockedGetFunctions).toHaveBeenCalledWith(undefined, "europe-west1");
    expect(mockedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "finalizeClassCancellation"
    );
    expect(mockInvoke).toHaveBeenCalledWith({ classId: "class-1" });
  });
});
