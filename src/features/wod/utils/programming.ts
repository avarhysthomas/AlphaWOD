/**
 * Block-based programming model for the WOD editor.
 *
 * Sessions are stored in `wods/{date}` under a slot key (AM / 930AM / PM).
 * The editor works with `blocks` (schema v2). On save we also project the
 * blocks back onto the legacy flat fields (stations, roundDurationSeconds,
 * strengthMovements, ...) so WODDisplay, the dashboard cards, and the share
 * images keep working without changes.
 */

export type SlotKey = "AM" | "930AM" | "PM";

export const SLOT_KEYS: SlotKey[] = ["AM", "930AM", "PM"];

export const SLOT_LABELS: Record<SlotKey, string> = {
  AM: "6AM",
  "930AM": "9:30AM",
  PM: "6PM",
};

/**
 * Which class slot a wall-clock hour belongs to, so the TV board opens on the
 * session that is actually next rather than always on 6AM.
 */
export function slotForHour(hour: number): SlotKey {
  if (hour < 8) return "AM";
  if (hour < 14) return "930AM";
  return "PM";
}

export type ConditioningFormat =
  | "AMRAP"
  | "For Time"
  | "EMOM"
  | "Chipper"
  | "Intervals";

export const CONDITIONING_FORMATS: ConditioningFormat[] = [
  "AMRAP",
  "For Time",
  "EMOM",
  "Chipper",
  "Intervals",
];

export type TimerMode = "timed" | "stationControlled";

export type StationMovement = {
  id: string;
  name: string;
  target: string;
};

export type Station = {
  id: string;
  title: string;
  movements: StationMovement[];
};

export type StrengthMovement = {
  id: string;
  movement: string;
  load: string;
  sets: string;
  reps: string;
};

export type StrengthStation = {
  id: string;
  title: string;
  movements: StrengthMovement[];
};

export type TextBlockKind = "warmup" | "finisher" | "cooldown" | "notes";

export type TextBlock = {
  id: string;
  kind: TextBlockKind;
  title: string;
  text: string;
};

export type StrengthBlock = {
  id: string;
  kind: "strength";
  title: string;
  goal: string;
  load: string;
  range: string;
  cue: string;
  stations: StrengthStation[];
};

export type ConditioningBlock = {
  id: string;
  kind: "conditioning";
  title: string;
  format: ConditioningFormat;
  timerMode: TimerMode;
  roundMinutes: number;
  roundSeconds: number;
  rounds: number;
  restBetweenRoundsSeconds: number;
  groupSize: number;
  controlStationIndex: number;
  stations: Station[];
};

export type SessionBlock = TextBlock | StrengthBlock | ConditioningBlock;

export type BlockKind = SessionBlock["kind"];

export type SessionPlan = {
  wodName: string;
  blocks: SessionBlock[];
};

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  warmup: "Warm-up",
  strength: "Strength",
  conditioning: "Conditioning",
  finisher: "Finisher",
  cooldown: "Cooldown",
  notes: "Notes",
};

/* ------------------------------ id + number helpers ------------------------------ */

export function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as { randomUUID: () => string }).randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function toInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? Math.floor(n as number) : fallback;
}

export function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/* ------------------------------ factories ------------------------------ */

export function emptyStationMovement(): StationMovement {
  return { id: makeId(), name: "", target: "" };
}

export function emptyStation(index: number): Station {
  return {
    id: makeId(),
    title: `Station ${index + 1}`,
    movements: [emptyStationMovement()],
  };
}

export function emptyStrengthMovement(): StrengthMovement {
  return { id: makeId(), movement: "", load: "", sets: "", reps: "" };
}

export function emptyStrengthStation(index: number): StrengthStation {
  return {
    id: makeId(),
    title: `Station ${index + 1}`,
    movements: [emptyStrengthMovement()],
  };
}

