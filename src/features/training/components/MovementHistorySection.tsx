import React from "react";
import { Newspaper, Share, Trash2 } from "lucide-react";
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
  postingLogId?: string | null;
  isTimeDisplay: (unit?: string, movementName?: string) => boolean;
  formatDisplayValue: (value: string, unit?: string, movementName?: string) => string;
  prettyDate: (date: string) => string;
  onShareLog: (log: TrainingLog) => void;
  onPostToFeed: (log: TrainingLog) => void;
  onDeleteLog: (logId: string) => void;
};

export default function MovementHistorySection({
  accent: _accent,
  movementName,
  activeMetricFilter,
  filteredLogs,
  bestLogId,
  deletingLogId,
  postingLogId,
  isTimeDisplay,
  formatDisplayValue,
  prettyDate,
  onShareLog,
  onPostToFeed,
  onDeleteLog,
}: MovementHistorySectionProps) {
  return (
    <section className="mt-2">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.32em] text-white/82">
          History
        </h2>
        <span className="text-sm font-bold text-white/40">
          {filteredLogs.length} {activeMetricFilter || "logs"}
        </span>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        {filteredLogs.length === 0 ? (
          <div className="p-6 text-sm font-medium text-white/44">
            No logs yet for {movementName}.
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const isBest = bestLogId === log.id;
            const isDeleting = deletingLogId === log.id;
            const isPosting = postingLogId === log.id;

            return (
              <div
                key={log.id}
                className="group relative border-b border-white/10 px-5 py-4 last:border-b-0 transition hover:bg-white/[0.025]"
              >
                <div className="grid grid-cols-[1fr_auto] gap-4">
                  <div className="min-w-0 pt-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-lg font-extrabold tracking-[-0.02em] text-white">
                        {log.metricType}
                      </h3>
                      {isBest ? (
                        <span className="shrink-0 rounded-md bg-[#f2eee8] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                          PR
                        </span>
                      ) : null}
                      {index === 0 ? (
                        <span className="shrink-0 rounded-md bg-white/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/58">
                          Latest
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-white/38">
                      <span>{prettyDate(log.date)}</span>
                      {log.reps ? (
                        <>
                          <span className="text-white/18">·</span>
                          <span>{log.reps} reps</span>
                        </>
                      ) : null}
                    </div>

                    {log.notes ? (
                      <p className="mt-2 line-clamp-2 max-w-lg text-sm font-medium leading-5 text-white/55">
                        {log.notes}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-3">
                    <div className="text-right">
                      <div className="font-mono text-3xl font-bold leading-none text-white">
                        {isTimeDisplay(log.unit, movementName) ? (
                          formatDisplayValue(log.value, log.unit, movementName)
                        ) : (
                          <>
                            {log.value}
                            {log.unit ? (
                              <span className="ml-1 text-sm font-bold uppercase tracking-[0.12em] text-white/38">
                                {log.unit}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                      <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/32">
                        {isDeleting ? "Deleting" : isPosting ? "Posting" : activeMetricFilter || log.metricType}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onShareLog(log)}
                        disabled={isDeleting || isPosting}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Share entry"
                      >
                        <Share className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onPostToFeed(log)}
                        disabled={isDeleting || isPosting}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Post to feed"
                      >
                        <Newspaper className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteLog(log.id)}
                        disabled={isDeleting || isPosting}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/30 transition hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
