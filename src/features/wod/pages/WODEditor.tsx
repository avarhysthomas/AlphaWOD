import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import LogoutButton from "../../../components/ui/LogoutButton";
import AppBottomNav from "../../../components/layout/AppBottomNav";
import WeekPlanner, { WeekSlotMap } from "../components/WeekPlanner";
import SessionBlockEditor, { BLOCK_KIND_ICONS } from "../components/SessionBlockEditor";
import { getDateInputValueInTimeZone } from "../../../utils/date";
import {
  ProgrammingTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from "../services/programmingTemplates";
import {
  BLOCK_KIND_LABELS,
  BlockKind,
  SLOT_KEYS,
  SLOT_LABELS,
  SessionPlan,
  SlotKey,
  addDays,
  buildSessionPayload,
  clonePlan,
  createBlock,
  dateFromKey,
  describeSlotPayload,
  duplicateBlock,
  emptySessionPlan,
  formatSeconds,
  mondayOf,
  normalizeSessionPlan,
  sessionPlanIsEmpty,
  sessionTotalSeconds,
  weekDays,
} from "../utils/programming";
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  CloudOff,
  Copy,
  LayoutTemplate,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

const timeZone = "Europe/London";
const AUTOSAVE_DELAY_MS = 1200;

const ADDABLE_KINDS: BlockKind[] = [
  "warmup",
  "strength",
  "conditioning",
  "finisher",
  "cooldown",
  "notes",
];

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

type Toast = { kind: "success" | "error"; message: string };

type SlotDocsByDate = Record<string, Record<string, any> | null>;

type QuickStartSource = {
  key: string;
  label: string;
  detail: string;
  plan: SessionPlan;
};

function formatSelectedDateLabel(dateKey: string) {
  return dateFromKey(dateKey).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatShortDateLabel(dateKey: string) {
  return dateFromKey(dateKey).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatClockTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTodayLabel() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
}

/* ------------------------------ shared styling ------------------------------ */

const eyebrowClass = "text-[12px] font-bold uppercase tracking-[0.28em] text-white/34";

const cardClass = "rounded-[24px] border border-white/10 bg-[#151311] p-5 sm:p-6";

const inputClass =
  "w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-3.5 text-[15px] text-white outline-none transition placeholder:text-white/20 focus:border-white/22 disabled:opacity-40";

const ghostButtonClass =
  "inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold text-white/55 transition hover:border-white/20 hover:text-white disabled:opacity-40";

const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-full bg-[#f2eee8] px-5 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50";

const closeButtonClass =
  "grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white";

/* ------------------------------ add-block inserter ------------------------------ */

function AddBlockInserter({
  onAdd,
  variant,
}: {
  onAdd: (kind: BlockKind) => void;
  variant: "divider" | "panel";
}) {
  const [open, setOpen] = useState(false);

  const kindButtons = (
    <div className="flex flex-wrap gap-2">
      {ADDABLE_KINDS.map((kind) => {
        const Icon = BLOCK_KIND_ICONS[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => {
              onAdd(kind);
              setOpen(false);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold text-white/50 transition hover:border-white/20 hover:text-white"
          >
            <Icon className="h-4 w-4" />
            {BLOCK_KIND_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );

  if (variant === "panel") {
    return (
      <section className={cardClass}>
        <p className={eyebrowClass}>Add block</p>
        <div className="mt-4">{kindButtons}</div>
      </section>
    );
  }

  return (
    <div className="group relative py-2">
      {open ? (
        <div className="rounded-[20px] border border-white/10 bg-[#151311] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
              Insert block here
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cancel insert"
              className={closeButtonClass}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {kindButtons}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.06] transition group-hover:bg-white/12" />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/28 transition hover:border-white/20 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add block
          </button>
          <span className="h-px flex-1 bg-white/[0.06] transition group-hover:bg-white/12" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------ save status ------------------------------ */

function SaveStatus({
  state,
  savedAtMs,
  onRetry,
}: {
  state: SaveState;
  savedAtMs: number | null;
  onRetry: () => void;
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-white/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (state === "unsaved") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-white/38">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        Editing…
      </span>
    );
  }

  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-400/30 bg-red-400/10 px-3.5 py-1.5 text-xs font-bold text-red-100 transition hover:bg-red-400/20"
      >
        <CloudOff className="h-3.5 w-3.5" />
        Couldn&apos;t save — retry
      </button>
    );
  }

  if (state === "saved") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-emerald-200">
        <Check className="h-3.5 w-3.5" />
        Saved{savedAtMs ? ` ${formatClockTime(savedAtMs)}` : ""}
      </span>
    );
  }

  return null;
}

/* ------------------------------ page ------------------------------ */

const WODEditor = () => {
  const todayKey = useMemo(
    () => getDateInputValueInTimeZone(new Date(), timeZone),
    []
  );

  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [selectedSlot, setSelectedSlot] = useState<SlotKey>("AM");
  const [weekStartKey, setWeekStartKey] = useState(() => mondayOf(todayKey));

  const [plan, setPlan] = useState<SessionPlan>(emptySessionPlan());
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(emptySessionPlan())
  );

  const [slotDocs, setSlotDocs] = useState<SlotDocsByDate>({});
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(todayKey);
  const [copySlot, setCopySlot] = useState<SlotKey>("PM");

  const [templates, setTemplates] = useState<ProgrammingTemplate[]>([]);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const slotDocsRef = useRef(slotDocs);
  slotDocsRef.current = slotDocs;

  const selectionRef = useRef({ date: selectedDate, slot: selectedSlot });
  selectionRef.current = { date: selectedDate, slot: selectedSlot };

  const planRef = useRef(plan);
  planRef.current = plan;

  const isDirty = useMemo(
    () => JSON.stringify(plan) !== savedSnapshot,
    [plan, savedSnapshot]
  );

  const planIsEmpty = useMemo(() => sessionPlanIsEmpty(plan), [plan]);
  const slotHasSavedSession = Boolean(slotDocs[selectedDate]?.[selectedSlot]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Only warn on close while edits are still in flight or pending.
  useEffect(() => {
    const atRisk = saveState === "unsaved" || saveState === "saving" || saveState === "error";
    if (!atRisk) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  /* ------------------------------ data loading ------------------------------ */

  const loadDates = useCallback(async (dateKeys: string[], force = false) => {
    const missing = force
      ? dateKeys
      : dateKeys.filter((day) => !(day in slotDocsRef.current));
    if (!missing.length) return;

    setLoadingWeek(true);
    try {
      const results = await Promise.all(
        missing.map(async (day) => {
          const snap = await getDoc(doc(db, "wods", day));
          return [day, snap.exists() ? (snap.data() as Record<string, any>) : null] as const;
        })
      );

      setSlotDocs((current) => {
        const next = { ...current };
        for (const [day, data] of results) next[day] = data;
        return next;
      });
    } catch (error) {
      console.error("Failed to load programming", error);
      setToast({ kind: "error", message: "Could not load programming. Check your connection." });
    } finally {
      setLoadingWeek(false);
    }
  }, []);

  useEffect(() => {
    void loadDates(weekDays(weekStartKey));
  }, [loadDates, weekStartKey]);

  // Same slot a week earlier powers the "Repeat last week" quick start.
  useEffect(() => {
    void loadDates([addDays(selectedDate, -7)]);
  }, [loadDates, selectedDate]);

  useEffect(() => {
    let active = true;

    async function loadTemplateList() {
      try {
        const rows = await listTemplates();
        if (active) setTemplates(rows);
      } catch (error) {
        console.error("Failed to load templates", error);
      }
    }

    void loadTemplateList();
    return () => {
      active = false;
    };
  }, []);

  const selectedDayLoaded = selectedDate in slotDocs;
  useEffect(() => {
    // Until the day's document is in hand, hold an empty plan rather than
    // leaving the previous slot's blocks on screen — editing those would
    // autosave one session's work onto another slot.
    const nextPlan = selectedDayLoaded
      ? normalizeSessionPlan(slotDocsRef.current[selectedDate]?.[selectedSlot])
      : emptySessionPlan();

    setPlan(nextPlan);
    setSavedSnapshot(JSON.stringify(nextPlan));
    setSaveState("idle");
    setSavedAtMs(null);
  }, [selectedDate, selectedSlot, selectedDayLoaded]);

  /* ------------------------------ persistence ------------------------------ */

  const writeSlot = useCallback(
    async (dateKey: string, slot: SlotKey, payload: Record<string, unknown>) => {
      const docRef = doc(db, "wods", dateKey);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        await updateDoc(docRef, { [slot]: payload });
      } else {
        await setDoc(docRef, { [slot]: payload });
      }

      setSlotDocs((current) => ({
        ...current,
        [dateKey]: { ...(current[dateKey] ?? {}), [slot]: payload },
      }));
    },
    []
  );

  /**
   * Persist a snapshot of the plan. The builder state is never re-normalized
   * here — that would rewrite rows out from under whoever is typing.
   */
  const commitPlan = useCallback(
    async (dateKey: string, slot: SlotKey, planToSave: SessionPlan) => {
      setSaveState("saving");
      try {
        await writeSlot(dateKey, slot, buildSessionPayload(planToSave));

        const snapshot = JSON.stringify(planToSave);
        const stillHere =
          selectionRef.current.date === dateKey && selectionRef.current.slot === slot;

        if (stillHere) {
          setSavedSnapshot(snapshot);
          setSavedAtMs(Date.now());
          // Keystrokes may have landed while the write was in flight; only
          // claim "saved" when what's on screen is what we just wrote.
          const upToDate = JSON.stringify(planRef.current) === snapshot;
          setSaveState((current) =>
            current === "saving" ? (upToDate ? "saved" : "unsaved") : current
          );
        }
      } catch (error) {
        console.error("Autosave failed", error);
        if (
          selectionRef.current.date === dateKey &&
          selectionRef.current.slot === slot
        ) {
          setSaveState("error");
        } else {
          // The coach has already moved on; surface it so the loss is visible.
          setToast({
            kind: "error",
            message: `Could not save the ${SLOT_LABELS[slot]} session on ${formatShortDateLabel(dateKey)}.`,
          });
        }
      }
    },
    [writeSlot]
  );

  // Debounced autosave. An emptied session is never written — clearing a saved
  // session is an explicit action.
  useEffect(() => {
    if (!isDirty || planIsEmpty) return;

    setSaveState((current) => (current === "saving" ? current : "unsaved"));

    const dateKey = selectedDate;
    const slot = selectedSlot;
    const snapshot = plan;

    const timer = setTimeout(() => {
      void commitPlan(dateKey, slot, snapshot);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [plan, isDirty, planIsEmpty, selectedDate, selectedSlot, commitPlan]);

  /* ------------------------------ selection ------------------------------ */

  const handleSelectSlot = (dateKey: string, slot: SlotKey) => {
    if (dateKey === selectedDate && slot === selectedSlot) return;

    // Flush pending edits to the slot we're leaving.
    if (isDirty && !sessionPlanIsEmpty(planRef.current)) {
      void commitPlan(selectedDate, selectedSlot, planRef.current);
    }

    setSelectedDate(dateKey);
    setSelectedSlot(slot);
    setCopyOpen(false);
    setTemplatePanelOpen(false);
  };

  const handleShiftWeek = (deltaWeeks: number) => {
    setWeekStartKey((current) => addDays(current, deltaWeeks * 7));
  };

  const handleGoToToday = () => {
    setWeekStartKey(mondayOf(todayKey));
  };

  /* ------------------------------ actions ------------------------------ */

  const handleRetrySave = () => {
    void commitPlan(selectedDate, selectedSlot, planRef.current);
  };

  const handleCopyTo = async (targetDate: string, targetSlot: SlotKey) => {
    if (planIsEmpty) {
      setToast({ kind: "error", message: "Nothing to copy yet — build the session first." });
      return;
    }
    if (targetDate === selectedDate && targetSlot === selectedSlot) {
      setToast({ kind: "error", message: "Pick a different day or slot to copy to." });
      return;
    }

    setBusy(true);
    try {
      await writeSlot(targetDate, targetSlot, buildSessionPayload(plan));
      setCopyOpen(false);
      setToast({
        kind: "success",
        message: `Copied to ${SLOT_LABELS[targetSlot]} on ${formatShortDateLabel(targetDate)}.`,
      });
    } catch (error) {
      console.error("Error copying session:", error);
      setToast({ kind: "error", message: "Failed to copy the session. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!slotHasSavedSession) {
      const empty = emptySessionPlan();
      setPlan(empty);
      setSavedSnapshot(JSON.stringify(empty));
      setSaveState("idle");
      return;
    }

    if (
      !window.confirm(
        `Delete the saved ${SLOT_LABELS[selectedSlot]} session on ${formatSelectedDateLabel(selectedDate)}?`
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, "wods", selectedDate), { [selectedSlot]: deleteField() });

      setSlotDocs((current) => {
        const day = { ...(current[selectedDate] ?? {}) };
        delete day[selectedSlot];
        return { ...current, [selectedDate]: day };
      });

      const empty = emptySessionPlan();
      setPlan(empty);
      setSavedSnapshot(JSON.stringify(empty));
      setSaveState("idle");
      setSavedAtMs(null);
      setToast({ kind: "success", message: "Session cleared." });
    } catch (error) {
      console.error("Error clearing session:", error);
      setToast({ kind: "error", message: "Failed to clear the session. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (planIsEmpty) {
      setToast({ kind: "error", message: "Build the session before saving it as a template." });
      return;
    }

    setBusy(true);
    try {
      await saveTemplate(templateName || plan.wodName, plan);
      setTemplates(await listTemplates());
      setTemplateName("");
      setTemplatePanelOpen(false);
      setToast({ kind: "success", message: "Saved to your template library." });
    } catch (error) {
      console.error("Error saving template:", error);
      setToast({ kind: "error", message: "Failed to save the template. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTemplate = async (template: ProgrammingTemplate) => {
    if (!window.confirm(`Delete the template "${template.name}"?`)) return;

    setBusy(true);
    try {
      await deleteTemplate(template.id);
      setTemplates((current) => current.filter((row) => row.id !== template.id));
    } catch (error) {
      console.error("Error deleting template:", error);
      setToast({ kind: "error", message: "Failed to delete the template." });
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = (source: SessionPlan) => {
    setPlan(clonePlan(source));
  };

  /* ------------------------------ block operations ------------------------------ */

  const updateBlock = (index: number, next: SessionPlan["blocks"][number]) => {
    setPlan((current) => ({
      ...current,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? next : block
      ),
    }));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setPlan((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.blocks.length) return current;
      const blocks = [...current.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...current, blocks };
    });
  };

  const insertBlock = (kind: BlockKind, index: number) => {
    setPlan((current) => {
      const blocks = [...current.blocks];
      blocks.splice(index, 0, createBlock(kind));
      return { ...current, blocks };
    });
  };

  /* ------------------------------ derived ------------------------------ */

  const weekSummaries: WeekSlotMap = useMemo(() => {
    const map: WeekSlotMap = {};
    for (const day of weekDays(weekStartKey)) {
      const dayDoc = slotDocs[day];
      map[day] = {};
      for (const slot of SLOT_KEYS) {
        map[day][slot] = dayDoc ? describeSlotPayload(dayDoc[slot]) : null;
      }
    }
    return map;
  }, [slotDocs, weekStartKey]);

  const totalSeconds = useMemo(() => sessionTotalSeconds(plan), [plan]);

  // Sessions worth reusing: same slot last week first, then everything else
  // programmed in the visible week.
  const quickStartSources: QuickStartSource[] = useMemo(() => {
    const sources: QuickStartSource[] = [];

    const lastWeekKey = addDays(selectedDate, -7);
    const lastWeekRaw = slotDocs[lastWeekKey]?.[selectedSlot];
    const lastWeekSummary = describeSlotPayload(lastWeekRaw);
    if (lastWeekSummary) {
      sources.push({
        key: `${lastWeekKey}-${selectedSlot}`,
        label: "Repeat last week",
        detail: lastWeekSummary.title,
        plan: normalizeSessionPlan(lastWeekRaw),
      });
    }

    for (const day of weekDays(weekStartKey)) {
      for (const slot of SLOT_KEYS) {
        if (day === selectedDate && slot === selectedSlot) continue;
        if (day === lastWeekKey && slot === selectedSlot) continue;

        const raw = slotDocs[day]?.[slot];
        const summary = describeSlotPayload(raw);
        if (!summary) continue;

        sources.push({
          key: `${day}-${slot}`,
          label: `${formatShortDateLabel(day)} · ${SLOT_LABELS[slot]}`,
          detail: summary.title,
          plan: normalizeSessionPlan(raw),
        });
      }
    }

    return sources.slice(0, 7);
  }, [selectedDate, selectedSlot, slotDocs, weekStartKey]);

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-32 pt-7 sm:max-w-3xl sm:px-8 lg:max-w-4xl">
        <header
          className="flex items-center justify-between"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img
              src="/ZERO-ALPHA.png"
              alt="ZERO-ALPHA"
              className="h-20 w-auto object-contain"
            />
          </Link>
          <LogoutButton />
        </header>

        <section className="mt-12 sm:mt-16">
          <p className={eyebrowClass}>{formatTodayLabel()}</p>
          <h1 className="mt-6 max-w-[12ch] font-heading text-[4rem] uppercase leading-[0.98] tracking-[0.01em] text-white sm:text-[5.7rem]">
            Session planner.
          </h1>
        </section>

        <WeekPlanner
          weekStartKey={weekStartKey}
          todayKey={todayKey}
          selectedDate={selectedDate}
          selectedSlot={selectedSlot}
          summaries={weekSummaries}
          loading={loadingWeek}
          onSelect={handleSelectSlot}
          onShiftWeek={handleShiftWeek}
          onGoToToday={handleGoToToday}
        />

        <form
          onSubmit={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            const tag = (event.target as HTMLElement).tagName.toLowerCase();
            if (event.key === "Enter" && tag !== "textarea") event.preventDefault();
          }}
          className="mt-10 space-y-4"
        >
          <section className="rounded-[28px] border border-white/10 bg-[#151311] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <p className={eyebrowClass}>{formatSelectedDateLabel(selectedDate)}</p>

              <SaveStatus
                state={saveState}
                savedAtMs={savedAtMs}
                onRetry={handleRetrySave}
              />
            </div>

            <div className="mt-7 flex items-end gap-3">
              <div className="font-heading text-[3.4rem] leading-[0.88] tracking-[0.02em] text-white">
                {SLOT_LABELS[selectedSlot]}
              </div>
              {totalSeconds > 0 ? (
                <div className="pb-1.5 text-lg font-semibold text-white/35">
                  ~{formatSeconds(totalSeconds)} timed
                </div>
              ) : null}
            </div>

            <label className="mt-8 block">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                Session name
              </span>
              <input
                value={plan.wodName}
                onChange={(event) =>
                  setPlan((current) => ({ ...current, wodName: event.target.value }))
                }
                disabled={!selectedDayLoaded}
                placeholder="e.g. Engine Builder, Heavy Lower, Sled City"
                className={inputClass}
              />
            </label>

            {planIsEmpty && slotHasSavedSession ? (
              <div className="mt-4 flex items-start gap-2 rounded-[18px] border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs font-bold leading-5 text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This session is empty but a saved version is still live. Use Clear to
                delete it, or add a block to overwrite it.
              </div>
            ) : null}
          </section>

          {!selectedDayLoaded ? (
            <section
              className={`${cardClass} flex items-center gap-3 text-sm font-bold text-white/42`}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session…
            </section>
          ) : plan.blocks.length === 0 ? (
            <section className={cardClass}>
              <p className={eyebrowClass}>Quick start</p>

              {quickStartSources.length ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {quickStartSources.map((source) => (
                    <button
                      key={source.key}
                      type="button"
                      onClick={() => applyPlan(source.plan)}
                      className="group flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/18 px-4 py-3.5 text-left transition hover:border-white/20"
                    >
                      <RotateCcw className="h-4 w-4 shrink-0 text-white/34 transition group-hover:text-white" />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-bold text-white">
                          {source.label}
                        </span>
                        <span className="block truncate text-xs font-medium text-white/38">
                          {source.detail}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-white/45">
                  Nothing to copy from yet — build this one from blocks below and it
                  becomes a starting point for the rest of the week.
                </p>
              )}

              {templates.length ? (
                <>
                  <p className={`mt-8 ${eyebrowClass}`}>Templates</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {templates.map((template) => (
                      <span
                        key={template.id}
                        className="group flex items-center gap-1 rounded-[18px] border border-white/10 bg-black/18 pr-2 transition hover:border-white/20"
                      >
                        <button
                          type="button"
                          onClick={() => applyPlan(template.plan)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-4 py-3.5 text-left"
                        >
                          <LayoutTemplate className="h-4 w-4 shrink-0 text-white/34 transition group-hover:text-white" />
                          <span className="truncate text-[15px] font-bold text-white">
                            {template.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTemplate(template)}
                          aria-label={`Delete template ${template.name}`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white/22 transition hover:bg-red-400/10 hover:text-red-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="mt-8 border-t border-white/[0.07] pt-6">
                <p className={eyebrowClass}>Or start from a block</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ADDABLE_KINDS.map((kind) => {
                    const Icon = BLOCK_KIND_ICONS[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => insertBlock(kind, plan.blocks.length)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold text-white/50 transition hover:border-white/20 hover:text-white"
                      >
                        <Icon className="h-4 w-4" />
                        {BLOCK_KIND_LABELS[kind]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : (
            <div>
              <AddBlockInserter
                variant="divider"
                onAdd={(kind) => insertBlock(kind, 0)}
              />

              {plan.blocks.map((block, index) => (
                <React.Fragment key={block.id}>
                  <SessionBlockEditor
                    block={block}
                    index={index}
                    total={plan.blocks.length}
                    onChange={(next) => updateBlock(index, next)}
                    onMove={(direction) => moveBlock(index, direction)}
                    onDuplicate={() =>
                      setPlan((current) => {
                        const blocks = [...current.blocks];
                        blocks.splice(index + 1, 0, duplicateBlock(block));
                        return { ...current, blocks };
                      })
                    }
                    onRemove={() =>
                      setPlan((current) => ({
                        ...current,
                        blocks: current.blocks.filter(
                          (_, blockIndex) => blockIndex !== index
                        ),
                      }))
                    }
                  />
                  <AddBlockInserter
                    variant="divider"
                    onAdd={(kind) => insertBlock(kind, index + 1)}
                  />
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Sits clear of the fixed bottom nav at every width. */}
          <div className="sticky bottom-24 z-20 rounded-[24px] border border-white/10 bg-[#151311]/95 p-4 backdrop-blur-xl">
            {toast ? (
              <div
                className={[
                  "mb-3 flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-bold",
                  toast.kind === "success"
                    ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100"
                    : "border-red-400/25 bg-red-400/10 text-red-100",
                ].join(" ")}
              >
                {toast.kind === "success" ? (
                  <Check className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                {toast.message}
              </div>
            ) : null}

            {copyOpen ? (
              <div className="mb-3 rounded-[20px] border border-white/10 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                    Copy this session to
                  </span>
                  <button
                    type="button"
                    onClick={() => setCopyOpen(false)}
                    aria-label="Close copy panel"
                    className={closeButtonClass}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyTo(addDays(selectedDate, 1), selectedSlot)}
                    disabled={busy}
                    className={ghostButtonClass}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyTo(addDays(selectedDate, 7), selectedSlot)}
                    disabled={busy}
                    className={ghostButtonClass}
                  >
                    Next week
                  </button>
                  {SLOT_KEYS.filter((slot) => slot !== selectedSlot).map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => void handleCopyTo(selectedDate, slot)}
                      disabled={busy}
                      className={ghostButtonClass}
                    >
                      Today {SLOT_LABELS[slot]}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
                  <input
                    type="date"
                    value={copyDate}
                    onChange={(event) => setCopyDate(event.target.value)}
                    className="h-11 rounded-[16px] border border-white/10 bg-[#211e1b] px-3.5 text-sm font-bold text-white outline-none transition focus:border-white/22 [color-scheme:dark]"
                  />
                  {SLOT_KEYS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setCopySlot(slot)}
                      className={[
                        "rounded-full border px-3.5 py-2 text-sm font-bold transition",
                        copySlot === slot
                          ? "border-white/20 bg-white/[0.10] text-white"
                          : "border-white/10 bg-transparent text-white/36 hover:text-white/70",
                      ].join(" ")}
                    >
                      {SLOT_LABELS[slot]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void handleCopyTo(copyDate, copySlot)}
                    disabled={busy}
                    className={`ml-auto ${primaryButtonClass}`}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                </div>
              </div>
            ) : null}

            {templatePanelOpen ? (
              <div className="mb-3 rounded-[20px] border border-white/10 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                    Save as template
                  </span>
                  <button
                    type="button"
                    onClick={() => setTemplatePanelOpen(false)}
                    aria-label="Close template panel"
                    className={closeButtonClass}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder={plan.wodName || "Template name"}
                    className="h-11 min-w-0 flex-1 rounded-[16px] border border-white/10 bg-[#211e1b] px-3.5 text-sm font-bold text-white outline-none transition placeholder:text-white/20 focus:border-white/22"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveTemplate()}
                    disabled={busy}
                    className={primaryButtonClass}
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    Save
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCopyDate(selectedDate);
                  setTemplatePanelOpen(false);
                  setCopyOpen((open) => !open);
                }}
                className={ghostButtonClass}
              >
                <Copy className="h-4 w-4" />
                Copy to…
              </button>
              <button
                type="button"
                onClick={() => {
                  setCopyOpen(false);
                  setTemplatePanelOpen((open) => !open);
                }}
                className={ghostButtonClass}
              >
                <BookmarkPlus className="h-4 w-4" />
                Save as template
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold text-white/55 transition hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-200 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>

              <div className="ml-auto">
                <SaveStatus
                  state={saveState}
                  savedAtMs={savedAtMs}
                  onRetry={handleRetrySave}
                />
              </div>
            </div>
          </div>
        </form>
      </main>
      <AppBottomNav />
    </div>
  );
};

export default WODEditor;
