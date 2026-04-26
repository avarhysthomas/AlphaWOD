import {
  normalizeTrainingLogValue,
  parseChartValue,
  validateTrainingLogForm,
} from "./movementHelpers";

describe("movementHelpers time parsing", () => {
  it("parses mm.ss values for mm:ss units", () => {
    expect(parseChartValue("4.30", "mm:ss")).toBe(270);
    expect(parseChartValue("0.45", "mm:ss")).toBe(45);
  });

  it("does not treat mm.ss as decimal seconds for mm:ss units", () => {
    expect(parseChartValue("4.75", "mm:ss")).toBeNull();
    expect(parseChartValue("4.65", "mm:ss")).toBeNull();
  });

  it("normalizes dot-separated time input before save", () => {
    expect(normalizeTrainingLogValue("4.30", "mm:ss")).toBe("4:30");
    expect(normalizeTrainingLogValue("0.45", "mm:ss")).toBe("0:45");
  });

  it("accepts dot-separated time input in validation", () => {
    expect(
      validateTrainingLogForm({
        value: "4.30",
        reps: "",
        date: "2026-04-26",
        notes: "",
        unit: "mm:ss",
        categoryKey: "engine",
        movementName: "1km Run",
        showRepsField: false,
      })
    ).toEqual({});
  });
});