/** "4 x 8" from sets/reps, or whichever half is present. */
export function formatSetsReps(movement: Pick<StrengthMovement, "sets" | "reps">) {
  const sets = movement.sets.trim();
  const reps = movement.reps.trim();
  if (sets && reps) return `${sets} x ${reps}`;
  return sets || reps;
}

export function createBlock(kind: BlockKind): SessionBlock {
  if (kind === "strength") {
    return {
      id: makeId(),
      kind: "strength",
      title: "Strength",
      goal: "",
      load: "",
      range: "",
      cue: "",
      stations: [emptyStrengthStation(0)],
    };
  }

  if (kind === "conditioning") {
    return {
      id: makeId(),
      kind: "conditioning",
      title: "Conditioning",
      format: "AMRAP",
      timerMode: "timed",
      roundMinutes: 12,
      roundSeconds: 0,
      rounds: 1,
      restBetweenRoundsSeconds: 0,
      groupSize: 4,
      controlStationIndex: 0,
      stations: [emptyStation(0)],
    };
  }

  return {
    id: makeId(),
    kind,
    title: BLOCK_KIND_LABELS[kind],
    text: "",
  };
}

export function duplicateBlock(block: SessionBlock): SessionBlock {
  if (block.kind === "strength") {
    return {
      ...block,
      id: makeId(),
      stations: block.stations.map((station) => ({
        ...station,
        id: makeId(),
        movements: station.movements.map((movement) => ({ ...movement, id: makeId() })),
      })),
    };
  }

  if (block.kind === "conditioning") {
    return {
      ...block,
      id: makeId(),
      stations: block.stations.map((station) => ({
        ...station,
        id: makeId(),
        movements: station.movements.map((movement) => ({
          ...movement,
          id: makeId(),
        })),
      })),
    };
  }

  return { ...block, id: makeId() };
}

export function emptySessionPlan(): SessionPlan {
  return { wodName: "", blocks: [] };
}

/** Copy a plan with fresh ids, so reused sessions stay independent. */
export function clonePlan(plan: SessionPlan): SessionPlan {
  return {
    wodName: plan.wodName,
    blocks: plan.blocks.map(duplicateBlock),
  };
}

/* ------------------------------ timing ------------------------------ */

export function conditioningTiming(block: ConditioningBlock) {
  const roundDurationSeconds =
    clampInt(block.roundMinutes, 0, 180) * 60 + clampInt(block.roundSeconds, 0, 59);
  const rounds = clampInt(block.rounds, 1, 99);
  const rest = clampInt(block.restBetweenRoundsSeconds, 0, 600);
  const totalWorkSeconds = roundDurationSeconds * rounds;
  const totalSessionSeconds = totalWorkSeconds + rest * Math.max(0, rounds - 1);

  return { roundDurationSeconds, rounds, rest, totalWorkSeconds, totalSessionSeconds };
}

export function sessionTotalSeconds(plan: SessionPlan) {
  return plan.blocks.reduce((total, block) => {
    if (block.kind !== "conditioning" || block.timerMode !== "timed") return total;
    return total + conditioningTiming(block).totalSessionSeconds;
  }, 0);
}

/* ------------------------------ normalization (Firestore -> plan) ------------------------------ */

function str(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStations(raw: unknown): Station[] {
  if (!Array.isArray(raw) || !raw.length) return [emptyStation(0)];

  const stations = raw.map((s: any, index: number) => {
    const movementsRaw = Array.isArray(s?.movements) ? s.movements : [];
    const movements: StationMovement[] = movementsRaw.map((m: any) => ({
      id: str(m?.id) || makeId(),
      name: str(m?.name),
      target: str(m?.target),
    }));

    return {
      id: str(s?.id) || makeId(),
      title: str(s?.title) || `Station ${index + 1}`,
      movements: movements.length ? movements : [emptyStationMovement()],
    };
  });

  return stations.length ? stations : [emptyStation(0)];
}

/** Legacy flat rows ({movement, percent, repRange}) -> one station per row. */
function strengthStationsFromLegacyRows(raw: unknown): StrengthStation[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row: any, index: number) => ({
      movement: str(row?.movement),
      percent: str(row?.percent),
      repRange: str(row?.repRange),
      index,
    }))
    .filter((row) => row.movement || row.percent || row.repRange)
    .map((row, index) => ({
      id: makeId(),
      title: `Station ${index + 1}`,
      movements: [
        {
          id: makeId(),
          movement: row.movement,
          load: row.percent,
          sets: "",
          reps: row.repRange,
        },
      ],
    }));
}

