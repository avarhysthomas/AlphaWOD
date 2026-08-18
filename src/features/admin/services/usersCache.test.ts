import { getCachedAdminUser, getCachedAdminUsers, invalidateCachedAdminUsers } from "./usersCache";

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

const users = [
  {
    id: "member-a",
    name: "Member A",
    role: "user",
    approvalStatus: "approved" as const,
    entitlementStatus: "active" as const,
    entitlementSource: "stripe" as const,
    alphaWodAccess: true,
  },
];

describe("staff users cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateCachedAdminUsers();
  });

  it("loads the authoritative staff directory once and reuses the cache", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { users } });
    mockedHttpsCallable.mockReturnValue(invoke);

    await expect(getCachedAdminUsers()).resolves.toEqual(users);
    await expect(getCachedAdminUsers()).resolves.toEqual(users);

    expect(mockedHttpsCallable).toHaveBeenCalledTimes(1);
    expect(mockedHttpsCallable).toHaveBeenCalledWith(expect.anything(), "listStaffUsers");
    expect(invoke).toHaveBeenCalledWith({});
  });

  it("uses the same callable-backed directory for a single-user lookup", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { users } });
    mockedHttpsCallable.mockReturnValue(invoke);

    await expect(getCachedAdminUser("member-a")).resolves.toEqual(users[0]);
    await expect(getCachedAdminUser("missing")).resolves.toBeNull();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed callable response instead of caching it", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { users: [{ name: "No id" }] } });
    mockedHttpsCallable.mockReturnValue(invoke);

    await expect(getCachedAdminUsers()).rejects.toThrow("invalid response");
    await expect(getCachedAdminUsers()).rejects.toThrow("invalid response");

    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
