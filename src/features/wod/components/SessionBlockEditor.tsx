import React from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Dumbbell,
  Flame,
  NotebookPen,
  Plus,
  Snowflake,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  BLOCK_KIND_LABELS,
  CONDITIONING_FORMATS,
  BlockKind,
  ConditioningBlock,
  SessionBlock,
  Station,
  StrengthBlock,
  TextBlock,
  StrengthStation,
  clampInt,
  conditioningTiming,
  emptyStation,
  emptyStationMovement,
  emptyStrengthMovement,
  emptyStrengthStation,
  formatSeconds,
  toInt,
} from "../utils/programming";

const inputClass =
  "w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-3.5 text-[15px] text-white outline-none transition placeholder:text-white/20 focus:border-white/22";

const numberInputClass = `${inputClass} text-center font-mono text-lg font-bold`;

const labelClass =
  "mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-white/34";

const iconButtonClass =
  "grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-25";

const ghostButtonClass =
  "inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold text-white/55 transition hover:border-white/20 hover:text-white";

const chipButtonClass = (active: boolean) =>
  [
    "rounded-full border px-3.5 py-2 text-sm font-bold transition",
    active
      ? "border-white/20 bg-white/[0.10] text-white"
      : "border-white/10 bg-transparent text-white/36 hover:text-white/70",
  ].join(" ");

/**
 * A number field you can actually empty.
 *
 * Committing `event.target.value` straight to state means clearing the box
 * writes the clamped minimum back into it — on a phone you can never delete the
 * "1" in Rounds to type something else. The keystrokes live in a local draft
 * instead: the saved value only moves when the draft parses to a number, and
 * the draft is dropped on blur so the field settles on the clamped value.
 */
function NumberField({
  label,
  value,
  onValue,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onValue: (next: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  // Wrapping the input labels it without an id, so tapping the caption focuses
  // the field — worth having on a phone, where these boxes are small.
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode="numeric"
          value={draft ?? String(value)}
          min={min}
          max={max}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);

            if (!raw.trim()) return;
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) return;
            onValue(clampInt(Math.trunc(parsed), min, max));
          }}
          onBlur={() => setDraft(null)}
          className={`${numberInputClass} ${suffix ? "pr-10" : ""}`}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-[0.16em] text-white/26">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export const BLOCK_KIND_ICONS: Record<BlockKind, React.ComponentType<{ className?: string }>> = {
  warmup: Sparkles,
  strength: Dumbbell,
  conditioning: Flame,
  finisher: Zap,
  cooldown: Snowflake,
  notes: NotebookPen,
};

type BlockShellProps = {
  block: SessionBlock;
  index: number;
  total: number;
  onChange: (next: SessionBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  children: React.ReactNode;
};

function BlockShell({ block, index, total, onChange, onMove, onDuplicate, onRemove, children }: BlockShellProps) {
  const Icon = BLOCK_KIND_ICONS[block.kind];

  return (
    <div className="rounded-[24px] border border-white/10 bg-[#151311] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em] text-white/42">
          <Icon className="h-4 w-4" />
          {BLOCK_KIND_LABELS[block.kind]}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move block up" className={iconButtonClass}>
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move block down" className={iconButtonClass}>
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDuplicate} aria-label="Duplicate block" className={iconButtonClass}>
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove block"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-200"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <input
        value={block.title}
        onChange={(event) => onChange({ ...block, title: event.target.value })}
        placeholder={BLOCK_KIND_LABELS[block.kind]}
        aria-label="Block title"
        className="mt-5 w-full rounded-[14px] border border-transparent bg-transparent px-1 py-1 font-heading text-[1.9rem] uppercase leading-none tracking-[0.02em] text-white outline-none transition placeholder:text-white/18 focus:border-white/12 focus:bg-black/25 sm:text-[2.2rem]"
      />

      <div className="mt-6">{children}</div>
    </div>
  );
}

/* ------------------------------ text blocks ------------------------------ */

const TEXT_BLOCK_PLACEHOLDERS: Record<TextBlock["kind"], string> = {
  warmup: "3 min easy row\n2 rounds: 10 air squats, 10 banded pull-aparts, world's greatest stretch",
  finisher: "100 flutter kicks\n60s plank hold",
  cooldown: "3 min easy spin\nCouch stretch 60s each side",
  notes: "Coaching notes, scaling options, or anything the floor needs to know.",
};

function TextBlockEditor({ block, onChange }: { block: TextBlock; onChange: (next: SessionBlock) => void }) {
  return (
    <textarea
      value={block.text}
      onChange={(event) => onChange({ ...block, text: event.target.value })}
      rows={4}
      placeholder={TEXT_BLOCK_PLACEHOLDERS[block.kind]}
      className={`${inputClass} resize-y leading-6`}
    />
  );
}

/* ------------------------------ strength block ------------------------------ */

