import {
  buildAppUser,
  buildSafePendingAppUser,
  getAlphaWodAccessGateRoute,
  hasAlphaWodAccess,
} from "./authUser";

describe("auth user builders", () => {
  it("maps a loaded approved member profile", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        {
          name: "Member",
          role: "user",
          approvalStatus: "approved",
          entitlementStatus: "active",
          entitlementSource: "legacy",
          alphaWodAccess: true,
          strengthBlock: "A",
          waiverAcceptedAt: "2026-05-30T10:00:00.000Z",
          waiverAcceptedVersion: "2026-05-30",
        }
      )
    ).toEqual({
      uid: "abc",
      profileExists: true,
      email: "member@example.com",
      name: "Member",
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
      strengthBlock: "A",
      waiverAcceptedAt: "2026-05-30T10:00:00.000Z",
      waiverAcceptedVersion: "2026-05-30",
    });
  });

  it("falls back to pending when profile loading fails", () => {
    expect(
      buildSafePendingAppUser({ uid: "abc", email: "member@example.com" })
    ).toEqual({
      uid: "abc",
      email: "member@example.com",
      role: "user",
      approvalStatus: "pending",
      entitlementStatus: "none",
      entitlementSource: "none",
      alphaWodAccess: false,
      strengthBlock: "none",
    });
  });

  it.each([
    ["a missing status", undefined],
    ["a null status", null],
    ["an unknown status", "active"],
    ["a status with the wrong casing", "APPROVED"],
  ])("fails closed for %s", (_label, approvalStatus) => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { role: "user", approvalStatus }
      ).approvalStatus
    ).toBe("pending");
  });

  it("only grants access for the exact approved status", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { role: "user", approvalStatus: "approved" }
      ).approvalStatus
    ).toBe("approved");
  });

  it("preserves a banned role from the profile", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { name: "Member", role: "banned", approvalStatus: "approved" }
      )
    ).toEqual({
      uid: "abc",
      profileExists: true,
      email: "member@example.com",
      name: "Member",
      role: "banned",
      approvalStatus: "approved",
      entitlementStatus: "none",
      entitlementSource: "none",
      alphaWodAccess: false,
      strengthBlock: "none",
    });
  });

  it("preserves the sgpt role from the profile", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { name: "SGPT", role: "sgpt", approvalStatus: "approved" }
      )
    ).toEqual({
      uid: "abc",
      profileExists: true,
      email: "member@example.com",
      name: "SGPT",
      role: "sgpt",
      approvalStatus: "approved",
      entitlementStatus: "none",
      entitlementSource: "none",
      alphaWodAccess: false,
      strengthBlock: "none",
    });
  });

  it("does not promote a missing or malformed role to member", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        {
          approvalStatus: "approved",
          entitlementStatus: "active",
          alphaWodAccess: true,
        }
      ).role
    ).toBeUndefined();
  });

  it("grants AlphaWOD access only when every authoritative field is valid", () => {
    const validUser = buildAppUser(
      { uid: "abc", email: "member@example.com" },
      {
        role: "user",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "stripe",
        alphaWodAccess: true,
      }
    );

    expect(hasAlphaWodAccess(validUser)).toBe(true);
    expect(hasAlphaWodAccess({ ...validUser, approvalStatus: "pending" })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, entitlementStatus: "none" })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, entitlementStatus: "restricted" })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, entitlementSource: "none" })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, entitlementSource: "staff" })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, alphaWodAccess: false })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, role: undefined })).toBe(false);
    expect(hasAlphaWodAccess({ ...validUser, role: "banned" })).toBe(false);
    expect(
      hasAlphaWodAccess({ ...validUser, role: "admin", entitlementSource: "staff" })
    ).toBe(true);
    expect(
      hasAlphaWodAccess({ ...validUser, role: "admin", entitlementSource: "stripe" })
    ).toBe(false);
  });

  it("routes pending, restricted, missing, and banned records fail-closed", () => {
    const validUser = buildAppUser(
      { uid: "abc", email: "member@example.com" },
      {
        role: "user",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "legacy",
        alphaWodAccess: true,
      }
    );

    expect(getAlphaWodAccessGateRoute(validUser)).toBeNull();
    expect(getAlphaWodAccessGateRoute(null)).toBe("/pending-approval");
    expect(
      getAlphaWodAccessGateRoute({ ...validUser, approvalStatus: "pending" })
    ).toBe("/pending-approval");
    expect(
      getAlphaWodAccessGateRoute({ ...validUser, entitlementStatus: "restricted" })
    ).toBe("/access-restricted");
    expect(
      getAlphaWodAccessGateRoute({ ...validUser, alphaWodAccess: false })
    ).toBe("/access-restricted");
    expect(
      getAlphaWodAccessGateRoute({ ...validUser, role: "banned" })
    ).toBe("/access-restricted");
  });
});