function normalizeStrengthStations(rawStations: unknown, rawRows?: unknown): StrengthStation[] {
  if (Array.isArray(rawStations) && rawStations.length) {
    const stations = rawStations
      .map((s: any, index: number) => {
        const movementsRaw = Array.isArray(s?.movements) ? s.movements : [];
        const movements: StrengthMovement[] = movementsRaw
          .map((m: any) => ({
            id: str(m?.id) || makeId(),
            movement: str(m?.movement),
            load: str(m?.load),
            sets: str(m?.sets),
            reps: str(m?.reps),
          }))
          .filter(
            (m: StrengthMovement) => m.movement || m.load || m.sets || m.reps
          );

        return {
          id: str(s?.id) || makeId(),
          title: str(s?.title) || `Station ${index + 1}`,
          movements: movements.length ? movements : [emptyStrengthMovement()],
        };
      })
      .filter((station) => station.movements.length);

    if (stations.length) return stations;
  }

  const fromRows = strengthStationsFromLegacyRows(rawRows);
  return fromRows.length ? fromRows : [emptyStrengthStation(0)];
}

function normalizeConditioningFormat(raw: unknown): ConditioningFormat {
  const value = str(raw);
  return (CONDITIONING_FORMATS as string[]).includes(value)
    ? (value as ConditioningFormat)
    : "AMRAP";
}

function normalizeBlock(raw: any): SessionBlock | null {
  const kind = str(raw?.kind);

  if (kind === "strength") {
    return {
      id: str(raw?.id) || makeId(),
      kind: "strength",
      title: str(raw?.title) || "Strength",
      goal: str(raw?.goal),
      load: str(raw?.load),
      range: str(raw?.range),
      cue: str(raw?.cue),
      // `stations` is the current shape; `rows` covers blocks saved before
      // strength stations existed.
      stations: normalizeStrengthStations(raw?.stations, raw?.rows),
    };
  }

  if (kind === "conditioning") {
    const stations = normalizeStations(raw?.stations);
    return {
      id: str(raw?.id) || makeId(),
      kind: "conditioning",
      title: str(raw?.title) || "Conditioning",
      format: normalizeConditioningFormat(raw?.format),
      timerMode: raw?.timerMode === "stationControlled" ? "stationControlled" : "timed",
      roundMinutes: clampInt(toInt(raw?.roundMinutes, 0), 0, 180),
      roundSeconds: clampInt(toInt(raw?.roundSeconds, 0), 0, 59),
      rounds: clampInt(toInt(raw?.rounds, 1), 1, 99),
      restBetweenRoundsSeconds: clampInt(toInt(raw?.restBetweenRoundsSeconds, 0), 0, 600),
      groupSize: clampInt(toInt(raw?.groupSize, 4), 1, 50),
      controlStationIndex: clampInt(
        toInt(raw?.controlStationIndex, 0),
        0,
        Math.max(0, stations.length - 1)
      ),
      stations,
    };
  }

  if (kind === "warmup" || kind === "finisher" || kind === "cooldown" || kind === "notes") {
    return {
      id: str(raw?.id) || makeId(),
      kind,
      title: str(raw?.title) || BLOCK_KIND_LABELS[kind],
      text: String(raw?.text ?? ""),
    };
  }

  return null;
}

