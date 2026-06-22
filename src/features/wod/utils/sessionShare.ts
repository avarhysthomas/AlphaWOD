type ShareMovement = {
  name?: string | null;
  target?: string | null;
  notes?: string | null;
};

type ShareStation = {
  title?: string | null;
  movements?: ShareMovement[] | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function formatStationMovementForShare(movement: ShareMovement) {
  const name = clean(movement.name);
  const target = clean(movement.target);
  const notes = clean(movement.notes);
  const detail = [target, notes].filter(Boolean).join(" - ");

  if (name && detail) return `${name}: ${detail}`;
  return name || detail;
}

export function formatStationForShare(station: ShareStation, index: number) {
  const title = clean(station.title) || `Station ${index + 1}`;
  const movementDetails = (station.movements ?? [])
    .map(formatStationMovementForShare)
    .filter(Boolean);

  return movementDetails.length
    ? `${title} • ${movementDetails.join(" • ")}`
    : title;
}
