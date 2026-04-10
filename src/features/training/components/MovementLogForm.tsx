import React from "react";
import { CheckCircle2, Plus, Share, Sparkles } from "lucide-react";
import type { AccentClasses, FormFieldErrors, SmartFormConfig } from "../utils/movementHelpers";

type MovementLogFormProps = {
  movementName: string;
  metricTypes: string[];
  unitOptions: string[];
  metricType: string;
  setMetricType: (value: string) => void;
  unit: string;
  setUnit: (value: string) => void;
  effectiveUnit: string;
  value: string;
  setValue: (value: string) => void;
  reps: string;
  setReps: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  formConfig: SmartFormConfig;
  formErrors: FormFieldErrors;
  clearFieldError: (field: keyof FormFieldErrors) => void;
  handleSubmit: (event: React.FormEvent) => void;
  isSaving: boolean;
  saved: boolean;
  isNewPB: boolean;
  hasSharePayload: boolean;
  onShare: () => void;
  saveError: string;
  loadError: string;
  accent: AccentClasses;
};

export default function MovementLogForm({
  movementName,
  metricTypes,
  unitOptions,
  metricType,
  setMetricType,
  unit,
  setUnit,
  effectiveUnit,
  value,
  setValue,
  reps,
  setReps,
  date,
  setDate,
  notes,
  setNotes,
  formConfig,
  formErrors,
  clearFieldError,
  handleSubmit,
  isSaving,
  saved,
  isNewPB,
  hasSharePayload,
  onShare,
  saveError,
  loadError,
  accent,
}: MovementLogFormProps) {
  const inputClass =
    "w-full rounded-[20px] border bg-black/85 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:bg-neutral-950";

  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,22,0.98),rgba(10,10,12,0.98))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-6">
      <div className={`absolute inset-0 ${accent.softGlow}`} />
      <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

      <div className="relative mb-7 flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
            <Sparkles className="h-3.5 w-3.5" />
            Manual Log
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
            Log {movementName}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-white/58">
            Add a clean entry with the right metric, unit, and session detail.
          </p>
        </div>
      </div>

      {loadError ? (
        <div className="relative mb-6 rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {loadError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="relative space-y-6">
        {saveError ? (
          <div className="rounded-[20px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {saveError}
          </div>
        ) : null}

        <div className={`grid gap-4 ${formConfig.showUnitSelector ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
              Metric Type
            </span>
            <select
              value={metricType}
              onChange={(e) => setMetricType(e.target.value)}
              className={`${inputClass} border-white/10 focus:border-white/20`}
            >
              {metricTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          {formConfig.showUnitSelector ? (
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                Unit
              </span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={`${inputClass} border-white/10 focus:border-white/20`}
              >
                {unitOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                Unit
              </span>
              <div className="flex h-[54px] items-center rounded-[20px] border border-white/10 bg-black/85 px-4 text-sm font-medium text-white/80">
                {effectiveUnit || "Auto"}
              </div>
            </div>
          )}
        </div>

        <div className={`grid gap-4 ${formConfig.showRepsField ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
              {formConfig.valueLabel}
            </span>
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                clearFieldError("value");
              }}
              placeholder={formConfig.valuePlaceholder}
              className={`${inputClass} ${formErrors.value ? "border-red-400/40 focus:border-red-400/50" : "border-white/10 focus:border-white/20"}`}
            />
            {formErrors.value ? <span className="mt-2 block text-xs text-red-200">{formErrors.value}</span> : null}
          </label>

          {formConfig.showRepsField ? (
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                {formConfig.repsLabel}
              </span>
              <input
                value={reps}
                onChange={(e) => {
                  setReps(e.target.value);
                  clearFieldError("reps");
                }}
                placeholder={formConfig.repsPlaceholder}
                className={`${inputClass} ${formErrors.reps ? "border-red-400/40 focus:border-red-400/50" : "border-white/10 focus:border-white/20"}`}
              />
              {formErrors.reps ? <span className="mt-2 block text-xs text-red-200">{formErrors.reps}</span> : null}
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
              Date
            </span>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  clearFieldError("date");
                }}
                onClick={(e) => {
                  const input = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                  input.showPicker?.();
                }}
                className={`${inputClass} pr-12 [color-scheme:dark] ${formErrors.date ? "border-red-400/40 focus:border-red-400/50" : "border-white/10 focus:border-white/20"}`}
              />
              <button
                type="button"
                onClick={(e) => {
                  const input = e.currentTarget.previousElementSibling as (HTMLInputElement & { showPicker?: () => void }) | null;
                  input?.showPicker?.();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.03] p-2 text-white/55 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                aria-label="Open calendar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path d="M8 2v4" />
                  <path d="M16 2v4" />
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M3 10h18" />
                </svg>
              </button>
            </div>
            {formErrors.date ? <span className="mt-2 block text-xs text-red-200">{formErrors.date}</span> : null}
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              clearFieldError("notes");
            }}
            rows={4}
            placeholder="Optional notes..."
            maxLength={280}
            className={`${inputClass} resize-none ${formErrors.notes ? "border-red-400/40 focus:border-red-400/50" : "border-white/10 focus:border-white/20"}`}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            {formErrors.notes ? (
              <span className="text-xs text-red-200">{formErrors.notes}</span>
            ) : (
              <span className="text-xs text-white/35">Optional context for this entry.</span>
            )}
            <span className="text-xs text-white/35">{notes.length}/280</span>
          </div>
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="submit"
            disabled={isSaving}
            className={`inline-flex items-center gap-2 rounded-[20px] px-5 py-3.5 text-sm font-semibold transition hover:translate-y-[-1px] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 ${accent.button}`}
          >
            <Plus className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save log"}
          </button>

          {saved ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-100">
              <CheckCircle2 className="h-4 w-4" />
              {isNewPB ? "PB logged" : "Log saved"}
            </div>
          ) : null}

          {saved && isNewPB && hasSharePayload ? (
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              <Share className="h-4 w-4" />
              Share PB
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
