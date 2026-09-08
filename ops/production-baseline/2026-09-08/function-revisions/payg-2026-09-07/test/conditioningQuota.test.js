/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  conditioningWeekForClassStart,
} = require("../lib/conditioningQuota");

function timestampLike(iso) {
  return {toDate: () => new Date(iso)};
}

test("London Monday-to-Sunday quota keys split exactly at local midnight", () => {
  assert.deepEqual(
    conditioningWeekForClassStart(timestampLike("2026-08-30T22:30:00Z")),
    {weekKey: "2026-08-24", weekEndsOn: "2026-08-30"}
  );
  assert.deepEqual(
    conditioningWeekForClassStart(timestampLike("2026-08-30T23:30:00Z")),
    {weekKey: "2026-08-31", weekEndsOn: "2026-09-06"}
  );
});

test("London quota keys remain stable across the autumn DST boundary", () => {
  assert.deepEqual(
    conditioningWeekForClassStart(timestampLike("2026-10-25T23:30:00Z")),
    {weekKey: "2026-10-19", weekEndsOn: "2026-10-25"}
  );
  assert.deepEqual(
    conditioningWeekForClassStart(timestampLike("2026-10-26T00:30:00Z")),
    {weekKey: "2026-10-26", weekEndsOn: "2026-11-01"}
  );
  assert.equal(conditioningWeekForClassStart({toDate: () => new Date("bad")}), null);
});
