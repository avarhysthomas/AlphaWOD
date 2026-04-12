import React from "react";
import { Share, TimerReset, Trash2 } from "lucide-react";
import type { AccentClasses } from "../utils/movementHelpers";

type TrainingLog = {
  id: string;
  metricType: string;
  value: string;
  unit: string;
  reps?: string;
  date: string;
  notes: string;
};

type MovementHistorySectionProps = {
  accent: AccentClasses;
  movementName: string;
  activeMetricFilter: string;
  filteredLogs: TrainingLog[];
  bestLogId?: string | null;
  deletingLogId?: string | null;
  isTimeDisplay: (unit?: string, movementName?: string) => boolean;
  formatDisplayValue: (value: string, unit?: string, movementName?: string) => string;
  prettyDate: (date: string) => string;
  onShareLog: (log: TrainingLog) => void;
  onDeleteLog: (logId: string) => void;
};

export default function MovementHistorySection({
  accent,
  movementName,
  activeMetricFilter,
  filteredLogs,
  bestLogId,
  deletingLogId,
  isTimeDisplay,
  formatDisplayValue,
  prettyDate,
  onShareLog,
  onDeleteLog,
}: MovementHistorySectionProps) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,22,0.98),rgba(10,10,12,0.98))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-6">
      <div className={`absolute inset-0 ${accent.glow}`} />
      <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

      <div className="relative mb-7 flex items-center justify-between gap-4">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
            <TimerReset className="h-3.5 w-3.5" />
            History
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
            {activeMetricFilter ? `${movementName} · ${activeMetricFilter}` : `${movementName} History`}
          </h2>
          <p className="mt-3 text-sm leading-7 text-white/58">
            {activeMetricFilter
              ? `Your latest ${activeMetricFilter} entries for this movement.`
              : "Your latest entries for this movement."}
          </p>
        </div>
      </div>

      <div className="relative space-y-3">
        {filteredLogs.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-black/30 p-6 text-sm text-white/50">
            No logs yet for {movementName}.
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const isBest = bestLogId === log.id;
            const isDeleting = deletingLogId === log.id;

            return (
              <div
                key={log.id}
                className="group relative overflow-hidden rounded-[22px] border border-white/10 bg-black/35 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-black/45"
              >
                <div
                  className={`absolute inset-0 ${
                    isBest
                      ? accent.softGlow
                      : "bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_24%)]"
                  } opacity-70`}
                />

                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">{log.metricType}</div>

                      {isBest ? (
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${accent.badgeGlow}`}
                        >
                          PB
                        </span>
                      ) : null}

                      {index === 0 ? (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                          Latest
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 text-sm text-white/56">
                      {log.reps ? `${log.reps} reps` : "Logged entry"}
                    </div>

                    {log.notes ? (
                      <p className="mt-3 max-w-xl text-sm leading-6 text-white/64">{log.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2 text-left sm:text-right">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onShareLog(log)}
                        disabled={isDeleting}
                        className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Share entry"
                      >
                        <Share className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteLog(log.id)}
                        disabled={isDeleting}
                        className="rounded-full border border-red-500/20 bg-red-500/10 p-2 text-red-200 transition hover:border-red-400/35 hover:bg-red-500/15 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="text-2xl font-semibold tracking-[-0.03em] text-white">
                      {isTimeDisplay(log.unit, movementName) ? (
                        formatDisplayValue(log.value, log.unit, movementName)
                      ) : (
                        <>
                          {log.value} <span className="text-sm font-medium text-white/52">{log.unit}</span>
                        </>
                      )}
                    </div>

                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/38">
                      {isDeleting ? "Deleting..." : prettyDate(log.date)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
