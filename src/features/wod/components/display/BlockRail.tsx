import React from "react";
import {
  BLOCK_KIND_LABELS,
  SessionBlock,
  conditioningTiming,
} from "../../utils/programming";
import { formatSeconds } from "./LiveTimerPanel";

function blockDetail(block: SessionBlock): string {
  if (block.kind === "conditioning") {
    if (block.timerMode !== "timed") return "Station control";

    const { roundDurationSeconds, rounds } = conditioningTiming(block);
    if (!roundDurationSeconds) return block.format;

    return rounds > 1
      ? `${formatSeconds(roundDurationSeconds)} x ${rounds}`
      : formatSeconds(roundDurationSeconds);
  }

  if (block.kind === "strength") {
    return `${block.stations.length} station${
      block.stations.length === 1 ? "" : "s"
    }`;
  }

  // The kind label is usually also the block's title — count the lines instead
  // of printing "Warm-up" twice in the same chip.
  const lines = block.text.split("\n").filter((line) => line.trim()).length;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

/** Whole-session overview strip: every block, with the one on screen lit up. */
export default function BlockRail({
  blocks,
  activeIndex,
  onSelect,
}: {
  blocks: SessionBlock[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav
      aria-label="Session blocks"
      className="flex shrink-0 flex-wrap gap-[clamp(0.25rem,0.4vw,0.75rem)]"
    >
      {blocks.map((block, index) => {
        const active = index === activeIndex;
        const title = block.title.trim() || BLOCK_KIND_LABELS[block.kind];
        const detail = blockDetail(block);
        // Belt and braces: never print the same words twice in one chip.
        const showDetail = detail.toUpperCase() !== title.toUpperCase();

        return (
          <button
            key={block.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-current={active ? "true" : undefined}
            className={[
              "flex items-center gap-[0.6em] border px-[clamp(0.5rem,0.7vw,1.25rem)] py-[clamp(0.3rem,0.4vw,0.75rem)] text-left transition-colors duration-200",
              active
                ? "border-[var(--zaf-active)] bg-[var(--zaf-active)] text-[#050505]"
                : "border-[var(--zaf-line)] bg-[var(--zaf-panel)] text-[var(--zaf-text-dim)] hover:text-[var(--zaf-text)]",
            ].join(" ")}
          >
            <span className="font-heading leading-none tabular-nums text-[clamp(0.9rem,1.05vw,1.9rem)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="leading-tight">
              <span className="block font-body text-[clamp(0.9rem,0.88vw,1.55rem)] font-black uppercase leading-none tracking-[0.14em]">
                {title}
              </span>
              {showDetail ? (
                <span
                  className={`mt-[0.35em] block font-body text-[clamp(0.85rem,0.82vw,1.45rem)] font-bold uppercase leading-none tracking-[0.12em] ${
                    active ? "text-[#050505]/60" : "text-[var(--zaf-text-faint)]"
                  }`}
                >
                  {detail}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
