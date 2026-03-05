import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import UserAvatar from "../components/UserAvatar";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";

/**
 * Booking statuses
 * - booked: active booking
 * - checked_in: attended
 * - authorised_absence: told us, remove booking (we'll treat as removed; may not appear in roster)
 * - dip: booked and no-show
 */
type BookingStatus = "booked" | "checked_in" | "authorised_absence" | "dip";

type BookingRow = {
  userId: string;
  name?: string;
  email?: string;
  photoURL?: string;

  // New model
  status?: BookingStatus;

  // Backwards compatibility (while your callable still returns attended)
  attended?: boolean;
  checkedInAt?: any;
};

type RosterResponse = {
  classId: string;
  total: number;
  checkedInCount: number;
  attendees: BookingRow[];
};

type UserProfile = {
  name?: string;
  email?: string;
  photoURL?: string;
};

async function fetchUserProfiles(uids: string[]) {
  const map = new Map<string, UserProfile>();
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (!unique.length) return map;

  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const q = query(collection(db, "users"), where(documentId(), "in", chunk));
    const snap = await getDocs(q);
    snap.forEach((d) => map.set(d.id, d.data() as UserProfile));
  }

  return map;
}

function normalizeStatus(r: BookingRow): BookingStatus {
  // If your backend hasn’t been updated yet, infer from attended boolean
  if (r.status) return r.status;
  if (r.attended === true) return "checked_in";
  return "booked";
}

function StatusPill({ status }: { status: BookingStatus }) {
  const base =
    "text-xs uppercase tracking-widest px-3 py-1 rounded-full border inline-flex items-center gap-2";

  if (status === "checked_in")
    return <span className={`${base} border-emerald-500/60 text-emerald-200`}>Checked in</span>;

  if (status === "dip")
    return <span className={`${base} border-red-500/50 text-red-200`}>Dip</span>;

  // authorised_absence usually won’t show if booking is removed, but keep for completeness
  if (status === "authorised_absence")
    return <span className={`${base} border-sky-500/50 text-sky-200`}>Auth abs</span>;

  return <span className={`${base} border-white/15 text-white/60`}>Booked</span>;
}