/** Convert a stored slot payload (v2 blocks or legacy flat fields) into a SessionPlan. */
export function normalizeSessionPlan(raw: any): SessionPlan {
  if (!raw || typeof raw !== "object") return emptySessionPlan();

  const wodName = str(raw.wodName);

  if (Array.isArray(raw.blocks) && raw.blocks.length) {
    const blocks = raw.blocks
      .map(normalizeBlock)
      .filter((b: SessionBlock | null): b is SessionBlock => b !== null);
    if (blocks.length) return { wodName, blocks };
  }

  // Legacy Strength session -> one strength block (one station per old row).
  if (raw.sessionType === "Strength") {
    return {
      wodName,
      blocks: [
        {
          id: makeId(),
          kind: "strength",
          title: "Strength",
          goal: str(raw.strengthGoal),
          load: str(raw.strengthLoad),
          range: str(raw.strengthRange),
          cue: str(raw.strengthCue),
          stations: normalizeStrengthStations(undefined, raw.strengthMovements),
        },
      ],
    };
  }

  // Legacy HYROX session -> one conditioning block.
  const hasLegacyConditioning =
    Array.isArray(raw.stations) ||
    Array.isArray(raw.movements) ||
    raw.sessionType === "HYROX";

  if (hasLegacyConditioning) {
    const stations = normalizeStations(
      Array.isArray(raw.stations) && raw.stations.length
        ? raw.stations
        : legacyMovementsToStations(raw.movements)
    );
    const storedRoundSeconds = toInt(raw.roundDurationSeconds, 0);

    return {
      wodName,
      blocks: [
        {
          id: makeId(),
          kind: "conditioning",
          title: "Conditioning",
          format: normalizeConditioningFormat(raw.wodType),
          timerMode: raw.timerMode === "stationControlled" ? "stationControlled" : "timed",
          roundMinutes: storedRoundSeconds ? Math.floor(storedRoundSeconds / 60) : 0,
          roundSeconds: storedRoundSeconds ? storedRoundSeconds % 60 : 0,
          rounds: clampInt(toInt(raw.rounds, 1), 1, 99),
          restBetweenRoundsSeconds: clampInt(toInt(raw.restBetweenRoundsSeconds, 0), 0, 600),
          groupSize: clampInt(toInt(raw.groupSize, 4), 1, 50),
          controlStationIndex: clampInt(
            toInt(raw.controlStationIndex, 0),
            0,
            Math.max(0, stations.length - 1)
          ),
          stations,
        },
      ],
    };
  }

  return { wodName, blocks: [] };
}

