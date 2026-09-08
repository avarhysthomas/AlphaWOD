/* eslint-disable @typescript-eslint/no-var-requires, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEADERBOARD_CANDIDATE_MAX_ROWS,
  filterAttendanceLeaderboardRows,
  filterDipLeaderboardRows,
  resolveBoundedLeaderboardMonthKey,
} = require("../lib/leaderboard");

const active = {
  role: "user",
  approvalStatus: "approved",
  entitlementStatus: "active",
  entitlementSource: "stripe",
  name: "Active Member",
  photoURL: "https://example.test/active.jpg",
};

test("leaderboard month keys are strictly formatted and bounded", () => {
  assert.equal(
    resolveBoundedLeaderboardMonthKey("2026-08", "2026-08"),
    "2026-08"
  );
  assert.equal(
    resolveBoundedLeaderboardMonthKey(undefined, "2026-08"),
    "2026-08"
  );
  assert.equal(
    resolveBoundedLeaderboardMonthKey("2024-08", "2026-08"),
    "2024-08"
  );
  assert.equal(resolveBoundedLeaderboardMonthKey("2024-07", "2026-08"), null);
  assert.equal(resolveBoundedLeaderboardMonthKey("2026-10", "2026-08"), null);
  assert.equal(resolveBoundedLeaderboardMonthKey("2026-13", "2026-08"), null);
  assert.equal(
    resolveBoundedLeaderboardMonthKey("random-month", "2026-08"),
    null
  );
});

test("stored attendance rows exclude currently revoked or deleted members", () => {
  const profiles = new Map([
    ["active", active],
    ["revoked", {
      ...active,
      entitlementStatus: "restricted",
      entitlementSource: "manual",
    }],
  ]);
  const rows = filterAttendanceLeaderboardRows([
    {userId: "active", name: "Stale Name", attendedCount: 4},
    {userId: "revoked", name: "Revoked Name", attendedCount: 99},
    {userId: "deleted", name: "Deleted Name", attendedCount: 100},
  ], profiles, 200);
  assert.deepEqual(rows, [{
    userId: "active",
    name: "Active Member",
    photoURL: "https://example.test/active.jpg",
    attendedCount: 4,
  }]);
});

test("stored dip rows recheck access and use the current safe profile", () => {
  const profiles = new Map([
    ["active", active],
    ["revoked", {...active, role: "banned", entitlementStatus: "restricted",
      entitlementSource: "manual"}],
  ]);
  const rows = filterDipLeaderboardRows([
    {userId: "revoked", name: "Should not leak", dipCount: 20},
    {userId: "active", name: "Stale Name", dipCount: 2},
  ], profiles, 200);
  assert.deepEqual(rows, [{
    userId: "active",
    name: "Active Member",
    photoURL: "https://example.test/active.jpg",
    dipCount: 2,
  }]);
});

test("stored dip rows sanitize counts and enforce the returned row limit", () => {
  const profiles = new Map([
    ["one", {...active, name: "One"}],
    ["two", {...active, name: "Two"}],
    ["fraction", {...active, name: "Fraction"}],
    ["infinite", {...active, name: "Infinite"}],
    ["invalid", {...active, name: "Invalid"}],
  ]);
  const rows = filterDipLeaderboardRows([
    {userId: "infinite", dipCount: Infinity},
    {userId: "invalid", dipCount: "not-a-number"},
    {userId: "two", dipCount: "4"},
    {userId: "fraction", dipCount: 2.9},
    {userId: "one", dipCount: 1},
  ], profiles, 2);

  assert.equal(LEADERBOARD_CANDIDATE_MAX_ROWS, 500);
  assert.deepEqual(rows, [
    {userId: "two", name: "Two", photoURL: active.photoURL, dipCount: 4},
    {userId: "fraction", name: "Fraction", photoURL: active.photoURL, dipCount: 2},
  ]);
});
