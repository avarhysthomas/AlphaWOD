/**
 * Grid shape for the station board.
 *
 * The board always fills its column: rows are equal fractions, so three
 * stations become three full-height columns rather than three shallow cards
 * floating at the top. Past eight stations the grid goes as square as it can,
 * which keeps cards legible instead of letting one row get very thin.
 */
export type StationGrid = {
  columns: number;
  rows: number;
};

export function stationGrid(count: number): StationGrid {
  const safe = Math.max(1, Math.floor(count || 0));

  // 1-4: one row of equal columns.
  if (safe <= 4) return { columns: safe, rows: 1 };

  // 5-8: balanced two-row grid.
  if (safe <= 8) return { columns: Math.ceil(safe / 2), rows: 2 };

  const columns = Math.ceil(Math.sqrt(safe));
  return { columns, rows: Math.ceil(safe / columns) };
}

/**
 * How much room a single card gets, as a rough fraction of the board. Type
 * scales down with it so a 12-station board stays readable without the cards
 * clipping their movement lists.
 */
export function stationDensity(count: number): "roomy" | "normal" | "tight" {
  if (count <= 3) return "roomy";
  if (count <= 8) return "normal";
  return "tight";
}
