import { httpsCallable } from "firebase/functions";
import {
  clearPendingClaim,
  clearCheckoutAttempt,
  createCheckoutAttemptId,
  readCheckoutAttemptId,
  readPendingClaim,
  readPendingClaimVerifier,
  rememberPendingClaim,
  requestMembershipCancellation,
  resolveCheckoutAttempt,
  type CheckoutDetails,
} from "./membership";

jest.mock("firebase/functions", () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

jest.mock("../../../firebaseApp", () => ({
  __esModule: true,
  default: {},
}));

describe("checkout attempt identifiers", () => {
  const originalCrypto = globalThis.crypto;
  const originalTextEncoder = globalThis.TextEncoder;

  beforeAll(() => {
    const { webcrypto } = require("crypto") as typeof import("crypto");
    const { TextEncoder } = require("util") as typeof import("util");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: TextEncoder,
    });
  });

  it("keeps a pending claim only in this tab and expires it after 24 hours", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    rememberPendingClaim(
      "cs_short_lived_claim",
      "12345678-1234-4123-8123-123456789abc"
    );

    expect(readPendingClaim()).toBe("cs_short_lived_claim");
    expect(readPendingClaimVerifier()).toBe(
      "12345678-1234-4123-8123-123456789abc"
    );
    expect(window.localStorage.getItem("zaf.pendingMembershipClaim")).toBeNull();

    now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000 + 1);
    expect(readPendingClaim()).toBeNull();
    expect(window.sessionStorage.getItem("zaf.pendingMembershipClaim")).toBeNull();
    clearPendingClaim();
    now.mockRestore();
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: originalTextEncoder,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("creates unique opaque UUID-shaped values for Stripe idempotency", () => {
    const ids = Array.from({ length: 32 }, () => createCheckoutAttemptId());

    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  it("reuses an attempt after reload without persisting checkout PII", async () => {
    const details: CheckoutDetails = {
      planKey: "adult_unlimited",
      participantFullName: "Private Person",
      participantDateOfBirth: "1990-01-01",
      participantIsPayer: true,
      signedName: "Private Person",
      acceptedDocuments: true,
      immediatePerformanceRequested: true,
    };

    const first = await resolveCheckoutAttempt(details);
    const afterReload = await resolveCheckoutAttempt(details, null);
    expect(afterReload).toEqual(first);
    expect(readCheckoutAttemptId()).toBe(first.id);

    const stored = window.sessionStorage.getItem("zaf.membershipCheckoutAttempt.v1") ?? "";
    expect(stored).not.toContain("Private Person");
    expect(stored).not.toContain("1990-01-01");

    clearCheckoutAttempt(first.id);
    const replacement = await resolveCheckoutAttempt(details, null);
    expect(replacement.id).not.toBe(first.id);
  });

  it("rotates the attempt when chargeable details change", async () => {
    const base: CheckoutDetails = {
      planKey: "adult_unlimited",
      participantFullName: "First Athlete",
      participantDateOfBirth: "1990-01-01",
      participantIsPayer: true,
      signedName: "First Athlete",
      acceptedDocuments: true,
      immediatePerformanceRequested: true,
    };
    const first = await resolveCheckoutAttempt(base);
    const changed = await resolveCheckoutAttempt({
      ...base,
      participantFullName: "Second Athlete",
      signedName: "Second Athlete",
    }, first);

    expect(changed.id).not.toBe(first.id);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it("rotates an anonymous attempt when the payer signs in or changes account", async () => {
    const details: CheckoutDetails = {
      planKey: "adult_unlimited",
      participantFullName: "Identity Change",
      participantDateOfBirth: "1990-01-01",
      participantIsPayer: true,
      signedName: "Identity Change",
      acceptedDocuments: true,
      immediatePerformanceRequested: true,
    };
    const anonymous = await resolveCheckoutAttempt(details, null, { payerUid: null });
    const signedIn = await resolveCheckoutAttempt(details, anonymous, {
      payerUid: "member-one",
    });
    const switchedAccount = await resolveCheckoutAttempt(details, signedIn, {
      payerUid: "member-two",
    });

    expect(signedIn.id).not.toBe(anonymous.id);
    expect(switchedAccount.id).not.toBe(signedIn.id);
    const stored = window.sessionStorage.getItem("zaf.membershipCheckoutAttempt.v1") ?? "";
    expect(stored).not.toContain("member-one");
    expect(stored).not.toContain("member-two");
  });

  it("binds a cancellation request to the preview shown to the member", async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: {ok: true, outcome: {cancelAtUnixSeconds: 1_788_217_200}},
    });
    (httpsCallable as jest.Mock).mockReturnValue(invoke);

    await requestMembershipCancellation("sub_previewed", 1_788_217_200);

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "requestMembershipCancellation"
    );
    expect(invoke).toHaveBeenCalledWith({
      subscriptionId: "sub_previewed",
      expectedCancelAtUnixSeconds: 1_788_217_200,
    });
  });
});
