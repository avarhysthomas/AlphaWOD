import React, { useMemo } from "react";
import {
  BLOCK_KIND_LABELS,
  ConditioningBlock,
  SessionBlock,
  StrengthBlock,
  TextBlock,
  formatSetsReps,
} from "../../utils/programming";
import { stationDensity, stationGrid } from "../../utils/stationLayout";
import StationCard, { BoardStation } from "./StationCard";

/** A station whose title is just its position adds nothing next to the number. */
function meaningfulTitle(title: string, index: number) {
  const trimmed = title.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === `station ${index + 1}`) return "";
  return trimmed;
}

function conditioningStations(block: ConditioningBlock): BoardStation[] {
  const controlIndex =
    block.timerMode === "stationControlled" ? block.controlStationIndex : null;

  return block.stations.map((station, index) => ({
    id: station.id ?? `station-${index}`,
    title: meaningfulTitle(station.title, index),
    isControl: controlIndex != null && controlIndex === index,
    movements: station.movements
      .filter((movement) => movement.name.trim())
      .map((movement, movementIndex) => ({
        id: movement.id ?? `movement-${movementIndex}`,
        name: movement.name.trim(),
        detail: movement.target.trim(),
      })),
  }));
}

function strengthStations(block: StrengthBlock): BoardStation[] {
  return block.stations
    .filter((station) => station.movements.some((m) => m.movement.trim()))
    .map((station, index) => ({
      id: station.id ?? `station-${index}`,
      title: meaningfulTitle(station.title, index),
      isControl: false,
      movements: station.movements
        .filter((movement) => movement.movement.trim())
        .map((movement) => ({
          id: movement.id,
          name: movement.movement.trim(),
          detail: [movement.load.trim(), formatSetsReps(movement)]
            .filter(Boolean)
            .join(" · "),
        })),
    }));
}

