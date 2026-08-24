import { acceptCurrentWaiver, bootstrapUserProfile } from "./account";
import { CHECKOUT_DOCUMENTS } from "../../../lib/membershipPlans";

jest.mock("firebase/functions", () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

jest.mock("../../../firebaseApp", () => ({
  __esModule: true,
  default: {},
}));

const mockedHttpsCallable = jest.requireMock("firebase/functions")
  .httpsCallable as jest.Mock;

describe("account callables", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends the server-owned profile bootstrap contract", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true } });
    mockedHttpsCallable.mockReturnValue(invoke);

    await bootstrapUserProfile("  Member A  ");

    expect(mockedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "bootstrapUserProfile"
    );
    expect(invoke).toHaveBeenCalledWith({ displayName: "Member A" });
  });

  it("maps the UI waiver fields to the callable's immutable evidence contract", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true } });
    mockedHttpsCallable.mockReturnValue(invoke);

    await acceptCurrentWaiver({
      acceptedName: "Member A",
      waiverVersion: CHECKOUT_DOCUMENTS.adultWaiver.version,
      acknowledgements: ["Acknowledged"],
      mediaConsent: false,
    });

    expect(mockedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "acceptCurrentWaiver"
    );
    expect(invoke).toHaveBeenCalledWith({
      signedName: "Member A",
      version: CHECKOUT_DOCUMENTS.adultWaiver.version,
      acknowledgements: ["Acknowledged"],
      mediaConsent: false,
    });
  });
});
