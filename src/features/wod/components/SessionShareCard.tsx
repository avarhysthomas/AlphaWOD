import React from "react";
import { BadgeCheck, Clock3, Moon, Sun } from "lucide-react";

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
  const perItemHeight = itemCount >= 6 ? 82 : 104;
  const detailHeight = items.reduce((total, item) => {
    const detailParts = item.split("•").map((part) => part.trim()).filter(Boolean).slice(1);
    const detailLength = detailParts.join(" • ").length;
    return total + Math.max(0, detailParts.length - 1) * 18 + Math.floor(detailLength / 70) * 18;
  }, 0);

  return 1000 + extraItems * perItemHeight + detailHeight + (coachNote ? 96 : 0);
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
    return <Sun className="h-4 w-4" />;
  }

  if (sessionLabel === "PM") {
    return <Moon className="h-4 w-4" />;
  }

  return <Clock3 className="h-4 w-4" />;
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

function BrandSocialHeader() {
  return (
    <div className="flex h-[58px] items-center justify-between bg-[#f4f4f4] px-4 text-[#050505]">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#050505] font-heading text-[12px] text-[#f4f4f4]">
          ZA
        </div>
        <div className="flex items-center gap-1.5 text-[14px] font-bold leading-none">
          zeroalphafitness
          <BadgeCheck className="h-4 w-4 fill-[#3f3f3f] text-[#f4f4f4]" />
        </div>
      </div>
      <div className="text-[20px] font-black leading-none">...</div>
    </div>
  );
}

function DetailPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/18 bg-[#101010] p-5">
      <div className="text-[11px] font-black uppercase leading-none text-white/42">
        {label}
      </div>
      <div className="mt-3 font-heading text-[34px] uppercase leading-[0.9] text-[#f4f4f4]">
        {value}
      </div>
    </div>
  );
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
      className="relative w-[720px] overflow-hidden rounded-[18px] bg-[#050505] shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
      style={{ minHeight: `${cardHeight}px` }}
    >
      <BrandSocialHeader />

      <div
        className="relative overflow-hidden bg-[#050505] text-white"
        style={{ minHeight: `${cardHeight - 58}px` }}
      >
        <div className="absolute inset-0 opacity-[0.1] [background-image:radial-gradient(circle_at_10%_20%,#f4f4f4_0_1px,transparent_1px),radial-gradient(circle_at_70%_60%,#f4f4f4_0_1px,transparent_1px)] [background-size:7px_7px,12px_12px]" />

        <div className="relative grid grid-cols-[1fr_170px] border-b border-white/18">
          <div className="px-7 py-7">
            <div className="flex items-center gap-3 text-[13px] font-black uppercase leading-none text-white/58">
              <span>{dateLabel}</span>
              <span className="h-px w-8 bg-white/32" />
              <span className="inline-flex items-center gap-2">
                <SessionIcon sessionLabel={sessionLabel} />
                {sessionTimeLabel || sessionLabel}
              </span>
            </div>
            <div className="mt-5 font-heading text-[76px] uppercase leading-[0.84] text-[#f4f4f4]">
              Today&apos;s
              <br />
              Session
            </div>
          </div>

          <div className="relative overflow-hidden border-l border-white/18 bg-[#d8d8d8]">
            <img
              src="/ZERO-ALPHA.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="absolute left-1/2 top-1/2 h-[190px] w-[280px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.42] grayscale"
            />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,0,0,0.72),rgba(0,0,0,0.05)_48%,rgba(0,0,0,0.76))]" />
          </div>
        </div>

        <div className="relative bg-[#f4f4f4] px-7 py-7 text-[#050505]">
          <h1 className="font-heading text-[88px] uppercase leading-[0.84]">
            {titleLines.map((line, index) => (
              <span key={`${line}-${index}`} className="block">
                {line}
              </span>
            ))}
          </h1>

          {subtitle ? (
            <div className="mt-3 text-[20px] font-black leading-tight">
              {subtitle}
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-3 border-y border-[#050505] text-[15px] font-black uppercase leading-tight">
            <div className="py-4 pr-4">{sessionType}</div>
            <div className="border-x border-[#050505] p-4">{sessionStyle}</div>
            <div className="py-4 pl-4">{sessionExtra || stationsLabel}</div>
          </div>
        </div>

        <div className="relative grid grid-cols-[1.25fr_0.85fr] gap-0 border-b border-white/18">
          <div className="border-r border-white/18 p-7">
            <div className="mb-5 text-[12px] font-black uppercase leading-none text-white/42">
              Session Snapshot
            </div>

            <div className={isCompact ? "space-y-3" : "space-y-4"}>
              {previewItems.length ? (
                previewItems.map((item, index) => {
                  const snapshot = splitSnapshotItem(item);

                  return (
                    <div
                      key={`${item}-${index}`}
                      className="grid grid-cols-[56px_1fr] border border-white/18 bg-[#101010]"
                    >
                      <div className="flex items-center justify-center border-r border-white/18 font-heading text-[24px] leading-none text-[#f4f4f4]">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className={isCompact ? "p-3.5" : "p-4"}>
                        <div className="text-[18px] font-black leading-tight text-white">
                          {snapshot.label}
                        </div>
                        {snapshot.detail ? (
                          <div className="mt-1.5 text-[14px] font-bold leading-snug text-white/58">
                            {snapshot.detail}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="border border-white/18 bg-[#101010] p-5 text-[16px] font-black text-white/58">
                  Programming coming soon
                </div>
              )}
            </div>
          </div>

          <div className="grid content-start gap-0 p-7">
            <DetailPanel label={highlightLabel} value={highlight} />
            <DetailPanel label="Format" value={stationsLabel} />
            <DetailPanel label="Class Slot" value={sessionTimeLabel || sessionLabel} />
          </div>
        </div>

        {coachNote ? (
          <div className="relative border-b border-white/18 px-7 py-5">
            <div className="text-[12px] font-black uppercase leading-none text-white/42">
              Coach Note
            </div>
            <div className="mt-3 text-[18px] font-bold leading-snug text-white/82">
              {coachNote}
            </div>
          </div>
        ) : null}

        <div className="relative flex items-end justify-between gap-5 bg-[#101010] px-7 py-5">
          <div>
            <div className="text-[12px] font-black uppercase leading-none text-white">
              Zero Alpha Fitness
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase leading-tight text-white/44">
              Built for the whiteboard and the work
            </div>
          </div>
          <div className="text-right text-[13px] font-black uppercase leading-none text-white">
            @zeroalphafitness
          </div>
        </div>
      </div>
    </div>
  );
}