function BoardHeading({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-[clamp(0.75rem,1.5vw,2.5rem)] border-b border-[var(--zaf-line-strong)] pb-[clamp(0.4rem,0.6vw,1.1rem)]">
      <h2 className="truncate font-heading uppercase leading-[0.9] text-[var(--zaf-text)] text-[clamp(1.25rem,2.1vw,4rem)]">
        {label}
      </h2>
      {detail && detail.toUpperCase() !== label.toUpperCase() ? (
        <span className="shrink-0 font-body text-[clamp(0.9rem,0.95vw,1.75rem)] font-bold uppercase leading-none tracking-[0.2em] text-[var(--zaf-text-dim)]">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Free-text blocks — warm-up, finisher, cooldown, notes — take the whole board,
 * with no live column beside them, so the type is scaled for the full width.
 *
 * The first three are sequences the floor works through, so each line is
 * numbered and rows share the height. Notes are prose (scaling options, things
 * the floor should know), so they are set as a paragraph: numbering a sentence
 * would read as a step it isn't. Lines wrap rather than truncate — the editor's
 * own warm-up default is long enough to clip on one line.
 */
function TextBoard({ block }: { block: TextBlock }) {
  const shell =
    "min-h-0 flex-1 overflow-hidden border border-[var(--zaf-line)] bg-[var(--zaf-panel)] p-[clamp(0.9rem,1.4vw,2.75rem)]";

  if (block.kind === "notes") {
    return (
      <div className={`grid place-items-center ${shell}`}>
        <p className="whitespace-pre-wrap font-body text-[clamp(1.1rem,1.9vw,3.6rem)] font-bold leading-snug text-[var(--zaf-text)] [overflow-wrap:anywhere]">
          {block.text.trim()}
        </p>
      </div>
    );
  }

  const lines = block.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);

  // A two-line warm-up should read bigger than a twelve-line one, or it just
  // floats in the middle of an empty board. A couple of short lines can carry
  // the whole screen at poster size; long ones have to stay small enough to fit
  // the row they wrap into.
  const [lineType, numberType] =
    lines.length <= 2 && longest <= 32
      ? ["text-[clamp(2.2rem,5vw,9.5rem)]", "text-[clamp(1.3rem,2vw,3.8rem)]"]
      : lines.length <= 4
      ? ["text-[clamp(1.8rem,3.4vw,6.5rem)]", "text-[clamp(1.1rem,1.6vw,3rem)]"]
      : lines.length <= 8
      ? ["text-[clamp(1.4rem,2.4vw,4.6rem)]", "text-[clamp(0.95rem,1.2vw,2.3rem)]"]
      : ["text-[clamp(1.1rem,1.7vw,3.2rem)]", "text-[clamp(0.85rem,1vw,1.9rem)]"];

  // One line is not a sequence: an "01" in front of it is decoration.
  const numbered = lines.length > 1;

  return (
    <div
      className={`grid gap-[clamp(0.35rem,0.6vw,1.1rem)] ${shell}`}
      style={{
        gridTemplateRows: `repeat(${Math.max(1, lines.length)}, minmax(0, 1fr))`,
      }}
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          className="flex min-w-0 items-center gap-[clamp(0.6rem,1vw,1.75rem)] overflow-hidden border-t border-[var(--zaf-line)] first:border-t-0"
        >
          {numbered ? (
            <span
              className={`shrink-0 font-heading leading-none text-[var(--zaf-accent)]/70 tabular-nums ${numberType}`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          ) : null}
          <span
            className={`min-w-0 font-heading uppercase leading-[1.05] text-[var(--zaf-text)] [overflow-wrap:anywhere] ${lineType}`}
          >
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoachNote({ note }: { note: string }) {
  return (
    <div className="shrink-0 border-l-2 border-[var(--zaf-accent)] bg-[var(--zaf-sunken)] px-[clamp(0.75rem,1.1vw,2rem)] py-[clamp(0.5rem,0.7vw,1.25rem)]">
      <div className="font-body text-[clamp(0.8rem,0.9vw,1.6rem)] font-black uppercase leading-none tracking-[0.24em] text-[var(--zaf-accent-soft)]">
        Coach note
      </div>
      <div className="mt-[0.4em] whitespace-pre-wrap font-body text-[clamp(0.9rem,1.05vw,2rem)] font-bold leading-snug text-[var(--zaf-text)]">
        {note}
      </div>
    </div>
  );
}

/**
 * The workout board. Stations stretch to fill the column — the grid rows are
 * equal fractions, so three stations are three full-height columns rather than
 * three shallow cards with dead space underneath.
 */
export default function SessionPlan({
  block,
  showStrengthCue,
}: {
  block: SessionBlock | null;
  showStrengthCue: boolean;
}) {
  const stations = useMemo<BoardStation[]>(() => {
    if (!block) return [];
    if (block.kind === "conditioning") return conditioningStations(block);
    if (block.kind === "strength") return strengthStations(block);
    return [];
  }, [block]);

  const grid = stationGrid(stations.length);
  const density = stationDensity(stations.length);

  const cue =
    block?.kind === "strength" && showStrengthCue ? block.cue.trim() : "";

  if (!block) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--zaf-gap)]">
        <BoardHeading label="Session plan" detail="Nothing programmed" />
        <div className="grid min-h-0 flex-1 place-items-center border border-[var(--zaf-line)] bg-[var(--zaf-panel)] font-body text-[clamp(0.9rem,1.05vw,2rem)] font-bold uppercase tracking-[0.2em] text-[var(--zaf-text-faint)]">
          Add blocks in the editor
        </div>
      </div>
    );
  }

  if (block.kind !== "conditioning" && block.kind !== "strength") {
    // The lines are right there and numbered, so a count adds nothing. The kind
    // only earns its place when the coach gave the block a name of its own —
    // otherwise BoardHeading would print "Warm-up" twice.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--zaf-gap)]">
        <BoardHeading
          label={block.title.trim() || BLOCK_KIND_LABELS[block.kind]}
          detail={BLOCK_KIND_LABELS[block.kind]}
        />
        <TextBoard block={block} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--zaf-gap)]">
      <BoardHeading
        label="Session plan"
        detail={`${stations.length} station${stations.length === 1 ? "" : "s"}`}
      />

      {stations.length ? (
        <div
          className="grid min-h-0 flex-1 gap-[var(--zaf-gap)]"
          style={{
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          }}
        >
          {stations.map((station, index) => (
            <StationCard
              key={station.id}
              index={index}
              station={station}
              density={density}
            />
          ))}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center border border-[var(--zaf-line)] bg-[var(--zaf-panel)] font-body text-[clamp(0.9rem,1.05vw,2rem)] font-bold uppercase tracking-[0.2em] text-[var(--zaf-text-faint)]">
          No stations in this block
        </div>
      )}

      {cue ? <CoachNote note={cue} /> : null}
    </div>
  );
}
