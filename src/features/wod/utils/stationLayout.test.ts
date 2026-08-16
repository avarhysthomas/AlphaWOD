import { stationDensity, stationGrid } from "./stationLayout";

describe("stationGrid", () => {
  it("gives 1-4 stations a single row of equal columns", () => {
    expect(stationGrid(1)).toEqual({ columns: 1, rows: 1 });
    expect(stationGrid(2)).toEqual({ columns: 2, rows: 1 });
    expect(stationGrid(3)).toEqual({ columns: 3, rows: 1 });
    expect(stationGrid(4)).toEqual({ columns: 4, rows: 1 });
  });

  it("balances 5-8 stations across two rows", () => {
    expect(stationGrid(5)).toEqual({ columns: 3, rows: 2 });
    expect(stationGrid(6)).toEqual({ columns: 3, rows: 2 });
    expect(stationGrid(7)).toEqual({ columns: 4, rows: 2 });
    expect(stationGrid(8)).toEqual({ columns: 4, rows: 2 });
  });

  it("goes as square as it can past eight, rather than one thin row", () => {
    expect(stationGrid(9)).toEqual({ columns: 3, rows: 3 });
    expect(stationGrid(12)).toEqual({ columns: 4, rows: 3 });
    expect(stationGrid(16)).toEqual({ columns: 4, rows: 4 });
  });

  it("always has enough cells for every station", () => {
    for (let count = 1; count <= 30; count += 1) {
      const { columns, rows } = stationGrid(count);
      expect(columns * rows).toBeGreaterThanOrEqual(count);
    }
  });

  it("never returns an empty grid for junk counts", () => {
    expect(stationGrid(0)).toEqual({ columns: 1, rows: 1 });
    expect(stationGrid(Number.NaN)).toEqual({ columns: 1, rows: 1 });
  });
});

describe("stationDensity", () => {
  it("steps type down as cards get smaller", () => {
    expect(stationDensity(3)).toBe("roomy");
    expect(stationDensity(6)).toBe("normal");
    expect(stationDensity(12)).toBe("tight");
  });
});
