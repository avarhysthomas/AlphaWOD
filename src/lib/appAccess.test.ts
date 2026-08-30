import type {AppUser} from "../context/authUser";
import {hasAppCapability, isLimitedAppUser} from "./appAccess";

const entitled: AppUser = {
  uid: "member",
  role: "user",
  approvalStatus: "approved",
  entitlementStatus: "active",
  entitlementSource: "stripe",
  alphaWodAccess: true,
  appAccessTier: "limited",
  entitlementPlanKey: "adult_conditioning",
  entitlementClassSlots: ["monday_0600", "thursday_1800"],
};

describe("app capabilities", () => {
  it("limits Conditioning members to schedule, profile and membership", () => {
    expect(isLimitedAppUser(entitled)).toBe(true);
    expect(hasAppCapability(entitled, "schedule")).toBe(true);
    expect(hasAppCapability(entitled, "profile")).toBe(true);
    expect(hasAppCapability(entitled, "membership")).toBe(true);
    expect(hasAppCapability(entitled, "dashboard")).toBe(false);
    expect(hasAppCapability(entitled, "training")).toBe(false);
    expect(hasAppCapability(entitled, "leaderboards")).toBe(false);
  });

  it("fails closed when the limited slot projection is incomplete", () => {
    expect(isLimitedAppUser({...entitled, entitlementClassSlots: ["monday_0600"]}))
      .toBe(false);
    expect(hasAppCapability({...entitled, entitlementClassSlots: []}, "schedule"))
      .toBe(false);
  });

  it("keeps legacy entitled accounts on full access", () => {
    const legacy = {
      ...entitled,
      entitlementSource: "legacy" as const,
      appAccessTier: undefined,
      entitlementClassSlots: undefined,
    };
    expect(hasAppCapability(legacy, "dashboard")).toBe(true);
  });
});
