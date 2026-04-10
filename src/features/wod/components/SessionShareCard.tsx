import React from "react";
import { Clock3, Moon, Sparkles, Sun } from "lucide-react";

type SessionShareCardProps = {
  dateLabel: string;
  sessionLabel: string;
  sessionTimeLabel?: string;
  sessionType: string;
  sessionStyle: string;
  sessionExtra?: string;
  title: string;
  subtitle?: string;
  highlight: string;
  highlightLabel: string;
  stationsLabel: string;
  coachNote?: string;
  items: string[];
};

export function getSessionShareCardHeight(items: string[], coachNote?: string) {
  const itemCount = items.filter(Boolean).length;
  const extraItems = Math.max(0, itemCount - 4);
  const perItemHeight = itemCount >= 6 ? 92 : 118;
  return 960 + extraItems * perItemHeight + (coachNote ? 120 : 0);
}

function splitTitle(input: string) {
  const words = input.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 2) {
    return [input];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [
    words.slice(0, midpoint).join(" "),
    words.slice(midpoint).join(" "),
  ];
}

function SessionIcon({ sessionLabel }: { sessionLabel: string }) {
  if (sessionLabel === "AM") {
    return <Sun className="h-4 w-4 text-amber-200" />;
  }

  if (sessionLabel === "PM") {
    return <Moon className="h-4 w-4 text-sky-200" />;
  }

  return <Clock3 className="h-4 w-4 text-white" />;
}

function splitSnapshotItem(item: string) {
  const parts = item.split("•").map((part) => part.trim()).filter(Boolean);

  if (parts.length <= 1) {
    return { label: item, detail: "" };
  }

  return {
    label: parts[0],
    detail: parts.slice(1).join(" • "),
  };
}

export default function SessionShareCard({
  dateLabel,
  sessionLabel,
  sessionTimeLabel,
  sessionType,
  sessionStyle,
  sessionExtra,
  title,
  subtitle,
  highlight,
  highlightLabel,
  stationsLabel,
  coachNote,
  items,
}: SessionShareCardProps) {
  const titleLines = splitTitle(title);
  const previewItems = items.filter(Boolean);
  const isCompact = previewItems.length >= 6;
  const cardHeight = getSessionShareCardHeight(previewItems, coachNote);

  return (
    <div
      className="relative w-[720px] overflow-hidden rounded-[40px] border border-white/12 p-10 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      style={{
        minHeight: `${cardHeight}px`,
        background:
          "linear-gradient(180deg, rgba(14,14,16,0.9), rgba(6,6,8,0.9))",
      }}
    >
      <div className="absolute inset-0 rounded-[40px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24%),radial-gradient(circle_at_top_right,rgba(250,204,21,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.10),transparent_32%)]" />

      <img
        src="/ZERO-ALPHA.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-export-skip="true"
        className="pointer-events-none absolute left-1/2 top-[58%] h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.2]"
      />

      <div className="relative">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2">
          <Sparkles className="h-4 w-4 text-white" />
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.2em] text-white/72">
            Session Drop
          </span>
        </div>

        <div className="mt-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
          <span>{dateLabel}</span>
          <span className="text-white/20">|</span>
          <span className="inline-flex items-center gap-2">
            <SessionIcon sessionLabel={sessionLabel} />
            {sessionTimeLabel || sessionLabel}
          </span>
        </div>

        <h1 className="mt-4 text-[64px] font-black uppercase leading-[0.9] tracking-[-0.055em] text-white">
          {titleLines.map((line, index) => (
            <span key={`${line}-${index}`} className="block">
              {line}
            </span>
          ))}
        </h1>

        {subtitle ? (
          <div className="mt-3 max-w-[520px] text-[18px] font-medium text-white/72">
            {subtitle}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.2em] text-amber-100">
            {sessionType}
          </div>
          <div className="inline-flex items-center rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.2em] text-sky-100">
            {sessionStyle}
          </div>
          {sessionExtra ? (
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.18em] text-white/72">
              {sessionExtra}
            </div>
          ) : null}
        </div>

        <div className="mt-8 grid grid-cols-[1.35fr_0.9fr] gap-5">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Session Snapshot
            </div>
            <div className={`mt-4 ${isCompact ? "space-y-2.5" : "space-y-3"}`}>
              {previewItems.length ? (
                previewItems.map((item, index) => {
                  const snapshot = splitSnapshotItem(item);

                  return (
                    <div
                      key={`${item}-${index}`}
                      className={`group relative overflow-hidden border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${isCompact ? "rounded-[20px] px-3.5 py-3" : "rounded-[24px] px-4 py-4"}`}
                    >
                      <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-amber-300/90 via-white/70 to-sky-300/90" />

                      <div className={`flex items-start ${isCompact ? "gap-3" : "gap-4"}`}>
                        <div
                          className={`flex shrink-0 items-center justify-center border border-white/12 bg-black/25 font-black tracking-[0.18em] text-white/76 ${isCompact ? "h-9 w-9 rounded-[16px] text-[11px]" : "h-11 w-11 rounded-2xl text-[13px]"}`}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div
                            className={`font-semibold uppercase tracking-[0.22em] text-white/35 ${isCompact ? "text-[10px]" : "text-[11px]"}`}
                          >
                            Station
                          </div>
                          <div
                            className={`mt-1 font-bold leading-tight text-white ${isCompact ? "text-[16px]" : "text-[18px]"}`}
                          >
                            {snapshot.label}
                          </div>
                          {snapshot.detail ? (
                            <div
                              className={`text-white/60 ${isCompact ? "mt-1.5 text-[12px] leading-[1.45]" : "mt-2 text-[14px] leading-relaxed"}`}
                            >
                              {snapshot.detail}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-white/8 bg-black/20 px-4 py-4 text-[16px] font-semibold text-white/50">
                  Programming coming soon
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-amber-300/16 bg-amber-300/[0.08] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                {highlightLabel}
              </div>
              <div className="mt-2 text-[42px] font-black leading-none tracking-[-0.05em] text-white">
                {highlight}
              </div>
            </div>

            <div className="rounded-[28px] border border-sky-300/16 bg-sky-300/[0.08] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                Format
              </div>
              <div className="mt-2 text-[22px] font-bold leading-tight text-white">
                {stationsLabel}
              </div>
            </div>
          </div>
        </div>

        {coachNote ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Coach Note
            </div>
            <div className="mt-2 text-[16px] leading-relaxed text-white/76">
              {coachNote}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