function StrengthBlockEditor({ block, onChange }: { block: StrengthBlock; onChange: (next: SessionBlock) => void }) {
  const updateStation = (stationId: string, patch: Partial<StrengthStation>) => {
    onChange({
      ...block,
      stations: block.stations.map((station) =>
        station.id === stationId ? { ...station, ...patch } : station
      ),
    });
  };

  const addMovement = (stationId: string) => {
    const station = block.stations.find((s) => s.id === stationId);
    if (!station) return;
    updateStation(stationId, { movements: [...station.movements, emptyStrengthMovement()] });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={labelClass}>Goal</label>
          <input
            value={block.goal}
            onChange={(event) => onChange({ ...block, goal: event.target.value })}
            placeholder="Quality reps"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Load</label>
          <input
            value={block.load}
            onChange={(event) => onChange({ ...block, load: event.target.value })}
            placeholder="% of 1RM"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Range</label>
          <input
            value={block.range}
            onChange={(event) => onChange({ ...block, range: event.target.value })}
            placeholder="Hit target reps"
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-3">
        {block.stations.map((station, stationIndex) => (
          <div key={station.id} className="rounded-[20px] border border-white/10 bg-black/18 p-4">
            <div className="flex items-center gap-2">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] font-mono text-sm font-bold text-white/52">
                {String(stationIndex + 1).padStart(2, "0")}
              </span>
              <input
                value={station.title}
                onChange={(event) => updateStation(station.id, { title: event.target.value })}
                placeholder={`Station ${stationIndex + 1}`}
                className={inputClass}
              />
              <button
                type="button"
                aria-label="Remove station"
                onClick={() =>
                  onChange({
                    ...block,
                    stations: block.stations.filter((s) => s.id !== station.id),
                  })
                }
                disabled={block.stations.length <= 1}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 transition hover:border-red-400/30 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-25"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.55fr)_minmax(0,0.55fr)_36px] gap-2 px-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/30">
                <span>Movement</span>
                <span>Load</span>
                <span>Sets</span>
                <span>Reps</span>
                <span />
              </div>

              {station.movements.map((movement) => (
                <div
                  key={movement.id}
                  className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.55fr)_minmax(0,0.55fr)_36px] gap-2"
                >
                  <input
                    value={movement.movement}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, movement: event.target.value } : m
                        ),
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addMovement(station.id);
                      }
                    }}
                    placeholder="Back Squat"
                    className={inputClass}
                  />
                  <input
                    value={movement.load}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, load: event.target.value } : m
                        ),
                      })
                    }
                    placeholder="75%"
                    className={inputClass}
                  />
                  <input
                    value={movement.sets}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, sets: event.target.value } : m
                        ),
                      })
                    }
                    placeholder="4"
                    className={`${inputClass} text-center font-mono font-bold`}
                  />
                  <input
                    value={movement.reps}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, reps: event.target.value } : m
                        ),
                      })
                    }
                    placeholder="8"
                    className={`${inputClass} text-center font-mono font-bold`}
                  />
                  <button
                    type="button"
                    aria-label="Remove movement"
                    onClick={() =>
                      updateStation(station.id, {
                        movements: station.movements.filter((m) => m.id !== movement.id),
                      })
                    }
                    disabled={station.movements.length <= 1}
                    className="grid place-items-center self-center rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-white/50 transition hover:border-red-400/30 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addMovement(station.id)}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-xs font-bold text-white/45 transition hover:border-white/20 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add movement
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            onChange({
              ...block,
              stations: [...block.stations, emptyStrengthStation(block.stations.length)],
            })
          }
          className={ghostButtonClass}
        >
          <Plus className="h-4 w-4" />
          Add station
        </button>
      </div>

      <div>
        <label className={labelClass}>Coaching cue</label>
        <textarea
          value={block.cue}
          onChange={(event) => onChange({ ...block, cue: event.target.value })}
          rows={2}
          placeholder="Brace hard, control the descent."
          className={`${inputClass} resize-none`}
        />
      </div>
    </div>
  );
}

/* ------------------------------ conditioning block ------------------------------ */

