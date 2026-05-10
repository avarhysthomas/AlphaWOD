import {
  buildAppUser,
  buildSafePendingAppUser,
} from "./authUser";

describe("auth user builders", () => {
  it("maps a loaded approved member profile", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { name: "Member", role: "user", approvalStatus: "approved", strengthBlock: "A" }
      )
    ).toEqual({
      uid: "abc",
      email: "member@example.com",
      name: "Member",
      role: "user",
      approvalStatus: "approved",
      strengthBlock: "A",
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
      strengthBlock: "none",
    });
  });

  it("preserves a banned role from the profile", () => {
    expect(
      buildAppUser(
        { uid: "abc", email: "member@example.com" },
        { name: "Member", role: "banned", approvalStatus: "approved" }
      )
    ).toEqual({
      uid: "abc",
      email: "member@example.com",
      name: "Member",
      role: "banned",
      approvalStatus: "approved",
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
      email: "member@example.com",
      name: "SGPT",
      role: "sgpt",
      approvalStatus: "approved",
      strengthBlock: "none",
    });
  });
});
