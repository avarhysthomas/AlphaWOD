import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  SLOT_KEYS,
  SLOT_LABELS,
  SlotKey,
  SlotSummary,
  dateFromKey,
  weekDays,
} from "../utils/programming";

export type WeekSlotMap = Record<string, Partial<Record<SlotKey, SlotSummary | null>>>;

type WeekPlannerProps = {
  weekStartKey: string;
  todayKey: string;
  selectedDate: string;
  selectedSlot: SlotKey;
  summaries: WeekSlotMap;
  loading: boolean;
  onSelect: (dateKey: string, slot: SlotKey) => void;
  onShiftWeek: (deltaWeeks: number) => void;
  onGoToToday: () => void;
};

function formatWeekLabel(weekStartKey: string) {
  const start = dateFromKey(weekStartKey);
  const end = dateFromKey(weekStartKey);
  end.setUTCDate(end.getUTCDate() + 6);

  const startLabel = start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return `${startLabel} – ${endLabel}`;
}

function SlotButton({
  slot,
  summary,
  isSelected,
  loading,
  onSelect,
  size,
}: {
  slot: SlotKey;
  summary: SlotSummary | null | undefined;
  isSelected: boolean;
  loading: boolean;
  onSelect: () => void;
  size: "compact" | "roomy";
}) {
  const isFilled = Boolean(summary);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "block w-full rounded-[16px] border text-left transition",
        size === "roomy" ? "px-4 py-3.5" : "px-2.5 py-2.5",
        isSelected
          ? "border-white/30 bg-white/[0.12]"
          : isFilled
          ? "border-white/10 bg-black/18 hover:border-white/20"
          : "border-dashed border-white/10 bg-transparent hover:border-white/20",
      ].join(" ")}
    >
      <span
        className={[
          "block font-black uppercase tracking-[0.16em]",
          size === "roomy" ? "text-[10px]" : "text-[9px]",
          isSelected ? "text-white/60" : "text-white/30",
        ].join(" ")}
      >
        {SLOT_LABELS[slot]}
      </span>
      <span
        className={[
          "mt-1 block truncate font-bold leading-4",
          size === "roomy" ? "text-[15px]" : "text-[11px]",
          isFilled ? "text-white" : "text-white/24",
        ].join(" ")}
      >
        {loading && !isFilled ? "…" : summary ? summary.title : "Empty"}
      </span>
      {summary?.detail ? (
        <span
          className={[
            "mt-0.5 block truncate font-medium text-white/34",
            size === "roomy" ? "text-xs" : "text-[10px]",
          ].join(" ")}
        >
          {summary.detail}
        </span>
      ) : null}
    </button>
  );
}

export default function WeekPlanner({
  weekStartKey,
  todayKey,
  selectedDate,
  selectedSlot,
  summaries,
  loading,
  onSelect,
  onShiftWeek,
  onGoToToday,
}: WeekPlannerProps) {
  const days = useMemo(() => weekDays(weekStartKey), [weekStartKey]);
  const selectedDaySummaries = summaries[selectedDate] ?? {};

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
          Week planner
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onShiftWeek(-1)}
            aria-label="Previous week"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onGoToToday}
            className="rounded-xl px-3 py-2 text-[12px] font-bold uppercase tracking-[0.16em] text-white/64 transition hover:text-white"
          >
            {formatWeekLabel(weekStartKey)}
          </button>
          <button
            type="button"
            onClick={() => onShiftWeek(1)}
            aria-label="Next week"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/10 bg-[#151311] p-4 sm:p-5">
        {/* Phone: pick a day, then a slot. */}
        <div className="lg:hidden">
          <div className="grid grid-cols-7 gap-1">
            {days.map((dateKey) => {
              const date = dateFromKey(dateKey);
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const daySummaries = summaries[dateKey] ?? {};
              const filledCount = SLOT_KEYS.filter((slot) => daySummaries[slot]).length;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => onSelect(dateKey, selectedSlot)}
                  className={[
                    "rounded-[16px] py-2.5 transition",
                    isSelected ? "bg-[#f2eee8]" : "hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "block text-[10px] font-black uppercase tracking-[0.1em]",
                      isSelected
                        ? "text-black/55"
                        : isToday
                        ? "text-emerald-200"
                        : "text-white/34",
                    ].join(" ")}
                  >
                    {date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).slice(0, 1)}
                  </span>
                  <span
                    className={[
                      "mt-1 block text-[15px] font-bold",
                      isSelected ? "text-black" : "text-white/80",
                    ].join(" ")}
                  >
                    {date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" })}
                  </span>
                  <span className="mt-1.5 flex items-center justify-center gap-0.5">
                    {SLOT_KEYS.map((slot) => (
                      <span
                        key={slot}
                        className={[
                          "h-1 w-1 rounded-full",
                          daySummaries[slot]
                            ? isSelected
                              ? "bg-black/60"
                              : "bg-white/70"
                            : isSelected
                            ? "bg-black/18"
                            : "bg-white/14",
                        ].join(" ")}
                      />
                    ))}
                  </span>
                  <span className="sr-only">{filledCount} sessions programmed</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-2">
            {SLOT_KEYS.map((slot) => (
              <SlotButton
                key={slot}
                slot={slot}
                summary={selectedDaySummaries[slot]}
                isSelected={slot === selectedSlot}
                loading={loading}
                size="roomy"
                onSelect={() => onSelect(selectedDate, slot)}
              />
            ))}
          </div>
        </div>

        {/* Desktop: full week grid. */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-7 gap-2">
            {days.map((dateKey) => {
              const date = dateFromKey(dateKey);
              const isToday = dateKey === todayKey;
              const daySummaries = summaries[dateKey] ?? {};

              return (
                <div key={dateKey}>
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <span
                      className={[
                        "text-[10px] font-black uppercase tracking-[0.14em]",
                        isToday ? "text-emerald-200" : "text-white/34",
                      ].join(" ")}
                    >
                      {date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
                    </span>
                    <span className="text-[13px] font-bold text-white/64">
                      {date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" })}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {SLOT_KEYS.map((slot) => (
                      <SlotButton
                        key={slot}
                        slot={slot}
                        summary={daySummaries[slot]}
                        isSelected={dateKey === selectedDate && slot === selectedSlot}
                        loading={loading}
                        size="compact"
                        onSelect={() => onSelect(dateKey, slot)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