function legacyMovementsToStations(rawMovements: unknown) {
  if (!Array.isArray(rawMovements) || !rawMovements.length) return [];
  const names = rawMovements
    .map((m: any) =>
      typeof m === "string" ? m : str(m?.partner1 ?? m?.movement ?? m?.name)
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return [];
  return [
    {
      id: makeId(),
      title: "Station 1",
      movements: names.map((name) => ({ id: makeId(), name, target: "" })),
    },
  ];
}

/* ------------------------------ cleanup + projection (plan -> Firestore) ------------------------------ */

function cleanStations(stations: Station[]): Station[] {
  const cleaned = stations
    .map((station, index) => ({
      id: station.id,
      title: str(station.title) || `Station ${index + 1}`,
      movements: station.movements
        .map((movement) => ({
          id: movement.id,
          name: str(movement.name),
          target: str(movement.target),
        }))
        .filter((movement) => movement.name || movement.target),
    }))
    .filter((station) => station.movements.length > 0);

  return cleaned;
}

function cleanStrengthStations(stations: StrengthStation[]): StrengthStation[] {
  return stations
    .map((station, index) => ({
      id: station.id,
      title: str(station.title) || `Station ${index + 1}`,
      movements: station.movements
        .map((movement) => ({
          id: movement.id,
          movement: str(movement.movement),
          load: str(movement.load),
          sets: str(movement.sets),
          reps: str(movement.reps),
        }))
        .filter((movement) => movement.movement.length > 0),
    }))
    .filter((station) => station.movements.length > 0);
}

/** Flat legacy rows ({movement, percent, repRange}) from strength stations. */
function strengthStationsToLegacyRows(stations: StrengthStation[]) {
  return stations.flatMap((station) =>
    station.movements.map((movement) => ({
      movement: movement.movement,
      percent: movement.load,
      repRange: formatSetsReps(movement),
    }))
  );
}

/** Drop empty blocks and empty rows/stations before saving. */
export function cleanSessionPlan(plan: SessionPlan): SessionPlan {
  const blocks = plan.blocks
    .map((block): SessionBlock | null => {
      if (block.kind === "strength") {
        const stations = cleanStrengthStations(block.stations);
        const hasMeta = str(block.goal) || str(block.load) || str(block.range) || str(block.cue);
        if (!stations.length && !hasMeta) return null;
        return {
          ...block,
          title: str(block.title) || "Strength",
          goal: str(block.goal),
          load: str(block.load),
          range: str(block.range),
          cue: str(block.cue),
          stations,
        };
      }

      if (block.kind === "conditioning") {
        const stations = cleanStations(block.stations);
        if (!stations.length) return null;
        return {
          ...block,
          title: str(block.title) || "Conditioning",
          roundMinutes: clampInt(block.roundMinutes, 0, 180),
          roundSeconds: clampInt(block.roundSeconds, 0, 59),
          rounds: clampInt(block.rounds, 1, 99),
          restBetweenRoundsSeconds: clampInt(block.restBetweenRoundsSeconds, 0, 600),
          groupSize: clampInt(block.groupSize, 1, 50),
          controlStationIndex: clampInt(
            block.controlStationIndex,
            0,
            Math.max(0, stations.length - 1)
          ),
          stations,
        };
      }

      const text = block.text.trim();
      if (!text) return null;
      return { ...block, title: str(block.title) || BLOCK_KIND_LABELS[block.kind], text };
    })
    .filter((block): block is SessionBlock => block !== null);

  return { wodName: str(plan.wodName), blocks };
}

/**
 * Build the Firestore payload for one slot: the v2 `blocks` plus the legacy
 * projection consumed by WODDisplay, the dashboard, and the share cards.
 */
export function buildSessionPayload(rawPlan: SessionPlan): Record<string, unknown> {
  const plan = cleanSessionPlan(rawPlan);

  const conditioning = plan.blocks.find(
    (block): block is ConditioningBlock => block.kind === "conditioning"
  );
  const strength = plan.blocks.find(
    (block): block is StrengthBlock => block.kind === "strength"
  );

  const payload: Record<string, unknown> = {
    version: 2,
    wodName: plan.wodName,
    blocks: plan.blocks,
    createdAt: new Date(),
  };

  if (conditioning) {
    const timing = conditioningTiming(conditioning);
    Object.assign(payload, {
      sessionType: "HYROX",
      wodType: conditioning.format,
      groupSize: conditioning.groupSize,
      timerMode: conditioning.timerMode,
      roundDurationSeconds: timing.roundDurationSeconds,
      rounds: timing.rounds,
      restBetweenRoundsSeconds: timing.rest,
      totalWorkSeconds: timing.totalWorkSeconds,
      totalSessionSeconds: timing.totalSessionSeconds,
      controlStationIndex: conditioning.controlStationIndex,
      stations: conditioning.stations,
      movements: conditioning.stations.flatMap((station) =>
        station.movements.map((movement) => movement.name).filter(Boolean)
      ),
    });
  } else if (strength) {
    Object.assign(payload, {
      sessionType: "Strength",
      strengthMovements: strengthStationsToLegacyRows(strength.stations),
      strengthGoal: strength.goal,
      strengthLoad: strength.load,
      strengthRange: strength.range,
      strengthCue: strength.cue,
    });
  } else {
    // Text-only session; keep the display on the HYROX path with no stations.
    Object.assign(payload, { sessionType: "HYROX", stations: [], movements: [] });
  }

  // Strength details ride along even on hybrid sessions so nothing is lost.
  if (conditioning && strength) {
    Object.assign(payload, {
      strengthMovements: strengthStationsToLegacyRows(strength.stations),
      strengthGoal: strength.goal,
      strengthLoad: strength.load,
      strengthRange: strength.range,
      strengthCue: strength.cue,
    });
  }

  return payload;
}

/** True when there is nothing worth saving. */
export function sessionPlanIsEmpty(plan: SessionPlan) {
  const cleaned = cleanSessionPlan(plan);
  return !cleaned.wodName && cleaned.blocks.length === 0;
}

/* ------------------------------ slot summaries (week planner chips) ------------------------------ */

export type SlotSummary = {
  title: string;
  detail: string;
};

export function describeSlotPayload(raw: any): SlotSummary | null {
  if (!raw || typeof raw !== "object") return null;

  const plan = normalizeSessionPlan(raw);
  if (!plan.wodName && !plan.blocks.length) return null;

  const kinds = plan.blocks.map((block) => block.kind);
  const conditioning = plan.blocks.find(
    (block): block is ConditioningBlock => block.kind === "conditioning"
  );

  const typeLabel = conditioning
    ? conditioning.format
    : kinds.includes("strength")
    ? "Strength"
    : "Session";

  const parts = [typeLabel];
  if (plan.blocks.length > 1) parts.push(`${plan.blocks.length} blocks`);
  else if (conditioning && conditioning.timerMode === "timed") {
    const timing = conditioningTiming(conditioning);
    if (timing.totalSessionSeconds > 0) parts.push(formatSeconds(timing.totalSessionSeconds));
  }

  return {
    title: plan.wodName || typeLabel,
    detail: parts.join(" · "),
  };
}

/* ------------------------------ share lines ------------------------------ */

/**
 * Flatten a plan into "label • detail" lines for the session share card.
 * Matches the legacy line style so single-block sessions look unchanged.
 */
export function sessionShareItems(plan: SessionPlan): string[] {
  return plan.blocks.flatMap((block) => {
    if (block.kind === "strength") {
      return block.stations
        .map((station, index) => {
          const movements = station.movements.filter((m) => m.movement.trim());
          if (!movements.length) return "";

          // Single-movement station: keep the classic "Movement • load • reps" line.
          const title = station.title.trim();
          const isDefaultTitle = !title || /^station \d+$/i.test(title);
          if (movements.length === 1 && isDefaultTitle) {
            const m = movements[0];
            const details = [m.load.trim(), formatSetsReps(m)].filter(Boolean).join(" • ");
            return details ? `${m.movement.trim()} • ${details}` : m.movement.trim();
          }

          const movementDetails = movements.map((m) => {
            const detail = [m.load.trim(), formatSetsReps(m)].filter(Boolean).join(" · ");
            return detail ? `${m.movement.trim()}: ${detail}` : m.movement.trim();
          });
          return `${title || `Station ${index + 1}`} • ${movementDetails.join(" • ")}`;
        })
        .filter(Boolean);
    }

    if (block.kind === "conditioning") {
      return block.stations
        .map((station, index) => {
          const title = station.title.trim() || `Station ${index + 1}`;
          const movementDetails = station.movements
            .map((movement) => {
              const name = movement.name.trim();
              const target = movement.target.trim();
              if (name && target) return `${name}: ${target}`;
              return name || target;
            })
            .filter(Boolean);
          return movementDetails.length ? `${title} • ${movementDetails.join(" • ")}` : title;
        })
        .filter(Boolean);
    }

    const text = block.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" / ");
    if (!text) return [];
    return [`${block.title.trim() || BLOCK_KIND_LABELS[block.kind]} • ${text}`];
  });
}

/* ------------------------------ week/date helpers ------------------------------ */

/** Parse a YYYY-MM-DD key as UTC noon so day arithmetic ignores DST. */
export function dateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

export function keyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromDate(date);
}

/** Monday of the week containing dateKey. */
export function mondayOf(dateKey: string): string {
  const date = dateFromKey(dateKey);
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(dateKey, diff);
}

export function weekDays(weekStartKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStartKey, index));
}
