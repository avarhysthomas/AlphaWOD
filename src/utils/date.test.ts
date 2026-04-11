import { getDateInputValueInTimeZone } from "./date";

describe("getDateInputValueInTimeZone", () => {
  it("uses the London calendar day instead of UTC around midnight", () => {
    const justAfterMidnightInLondon = new Date("2026-07-01T00:15:00+01:00");

    expect(
      getDateInputValueInTimeZone(justAfterMidnightInLondon, "Europe/London")
    ).toBe("2026-07-01");
  });

  it("still returns the expected day in UTC", () => {
    const instant = new Date("2026-07-01T00:15:00+01:00");

    expect(getDateInputValueInTimeZone(instant, "UTC")).toBe("2026-06-30");
  });
});
