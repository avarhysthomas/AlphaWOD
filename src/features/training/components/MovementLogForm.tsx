import React from "react";
import { CheckCircle2, Minus, Plus, Share } from "lucide-react";
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
  presentation?: "card" | "sheet";
  onCancel?: () => void;
  previousBestValue?: string;
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
  presentation = "card",
  onCancel,
  previousBestValue,
}: MovementLogFormProps) {
  const isSheet = presentation === "sheet";
  const inputClass =
    "w-full rounded-[18px] border bg-[#211e1b] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/28 focus:bg-[#171513]";
  const numericValue = Number.parseFloat(value);
  const previousBestNumber = Number.parseFloat(previousBestValue ?? "");
  const valueStep = effectiveUnit.toLowerCase() === "kg" ? 2.5 : 1;
  const basePresetValue = Number.isFinite(numericValue)
    ? numericValue
    : Number.isFinite(previousBestNumber)
    ? previousBestNumber
    : 0;
  const quickValues = Array.from(
    new Set(
      [basePresetValue - valueStep * 4, basePresetValue - valueStep * 2, basePresetValue, basePresetValue + valueStep, basePresetValue + valueStep * 2]
        .filter((preset) => Number.isFinite(preset) && preset > 0)
        .map((preset) => Number(preset.toFixed(2)))
    )
  );
  const formattedDate = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "Today";

  function updateNumericValue(delta: number) {
    const nextBase = Number.isFinite(numericValue) ? numericValue : basePresetValue;
    const nextValue = Math.max(0, nextBase + delta);
    setValue(Number.isInteger(nextValue) ? String(nextValue) : String(Number(nextValue.toFixed(2))));
    clearFieldError("value");
  }

  function updateNumericReps(delta: number) {
    const current = Number.parseInt(reps || "0", 10);
    const nextValue = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    setReps(String(nextValue));
    clearFieldError("reps");
  }

  if (isSheet) {
    return (
      <section className="relative">
        <div className="mb-8 pr-16">
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/38">
            Log set
          </p>
          <h2 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-white">
            {movementName}
          </h2>
          <p className="mt-2 text-base font-medium text-white/40">Today · {formattedDate}</p>
        </div>

        {loadError ? (
          <div className="mb-5 rounded-[18px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {loadError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-7">
          {saveError ? (
            <div className="rounded-[18px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              {saveError}
            </div>
          ) : null}

          <div>
            <span className="mb-4 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
              Set type
            </span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {metricTypes.map((option) => {
                const isActive = option === metricType;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMetricType(option)}
                    className={[
                      "min-h-[58px] rounded-[14px] border px-3 text-sm font-extrabold transition",
                      isActive
                        ? "border-[#f2eee8] bg-[#f2eee8] text-black"
                        : "border-white/10 bg-[#211e1b] text-white/52 hover:border-white/18 hover:text-white",
                    ].join(" ")}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <span className="block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
                {formConfig.valueLabel}
              </span>
              {previousBestValue ? (
                <span className="font-mono text-sm text-white/42">
                  Prior best {previousBestValue} {effectiveUnit}
                </span>
              ) : null}
            </div>
            <div
              className={[
                "rounded-[24px] border bg-[#211e1b] p-5",
                formErrors.value ? "border-red-400/40" : "border-white/10",
              ].join(" ")}
            >
              <div className="grid grid-cols-[56px_1fr_56px] items-center gap-4">
                <button
                  type="button"
                  onClick={() => updateNumericValue(-valueStep)}
                  className="grid h-14 w-14 place-items-center rounded-[14px] border border-white/10 bg-white/[0.05] text-white transition hover:bg-white/[0.09]"
                  aria-label="Decrease load"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <label className="block">
                  <span className="sr-only">{formConfig.valueLabel}</span>
                  <div className="flex items-end justify-center gap-3">
                    <input
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        clearFieldError("value");
                      }}
                      inputMode="decimal"
                      placeholder={formConfig.valuePlaceholder}
                      className="w-full min-w-0 bg-transparent text-center font-mono text-[4.2rem] font-bold leading-none text-white outline-none placeholder:text-white/18"
                    />
                    {effectiveUnit ? (
                      <span className="pb-3 text-sm font-bold uppercase tracking-[0.12em] text-white/34">
                        {effectiveUnit}
                      </span>
                    ) : null}
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => updateNumericValue(valueStep)}
                  className="grid h-14 w-14 place-items-center rounded-[14px] border border-white/10 bg-white/[0.05] text-white transition hover:bg-white/[0.09]"
                  aria-label="Increase load"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
              {isNewPB ? (
                <p className="mt-3 text-center font-mono text-sm text-emerald-300">
                  ▲ new PR
                </p>
              ) : null}
              {formErrors.value ? <span className="mt-3 block text-center text-xs text-red-200">{formErrors.value}</span> : null}
            </div>
            {quickValues.length ? (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {quickValues.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setValue(String(preset));
                      clearFieldError("value");
                    }}
                    className={[
                      "rounded-[10px] border px-2 py-3 font-mono text-sm font-bold transition",
                      String(preset) === value
                        ? "border-white/20 bg-white/[0.08] text-white"
                        : "border-white/10 bg-transparent text-white/32 hover:text-white/70",
                    ].join(" ")}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {formConfig.showUnitSelector ? (
            <label className="block">
              <span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
                Unit
              </span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={`${inputClass} border-white/10 focus:border-white/22`}
              >
                {unitOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className={`grid gap-5 ${formConfig.showRepsField ? "grid-cols-2" : "grid-cols-1"}`}>
            {formConfig.showRepsField ? (
              <div>
                <span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
                  {formConfig.repsLabel}
                </span>
                <div className="grid grid-cols-[48px_1fr_48px] items-center gap-3 rounded-[18px] border border-white/10 bg-[#211e1b] p-3">
                  <button
                    type="button"
                    onClick={() => updateNumericReps(-1)}
                    className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/10 bg-white/[0.05] text-white"
                    aria-label="Decrease reps"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    value={reps}
                    onChange={(e) => {
                      setReps(e.target.value);
                      clearFieldError("reps");
                    }}
                    inputMode="numeric"
                    placeholder={formConfig.repsPlaceholder}
                    className="w-full bg-transparent text-center text-3xl font-bold text-white outline-none placeholder:text-white/18"
                  />
                  <button
                    type="button"
                    onClick={() => updateNumericReps(1)}
                    className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/10 bg-white/[0.05] text-white"
                    aria-label="Increase reps"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {formErrors.reps ? <span className="mt-2 block text-xs text-red-200">{formErrors.reps}</span> : null}
              </div>
            ) : null}

            <label className="block">
              <span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
                Date
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  clearFieldError("date");
                }}
                className={`${inputClass} border-white/10 [color-scheme:dark] focus:border-white/22`}
              />
              {formErrors.date ? <span className="mt-2 block text-xs text-red-200">{formErrors.date}</span> : null}
            </label>
          </div>

          <label className="block">
            <span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearFieldError("notes");
              }}
              rows={3}
              placeholder="Bar speed, cues, what felt good..."
              maxLength={280}
              className={`${inputClass} resize-none border-white/10 focus:border-white/22 ${formErrors.notes ? "border-red-400/40" : ""}`}
            />
            {formErrors.notes ? <span className="mt-2 block text-xs text-red-200">{formErrors.notes}</span> : null}
          </label>

          <div className="grid grid-cols-[0.9fr_1.4fr] gap-3 pb-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/12 px-5 py-4 text-base font-bold text-white transition hover:bg-white/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-3 rounded-full bg-[#f2eee8] px-5 py-4 text-base font-extrabold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save set"}
              {isNewPB ? (
                <span className="rounded-md bg-black/10 px-2 py-1 text-[11px] font-black uppercase tracking-[0.08em]">
                  New PR
                </span>
              ) : null}
            </button>
          </div>

          {saved ? (
            <div className="flex items-center justify-between gap-3 rounded-[16px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {isNewPB ? "PB logged" : "Set saved"}
              </span>
              {isNewPB && hasSharePayload ? (
                <button
                  type="button"
                  onClick={onShare}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white"
                >
                  <Share className="h-3.5 w-3.5" />
                  Share
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,22,0.98),rgba(10,10,12,0.98))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-6">
      <div className={`absolute inset-0 ${accent.softGlow}`} />
      <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

      <div className="relative mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
            Log result
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-white/58">
            Add a result for {movementName}.
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
              <span className="text-xs text-white/35">Optional.</span>
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