function ConditioningBlockEditor({
  block,
  onChange,
}: {
  block: ConditioningBlock;
  onChange: (next: SessionBlock) => void;
}) {
  const timing = conditioningTiming(block);

  const updateStation = (stationId: string, patch: Partial<Station>) => {
    onChange({
      ...block,
      stations: block.stations.map((station) =>
        station.id === stationId ? { ...station, ...patch } : station
      ),
    });
  };

  const addMovement = (stationId: string) => {
    const station = block.stations.find((s) => s.id === stationId);
    if (!station) return;
    updateStation(stationId, { movements: [...station.movements, emptyStationMovement()] });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className={labelClass}>Format</label>
        <div className="flex flex-wrap gap-2">
          {CONDITIONING_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => onChange({ ...block, format })}
              className={chipButtonClass(block.format === format)}
            >
              {format}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Timer</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...block, timerMode: "timed" })}
            className={chipButtonClass(block.timerMode === "timed")}
          >
            Timed rounds
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...block, timerMode: "stationControlled" })}
            className={chipButtonClass(block.timerMode === "stationControlled")}
          >
            Station controlled
          </button>
        </div>
      </div>

      {block.timerMode === "timed" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <NumberField
            label="Minutes"
            value={block.roundMinutes}
            onValue={(n) => onChange({ ...block, roundMinutes: n })}
            min={0}
            max={180}
          />
          <NumberField
            label="Seconds"
            value={block.roundSeconds}
            onValue={(n) => onChange({ ...block, roundSeconds: n })}
            min={0}
            max={59}
          />
          <NumberField
            label="Rounds"
            value={block.rounds}
            onValue={(n) => onChange({ ...block, rounds: n })}
            min={1}
            max={99}
          />
          <NumberField
            label="Rest"
            value={block.restBetweenRoundsSeconds}
            onValue={(n) => onChange({ ...block, restBetweenRoundsSeconds: n })}
            min={0}
            max={600}
            suffix="sec"
          />
          <NumberField
            label="Group"
            value={block.groupSize}
            onValue={(n) => onChange({ ...block, groupSize: n })}
            min={1}
            max={50}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Control station</label>
            <select
              value={block.controlStationIndex}
              onChange={(event) =>
                onChange({
                  ...block,
                  controlStationIndex: clampInt(
                    toInt(event.target.value, 0),
                    0,
                    Math.max(0, block.stations.length - 1)
                  ),
                })
              }
              className={inputClass}
            >
              {block.stations.map((station, index) => (
                <option key={station.id} value={index}>
                  {index + 1}. {station.title.trim() || `Station ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            label="Group"
            value={block.groupSize}
            onValue={(n) => onChange({ ...block, groupSize: n })}
            min={1}
            max={50}
          />
        </div>
      )}

      {block.timerMode === "timed" && timing.totalSessionSeconds > 0 ? (
        <div className="inline-flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/18 px-4 py-3">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
            Block time
          </span>
          <span className="font-mono text-xl font-bold text-white">
            {formatSeconds(timing.totalSessionSeconds)}
          </span>
          {timing.rest > 0 ? (
            <span className="text-xs font-medium text-white/38">
              work {formatSeconds(timing.totalWorkSeconds)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {block.stations.map((station, stationIndex) => (
          <div key={station.id} className="rounded-[20px] border border-white/10 bg-black/18 p-4">
            <div className="flex items-center gap-2">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] font-mono text-sm font-bold text-white/52">
                {String(stationIndex + 1).padStart(2, "0")}
              </span>
              <input
                value={station.title}
                onChange={(event) => updateStation(station.id, { title: event.target.value })}
                placeholder={`Station ${stationIndex + 1}`}
                className={inputClass}
              />
              <button
                type="button"
                aria-label="Remove station"
                onClick={() =>
                  onChange({
                    ...block,
                    stations: block.stations.filter((s) => s.id !== station.id),
                    controlStationIndex: clampInt(
                      block.controlStationIndex,
                      0,
                      Math.max(0, block.stations.length - 2)
                    ),
                  })
                }
                disabled={block.stations.length <= 1}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 transition hover:border-red-400/30 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-25"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {station.movements.map((movement, movementIndex) => (
                <div key={movement.id} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_36px] gap-2">
                  <input
                    value={movement.name}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, name: event.target.value } : m
                        ),
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addMovement(station.id);
                      }
                    }}
                    placeholder={`Movement ${movementIndex + 1}`}
                    className={inputClass}
                  />
                  <input
                    value={movement.target}
                    onChange={(event) =>
                      updateStation(station.id, {
                        movements: station.movements.map((m) =>
                          m.id === movement.id ? { ...m, target: event.target.value } : m
                        ),
                      })
                    }
                    placeholder="12 cals / 10 reps"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    aria-label="Remove movement"
                    onClick={() =>
                      updateStation(station.id, {
                        movements: station.movements.filter((m) => m.id !== movement.id),
                      })
                    }
                    disabled={station.movements.length <= 1}
                    className="grid place-items-center self-center rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-white/50 transition hover:border-red-400/30 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addMovement(station.id)}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-xs font-bold text-white/45 transition hover:border-white/20 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add movement
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            onChange({ ...block, stations: [...block.stations, emptyStation(block.stations.length)] })
          }
          className={ghostButtonClass}
        >
          <Plus className="h-4 w-4" />
          Add station
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ dispatcher ------------------------------ */

export default function SessionBlockEditor(props: Omit<BlockShellProps, "children">) {
  const { block, onChange } = props;

  return (
    <BlockShell {...props}>
      {block.kind === "strength" ? (
        <StrengthBlockEditor block={block} onChange={onChange} />
      ) : block.kind === "conditioning" ? (
        <ConditioningBlockEditor block={block} onChange={onChange} />
      ) : (
        <TextBlockEditor block={block} onChange={onChange} />
      )}
    </BlockShell>
  );
}
