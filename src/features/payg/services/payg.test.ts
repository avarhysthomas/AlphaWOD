import {httpsCallable} from "firebase/functions";
import {
  clearPendingPaygCheckout,
  createPaygCheckoutSession,
  getPaygCancellationPreview,
  getPaygCheckoutStatus,
  getPublicPaygSchedule,
  readPendingPaygCheckout,
  rememberPendingPaygCheckout,
  requestPaygCancellation,
  type CreatePaygCheckoutRequest,
} from "./payg";

jest.mock("firebase/functions", () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

jest.mock("../../../firebaseApp", () => ({__esModule: true, default: {}}));

describe("PAYG callable client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("uses only the public sanitized timetable callable", async () => {
    const invoke = jest.fn().mockResolvedValue({data: {ok: true, classes: []}});
    (httpsCallable as jest.Mock).mockReturnValue(invoke);

    await getPublicPaygSchedule();

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), "getPublicPaygSchedule");
    expect(invoke).toHaveBeenCalledWith({});
  });

  it("sends the exact guest, class and legal acceptance contract with App Check", async () => {
    const invoke = jest.fn().mockResolvedValue({data: {ok: true, sessionUrl: "https://checkout.stripe.test/payg"}});
    (httpsCallable as jest.Mock).mockReturnValue(invoke);
    const request: CreatePaygCheckoutRequest = {
      checkoutSchemaVersion: 1,
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      classId: "class_1",
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
    };

    await createPaygCheckoutSession(request);

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "createPaygCheckoutSession",
      {limitedUseAppCheckTokens: true}
    );
    expect(invoke).toHaveBeenCalledWith(request);
  });

  it("previews a signed cancellation before requiring explicit confirmation", async () => {
    const invoke = jest.fn().mockResolvedValue({data: {ok: true, state: "processing"}});
    (httpsCallable as jest.Mock).mockReturnValue(invoke);
    await getPaygCheckoutStatus("cs_payg");
    expect(httpsCallable).toHaveBeenLastCalledWith(expect.anything(), "getPaygCheckoutStatus");
    expect(invoke).toHaveBeenLastCalledWith({sessionId: "cs_payg"});

    await getPaygCancellationPreview("signed-token");
    expect(httpsCallable).toHaveBeenLastCalledWith(
      expect.anything(),
      "getPaygCancellationPreview",
      {limitedUseAppCheckTokens: true}
    );
    expect(invoke).toHaveBeenLastCalledWith({token: "signed-token"});

    await requestPaygCancellation("signed-token");
    expect(httpsCallable).toHaveBeenLastCalledWith(
      expect.anything(),
      "requestPaygCancellation",
      {limitedUseAppCheckTokens: true}
    );
    expect(invoke).toHaveBeenLastCalledWith({token: "signed-token", confirm: true});
  });

  it("remembers only an active opaque Stripe return without guest PII", () => {
    const pending = {
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      sessionUrl: "https://checkout.stripe.test/c/pay/cs_test_pending_123",
      sessionId: "cs_test_pending_123",
      holdExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      class: {
        classId: "class_1",
        title: "Conditioning",
        startTime: "2026-09-07T05:00:00.000Z",
        endTime: "2026-09-07T06:00:00.000Z",
        timezone: "Europe/London",
        location: "Unit 3",
      },
    };

    rememberPendingPaygCheckout(pending);

    expect(readPendingPaygCheckout()).toEqual(pending);
    const stored = window.sessionStorage.getItem("zaf.pendingPaygCheckout.v1") ?? "";
    expect(stored).not.toContain("email");
    expect(stored).not.toContain("dateOfBirth");
    expect(stored).not.toContain("phone");

    clearPendingPaygCheckout();
    expect(readPendingPaygCheckout()).toBeNull();
  });

  it("drops expired or tampered PAYG return links instead of redirecting", () => {
    window.sessionStorage.setItem("zaf.pendingPaygCheckout.v1", JSON.stringify({
      checkoutAttemptId: "12345678-1234-4123-8123-123456789abc",
      sessionUrl: "https://attacker.example/checkout",
      sessionId: "cs_test_pending_123",
      holdExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      class: {
        classId: "class_1",
        title: "Conditioning",
        startTime: "2026-09-07T05:00:00.000Z",
        endTime: "2026-09-07T06:00:00.000Z",
        timezone: "Europe/London",
        location: null,
      },
    }));

    expect(readPendingPaygCheckout()).toBeNull();
    expect(window.sessionStorage.getItem("zaf.pendingPaygCheckout.v1")).toBeNull();
  });
});
