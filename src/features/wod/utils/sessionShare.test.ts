import {
  formatStationForShare,
  formatStationMovementForShare,
} from "./sessionShare";

describe("session share formatting", () => {
  it("includes movement names and targets", () => {
    expect(
      formatStationForShare(
        {
          title: "Station 2",
          movements: [
            { name: "Ski Erg", target: "500m" },
            { name: "Sled Push", target: "4 x 15m" },
          ],
        },
        1
      )
    ).toBe("Station 2 • Ski Erg: 500m • Sled Push: 4 x 15m");
  });

  it("falls back to target or notes when the movement name is missing", () => {
    expect(formatStationMovementForShare({ target: "45 sec work" })).toBe(
      "45 sec work"
    );
    expect(formatStationMovementForShare({ notes: "Smooth transitions" })).toBe(
      "Smooth transitions"
    );
  });
});