export default function ClassRoster() {
  const { classId } = useParams<{ classId: string }>();
  const auth = getAuth();

  const [classTitle, setClassTitle] = useState("Class");
  const [classMeta, setClassMeta] = useState("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [serverCounts, setServerCounts] = useState<{ total: number; checkedIn: number }>({
    total: 0,
    checkedIn: 0,
  });

  const [loadingRoster, setLoadingRoster] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Selection mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  const toggleSelected = useCallback((uid: string) => {
    setSelected((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }, []);

  const clearSelected = useCallback(() => setSelected({}), []);

  // ----- Load class header/meta -----
  useEffect(() => {
    if (!classId) return;

    (async () => {
      const snap = await getDoc(doc(db, "classes", classId));
      if (!snap.exists()) return;

      const d: any = snap.data();
      setClassTitle(d.title || "Class");

      const start = d.startTime?.toDate?.();
      const end = d.endTime?.toDate?.();

      const time =
        start && end
          ? `${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString(
              "en-GB",
              { hour: "2-digit", minute: "2-digit" }
            )}`
          : "";

      const date = start
        ? start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
        : "";

      setClassMeta([date, time, d.location].filter(Boolean).join(" • "));
    })();
  }, [classId]);

  // ----- Callable: get roster -----
  const loadRoster = useCallback(async () => {
    if (!classId) return;

    try {
      setLoadingRoster(true);

      const functions = getFunctions(undefined, "europe-west1");
      const getRoster = httpsCallable<{ classId: string }, RosterResponse>(functions, "getClassRoster");

      const res = await getRoster({ classId });
      const data = res.data;

      const attendees = data.attendees || [];

      const profiles = await fetchUserProfiles(attendees.map((a) => a.userId));

      const enriched: BookingRow[] = attendees.map((r) => {
        const u = profiles.get(r.userId);

        return {
          ...r,
          name: u?.name ?? r.name ?? "Member",
          email: u?.email ?? r.email ?? "",
          photoURL: u?.photoURL ?? r.photoURL,
          status:
          r.status ??
          (r as any).attendanceStatus ??
          (r.attended === true ? "checked_in" : "booked"),
        };
      });

      setRows(enriched);

      const localCheckedIn = enriched.filter((x) => normalizeStatus(x) === "checked_in").length;

      setServerCounts({
        total: data.total ?? enriched.length,
        checkedIn: data.checkedInCount ?? localCheckedIn,
      });
    } catch (err: any) {
      console.error("Roster error:", err);
      alert(`code: ${err.code}\nmessage: ${err.message}\ndetails: ${JSON.stringify(err.details ?? {}, null, 2)}`);
      setRows([]);
      setServerCounts({ total: 0, checkedIn: 0 });
    } finally {
      setLoadingRoster(false);
    }
  }, [classId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const localCheckedInCount = useMemo(
    () => rows.filter((r) => normalizeStatus(r) === "checked_in").length,
    [rows]
  );

  const checkedInShown = serverCounts.checkedIn || localCheckedInCount;
  const totalShown = serverCounts.total || rows.length;

  // Sort: checked-in first, then booked, then dip, then by name
  const sortedRows = useMemo(() => {
    const rank = (s: BookingStatus) => {
      if (s === "checked_in") return 0;
      if (s === "booked") return 1;
      if (s === "dip") return 2;
      return 3; // authorised_absence
    };

    const copy = [...rows];
    copy.sort((a, b) => {
      const as = normalizeStatus(a);
      const bs = normalizeStatus(b);
      const ra = rank(as);
      const rb = rank(bs);
      if (ra !== rb) return ra - rb;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    return copy;
  }, [rows]);

  /**
   * IMPORTANT:
   * Your current backend service only supports attended true/false.
   * We keep check-in working using the existing function.
   * For "dip" and "authorised absence", we call a NEW callable ("markBookingStatus") that you’ll add next.
   */
  async function setStatus(userId: string, next: BookingStatus) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    try {
      setBusyUserId(userId);

      // ✅ keep existing check-in working
      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";

        // existing client service
        // NOTE: you had: checkInBooking({ classId, userId, attended })
        const mod = await import("../service/checkin");
        await mod.checkInBooking({ classId, userId, attended });
      } else {
        // 🚧 NEW callable to implement next (dip / authorised_absence)
        const functions = getFunctions(undefined, "europe-west1");
        const mark = httpsCallable(functions, "markBookingStatus");
        await mark({ classId, userId, status: next });
      }

      await loadRoster();
    } catch (e: any) {
      console.error("Status error:", e);
      alert(
        `code: ${e?.code ?? "?"}\nmessage: ${e?.message ?? "Update failed"}\ndetails: ${JSON.stringify(
          e?.details ?? {},
          null,
          2
        )}`
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function bulkSetStatus(next: BookingStatus) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    const ids = selectMode ? selectedIds : [];

    if (!ids.length) return;

    try {
      setBulkBusy(true);

      // For check-in / uncheck, re-use existing service in parallel
      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";
        const mod = await import("../service/checkin");

        const results = await Promise.allSettled(
          ids.map((uid) => mod.checkInBooking({ classId, userId: uid, attended }))
        );

        const failed = results.filter((x) => x.status === "rejected").length;
        await loadRoster();

        if (failed > 0) {
          alert(`Updated ${ids.length - failed}/${ids.length}. ${failed} failed — try again or refresh.`);
        }
      } else {
        // dip / authorised_absence via new callable
        const functions = getFunctions(undefined, "europe-west1");
        const mark = httpsCallable(functions, "markBookingStatus");

        const results = await Promise.allSettled(ids.map((uid) => mark({ classId, userId: uid, status: next })));
        const failed = results.filter((x) => x.status === "rejected").length;

        await loadRoster();

        if (failed > 0) {
          alert(`Updated ${ids.length - failed}/${ids.length}. ${failed} failed — try again or refresh.`);
        }
      }

      clearSelected();
      setSelectMode(false);
    } catch (e: any) {
      console.error("Bulk update error:", e);
      alert(e?.message ?? "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  // Existing “check in all / uncheck all” still useful, but now we’ll drive it through status
  async function checkInAll() {
    const toCheckIn = rows.filter((r) => normalizeStatus(r) !== "checked_in");
    if (toCheckIn.length === 0) return;
    setSelected(Object.fromEntries(toCheckIn.map((r) => [r.userId, true])));
    setSelectMode(true);
    await bulkSetStatus("checked_in");
  }

  async function uncheckAll() {
    const toUncheck = rows.filter((r) => normalizeStatus(r) === "checked_in");
    if (toUncheck.length === 0) return;
    setSelected(Object.fromEntries(toUncheck.map((r) => [r.userId, true])));
    setSelectMode(true);
    await bulkSetStatus("booked");
  }

  const progressPct = totalShown ? Math.round((checkedInShown / totalShown) * 100) : 0;
  const canBulkCheckIn = !loadingRoster && !bulkBusy && rows.some((r) => normalizeStatus(r) !== "checked_in");
  const canBulkUncheck = !loadingRoster && !bulkBusy && rows.some((r) => normalizeStatus(r) === "checked_in");

  const canBulkSelected = !loadingRoster && !bulkBusy && selectedIds.length > 0;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* HERO HEADER */}
        <div className="rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-950 to-black p-7 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="font-heading uppercase text-white break-words leading-[0.9] text-4xl tracking-[0.25em] sm:text-6xl sm:tracking-widest">
                {classTitle}
              </h1>
              <div className="text-white/50 mt-2">{classMeta}</div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs uppercase tracking-widest text-white/40">Checked in</div>
              <div className="text-5xl font-bold">
                {checkedInShown}
                <span className="text-white/30">/{totalShown}</span>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-500/40 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="mt-2 text-xs text-white/40 uppercase tracking-widest">{progressPct}% checked in</div>
          </div>
        </div>

        {/* ATTENDEES */}
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="text-xl font-semibold">Attendees</div>

            <div className="flex flex-wrap gap-2 sm:ml-auto sm:items-center">
              <button
                onClick={() => {
                  setSelectMode((v) => !v);
                  clearSelected();
                }}
                disabled={loadingRoster || bulkBusy}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] disabled:text-white/40"
              >
                {selectMode ? "Done selecting" : "Select"}
              </button>

              <button
                onClick={checkInAll}
                disabled={!canBulkCheckIn}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                  ${
                    canBulkCheckIn
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "border-white/10 bg-white/[0.03] text-white/40"
                  }`}
              >
                {bulkBusy ? "Working…" : "Check in all"}
              </button>

              <button
                onClick={uncheckAll}
                disabled={!canBulkUncheck}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                  ${
                    canBulkUncheck
                      ? "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                      : "border-white/10 bg-white/[0.03] text-white/40"
                  }`}
              >
                {bulkBusy ? "Working…" : "Uncheck all"}
              </button>

              <button
                onClick={loadRoster}
                disabled={loadingRoster || bulkBusy}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] disabled:text-white/40"
              >
                {loadingRoster ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {/* Bulk action bar (only in select mode) */}
          {selectMode && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="text-sm text-white/70">
                Selected: <span className="text-white font-semibold">{selectedIds.length}</span>
              </div>

              <div className="flex flex-wrap gap-2 sm:ml-auto">
                <button
                  onClick={() => bulkSetStatus("checked_in")}
                  disabled={!canBulkSelected}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                    ${
                      canBulkSelected
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "border-white/10 bg-white/[0.03] text-white/40"
                    }`}
                >
                  Check in
                </button>

                <button
                  onClick={() => bulkSetStatus("authorised_absence")}
                  disabled={!canBulkSelected}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                    ${
                      canBulkSelected
                        ? "border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/15"
                        : "border-white/10 bg-white/[0.03] text-white/40"
                    }`}
                >
                  Authorised absence
                </button>

                <button
                  onClick={() => bulkSetStatus("dip")}
                  disabled={!canBulkSelected}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                    ${
                      canBulkSelected
                        ? "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                        : "border-white/10 bg-white/[0.03] text-white/40"
                    }`}
                >
                  Dip
                </button>

                <button
                  onClick={clearSelected}
                  disabled={loadingRoster || bulkBusy}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] disabled:text-white/40"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {loadingRoster ? (
            <div className="mt-6 text-white/50">Loading roster…</div>
          ) : sortedRows.length === 0 ? (
            <div className="mt-6 text-white/60">No bookings yet.</div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sortedRows.map((r) => {
                const status = normalizeStatus(r);
                const isBusy = busyUserId === r.userId || bulkBusy;
                const isSelected = !!selected[r.userId];

                return (
                  <div
                    key={r.userId}
                    className={`
                      group rounded-2xl border p-5 text-left transition
                      ${status === "checked_in" ? "border-emerald-500/60 bg-emerald-500/10" : ""}
                      ${status === "dip" ? "border-red-500/60 bg-red-500/15 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : ""}
                      ${status === "booked" ? "border-white/10 bg-white/[0.03]" : ""}
                      ${isBusy ? "opacity-60" : "hover:border-white/20 hover:bg-white/[0.05] hover:-translate-y-[1px]"}
                    `}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {selectMode && (
                        <button
                          type="button"
                          onClick={() => toggleSelected(r.userId)}
                          className={`
                            shrink-0 h-6 w-6 rounded-md border flex items-center justify-center
                            ${isSelected ? "border-emerald-500/60 bg-emerald-500/15" : "border-white/15 bg-white/[0.03]"}
                          `}
                          aria-label="Select attendee"
                        >
                          {isSelected ? <span className="text-emerald-200 text-sm">✓</span> : null}
                        </button>
                      )}

                      <div
                        className={[
                          "shrink-0 rounded-full p-[2px] border",
                          status === "checked_in"
                            ? "border-emerald-500/70"
                            : status === "dip"
                            ? "border-red-500/60"
                            : "border-white/10",
                        ].join(" ")}
                      >
                        <UserAvatar name={r.name ?? "Member"} photoURL={r.photoURL} size={48} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate text-white">{r.name ?? "Member"}</div>
                        <div className="text-xs text-white/50 truncate">{r.email ?? ""}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <StatusPill status={status} />
                      <span className="text-xs text-white/30 font-mono">{r.checkedInAt ? "✓" : ""}</span>
                    </div>

                    {/* Actions (hidden in select mode) */}
                    {!selectMode && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button
                          onClick={() => setStatus(r.userId, status === "checked_in" ? "booked" : "checked_in")}
                          disabled={isBusy}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06] disabled:text-white/40"
                        >
                          {status === "checked_in" ? "Uncheck" : "Check in"}
                        </button>

                        <button
                          onClick={() => setStatus(r.userId, "authorised_absence")}
                          disabled={isBusy}
                          className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/15 disabled:text-white/40"
                        >
                          Absence
                        </button>

                        <button
                          onClick={() => setStatus(r.userId, "dip")}
                          disabled={isBusy}
                          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/15 disabled:text-white/40"
                        >
                          Dip
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}