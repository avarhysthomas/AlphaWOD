import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  Bell,
  Check,
  Plus,
  RefreshCcw,
  UserCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import {
  doc,
  getDoc,
  collection,
  getDocs,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../../firebase";
import UserAvatar from "../../../components/ui/UserAvatar";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";

type BookingStatus = "booked" | "checked_in" | "authorised_absence" | "dip";

type AttendanceStatus = "none" | "checked_in" | "dip";

type BookingRow = {
  userId: string;
  userName?: string;
  name?: string;
  email?: string;
  photoURL?: string;

  // legacy / transitional fields from backend
  status?: string;
  attendanceStatus?: AttendanceStatus;
  attended?: boolean;
  checkedInAt?: any;
  addedByAdmin?: boolean;
};

type RosterResponse = {
  classId: string;
  total: number;
  checkedInCount: number;
  attendees: BookingRow[];
};

type GymUser = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  approvalStatus?: "approved" | "pending";
};

function normalizeStatus(r: BookingRow): BookingStatus {
  if (r.attendanceStatus === "dip") return "dip";
  if (r.attendanceStatus === "checked_in") return "checked_in";
  if (r.attended === true) return "checked_in";
  return "booked";
}

function StatusPill({ status }: { status: BookingStatus }) {
  const base =
    "text-[10px] uppercase tracking-[0.16em] px-2.5 py-1 rounded-md inline-flex items-center gap-2 font-black";

  if (status === "checked_in") {
    return <span className={`${base} bg-emerald-300 text-black`}>In</span>;
  }

  if (status === "dip") {
    return <span className={`${base} bg-red-400/90 text-black`}>Dip</span>;
  }

  if (status === "authorised_absence") {
    return <span className={`${base} bg-sky-300 text-black`}>Auth</span>;
  }

  return <span className={`${base} bg-white/[0.08] text-white/58`}>Booked</span>;
}

export default function ClassRoster() {
  const { classId } = useParams<{ classId: string }>();
  const auth = getAuth();
  const { user, appUser } = useAuth();

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

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [allUsers, setAllUsers] = useState<GymUser[]>([]);
  const [allUsersLoaded, setAllUsersLoaded] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState("");

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  const toggleSelected = useCallback((uid: string) => {
    setSelected((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }, []);

  const clearSelected = useCallback(() => setSelected({}), []);

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

      setClassMeta([date, time].filter(Boolean).join(" • "));
    })();
  }, [classId]);

  useEffect(() => {
    if (!showAddMemberModal || allUsersLoaded) return;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        const users: GymUser[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<GymUser, "id">),
        })).filter((user) => user.approvalStatus !== "pending" && user.role !== "banned");

        users.sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
        setAllUsers(users);
        setAllUsersLoaded(true);
      } catch (err) {
        console.error("Failed to load users for add-member picker:", err);
      }
    })();
  }, [allUsersLoaded, showAddMemberModal]);

  const loadRoster = useCallback(async () => {
    if (!classId) return;

    try {
      setLoadingRoster(true);

      const functions = getFunctions(undefined, "europe-west1");
      const getRoster = httpsCallable<{ classId: string }, RosterResponse>(functions, "getClassRoster");

      const res = await getRoster({ classId });
      const data = res.data;
      const attendees = data.attendees || [];

      const enriched: BookingRow[] = attendees.map((r) => {
        return {
          ...r,
          name: r.name ?? r.userName ?? "Member",
          email: r.email ?? "",
          photoURL: r.photoURL,
          attendanceStatus:
            r.attendanceStatus ??
            ((r as any).status === "dip" ? "dip" : r.attended === true ? "checked_in" : "none"),
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

  const sortedRows = useMemo(() => {
    const rank = (s: BookingStatus) => {
      if (s === "checked_in") return 0;
      if (s === "booked") return 1;
      if (s === "dip") return 2;
      return 3;
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

  const addableUsers = useMemo(() => {
    const activeIds = new Set(
      rows
        .filter((r) => {
          const status = normalizeStatus(r);
          return status === "booked" || status === "checked_in";
        })
        .map((r) => r.userId)
    );

    return allUsers.filter((u) => !activeIds.has(u.id));
  }, [allUsers, rows]);

  async function setStatus(userId: string, next: BookingStatus) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    try {
      setBusyUserId(userId);

      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";
        const mod = await import("../services/checkin");
        await mod.checkInBooking({ classId, userId, attended });
      } else {
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

  async function bulkSetStatus(next: BookingStatus, idsArg?: string[]) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    const ids = idsArg ?? selectedIds;
    if (!ids.length) return;

    try {
      setBulkBusy(true);

      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";
        const mod = await import("../services/checkin");

        const results = await Promise.allSettled(
          ids.map((uid) => mod.checkInBooking({ classId, userId: uid, attended }))
        );

        const failed = results.filter((x) => x.status === "rejected").length;
        await loadRoster();

        if (failed > 0) {
          alert(`Updated ${ids.length - failed}/${ids.length}. ${failed} failed — try again or refresh.`);
        }
      } else {
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

  async function checkInAll() {
    const ids = rows
      .filter((r) => normalizeStatus(r) !== "checked_in")
      .map((r) => r.userId);

    if (!ids.length) return;
    await bulkSetStatus("checked_in", ids);
  }

  async function uncheckAll() {
    const ids = rows
      .filter((r) => normalizeStatus(r) === "checked_in")
      .map((r) => r.userId);

    if (!ids.length) return;
    await bulkSetStatus("booked", ids);
  }

  async function handleAdminAddMember() {
  if (!classId) return;

  const selectedUser =
    addableUsers.find((u) => u.id === selectedUserId) ??
    allUsers.find((u) => u.id === selectedUserId);

  if (!selectedUser) {
    setAddMemberError("Please select a member.");
    return;
  }

  try {
    setAddingMember(true);
    setAddMemberError("");

    const functions = getFunctions(undefined, "europe-west1");
    const adminAddBooking = httpsCallable(functions, "adminAddBooking");

    await adminAddBooking({
      classId,
      userId: selectedUser.id,
    });

    setShowAddMemberModal(false);
    setSelectedUserId("");
    await loadRoster();
  } catch (err: any) {
    console.error("Admin add member error:", err);
    setAddMemberError(err?.message ?? "Failed to add member.");
  } finally {
    setAddingMember(false);
  }
}

  const progressPct = totalShown ? Math.round((checkedInShown / totalShown) * 100) : 0;
  const canBulkCheckIn = !loadingRoster && !bulkBusy && rows.some((r) => normalizeStatus(r) !== "checked_in");
  const canBulkUncheck = !loadingRoster && !bulkBusy && rows.some((r) => normalizeStatus(r) === "checked_in");
  const canBulkSelected = !loadingRoster && !bulkBusy && selectedIds.length > 0;
  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "A";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-5 w-5" />
            </button>
            <Link
              to="/profile"
              aria-label="Profile"
              className="grid h-12 w-12 overflow-hidden rounded-full border border-[#8b725b]/60 bg-[#765f4b] text-sm font-bold uppercase text-[#f8efe5]"
            >
              {profilePhotoURL ? (
                <img
                  src={profilePhotoURL}
                  alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">{firstName.slice(0, 1)}</span>
              )}
            </Link>
          </div>
        </header>

        <section className="mt-11">
          <Link to="/schedule" className="text-sm font-bold text-white/34 transition hover:text-white/70">
            ← Schedule
          </Link>
          <h1 className="mt-8 font-heading text-[4.5rem] uppercase leading-none text-white sm:text-[6rem]">
            {classTitle}
          </h1>
          <p className="mt-5 max-w-lg text-base font-medium leading-7 text-white/52">{classMeta}</p>
        </section>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="grid grid-cols-3 divide-x divide-white/10 text-center">
            <div>
              <div className="font-mono text-4xl font-bold leading-none text-white">{checkedInShown}</div>
              <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/34">Checked in</div>
            </div>
            <div>
              <div className="font-mono text-4xl font-bold leading-none text-white">{totalShown}</div>
              <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/34">Booked</div>
            </div>
            <div>
              <div className="font-mono text-4xl font-bold leading-none text-white">{progressPct}%</div>
              <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/34">Progress</div>
            </div>
          </div>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#f2eee8] transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.32em] text-white/82">
              Attendees
            </h2>
            <span className="text-sm font-bold text-white/40">
              {loadingRoster
                ? sortedRows.length > 0
                  ? "Refreshing"
                  : "Loading"
                : `${sortedRows.length} total`}
            </span>
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                onClick={() => {
                  setSelectMode((v) => !v);
                  clearSelected();
                }}
                disabled={loadingRoster || bulkBusy}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-3 text-sm font-bold transition disabled:opacity-35",
                  selectMode
                    ? "border-[#f2eee8] bg-[#f2eee8] text-black"
                    : "border-white/10 bg-[#151311] text-white/68 hover:bg-white/[0.06]",
                ].join(" ")}
              >
                <Users className="h-4 w-4" />
                {selectMode ? "Done selecting" : "Select"}
              </button>

              <button
                onClick={checkInAll}
                disabled={!canBulkCheckIn}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <UserCheck className="h-4 w-4" />
                {bulkBusy ? "Working..." : "Check in all"}
              </button>

              <button
                onClick={uncheckAll}
                disabled={!canBulkUncheck}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <UserMinus className="h-4 w-4" />
                {bulkBusy ? "Working..." : "Uncheck all"}
              </button>

              <button
                onClick={() => {
                  setAddMemberError("");
                  setSelectedUserId("");
                  setShowAddMemberModal(true);
                }}
                disabled={loadingRoster || bulkBusy}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <Plus className="h-4 w-4" />
                Add member
              </button>

              <button
                onClick={loadRoster}
                disabled={loadingRoster || bulkBusy}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <RefreshCcw className="h-4 w-4" />
                {loadingRoster ? "Loading..." : "Refresh"}
              </button>
          </div>

          {selectMode && (
            <div className="mb-4 rounded-[24px] border border-white/10 bg-[#151311] p-4">
              <div className="mb-3 flex items-center justify-between text-sm font-bold">
                <span className="text-white/46">Selected</span>
                <span className="text-white">{selectedIds.length}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  onClick={() => bulkSetStatus("checked_in")}
                  disabled={!canBulkSelected}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-white transition hover:bg-white/[0.07] disabled:opacity-35"
                >
                  Check in
                </button>

                <button
                  onClick={() => bulkSetStatus("authorised_absence")}
                  disabled={!canBulkSelected}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-white transition hover:bg-white/[0.07] disabled:opacity-35"
                >
                  Auth absence
                </button>

                <button
                  onClick={() => bulkSetStatus("dip")}
                  disabled={!canBulkSelected}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-white transition hover:bg-white/[0.07] disabled:opacity-35"
                >
                  Dip
                </button>

                <button
                  onClick={clearSelected}
                  disabled={loadingRoster || bulkBusy}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-white transition hover:bg-white/[0.07] disabled:opacity-35"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {loadingRoster && sortedRows.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-[#151311] p-6 text-sm font-medium text-white/44">
              Loading roster...
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-[#151311] p-6 text-sm font-medium text-white/44">
              No bookings yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
              {sortedRows.map((r) => {
                const status = normalizeStatus(r);
                const isBusy = busyUserId === r.userId || bulkBusy;
                const isSelected = !!selected[r.userId];

                return (
                  <div
                    key={r.userId}
                    className={[
                      "group border-b border-white/10 px-4 py-4 last:border-b-0 transition hover:bg-white/[0.025]",
                      status === "dip" ? "bg-red-500/[0.04]" : "",
                      isBusy ? "opacity-55" : "",
                    ].join(" ")}
                  >
                    <div className="grid grid-cols-[1fr_auto] gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                      {selectMode && (
                        <button
                          type="button"
                          onClick={() => toggleSelected(r.userId)}
                          className={[
                            "grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                            isSelected ? "border-[#f2eee8] bg-[#f2eee8] text-black" : "border-white/12 bg-white/[0.03] text-white/30",
                          ].join(" ")}
                          aria-label="Select attendee"
                        >
                          {isSelected ? <Check className="h-4 w-4" /> : null}
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
                        <div className="truncate text-base font-extrabold text-white">{r.name ?? "Member"}</div>
                        <div className="mt-1 truncate text-sm font-medium text-white/38">{r.email ?? ""}</div>
                      </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {r.addedByAdmin && (
                            <span className="rounded-md bg-[#f2eee8] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                              Admin
                            </span>
                          )}
                          <StatusPill status={status} />
                        </div>
                        {!selectMode && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setStatus(r.userId, status === "checked_in" ? "booked" : "checked_in")}
                              disabled={isBusy}
                              className="grid h-9 w-9 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-35"
                              aria-label={status === "checked_in" ? "Uncheck member" : "Check in member"}
                            >
                              {status === "checked_in" ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => setStatus(r.userId, "authorised_absence")}
                              disabled={isBusy}
                              className="grid h-9 w-9 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-35"
                              aria-label="Mark authorised absence"
                            >
                              A
                            </button>
                            <button
                              onClick={() => setStatus(r.userId, "dip")}
                              disabled={isBusy}
                              className="grid h-9 w-9 place-items-center rounded-full text-white/30 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-35"
                              aria-label="Mark dip"
                            >
                              D
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <nav
        className="fixed inset-x-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: NavIcon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[56px] shrink-0 flex-col items-center gap-0.5 rounded-[14px] px-1.5 py-1 text-[10px] font-extrabold leading-tight transition",
                  isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
                ].join(" ")
              }
            >
              <NavIcon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {showAddMemberModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/72 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close add member"
            onClick={() => {
              setShowAddMemberModal(false);
              setSelectedUserId("");
              setAddMemberError("");
            }}
          />
          <div className="relative max-h-[86vh] w-full max-w-xl overflow-y-auto rounded-t-[32px] border border-white/10 bg-[#151311] p-5 shadow-[0_-24px_80px_rgba(0,0,0,0.55)] sm:max-w-2xl">
            <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-white/22" />
            <button
              type="button"
              onClick={() => {
                setShowAddMemberModal(false);
                setSelectedUserId("");
                setAddMemberError("");
              }}
              className="absolute right-5 top-12 z-20 grid h-12 w-12 place-items-center rounded-full bg-white/[0.08] text-white/72 transition hover:bg-white/[0.12] hover:text-white"
              aria-label="Close add member"
            >
              <X className="h-6 w-6" />
            </button>

            <div className="mb-7 pr-16">
              <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/38">
                Add member
              </p>
              <h2 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-white">Class roster</h2>
              <p className="mt-2 text-base font-medium text-white/40">Admin exception · {classTitle}</p>
            </div>

            <label className="mb-3 block text-[12px] font-bold uppercase tracking-[0.24em] text-white/34">Select member</label>

            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={addingMember}
              className="w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-4 text-white outline-none [color-scheme:dark] focus:border-white/22"
            >
              <option value="">Choose a member...</option>
              {addableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email ?? u.id}
                </option>
              ))}
            </select>

            {addableUsers.length === 0 && (
              <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/50">
                No additional members available to add.
              </div>
            )}

            {addMemberError ? (
              <div className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {addMemberError}
              </div>
            ) : null}

            <div className="mt-8 grid grid-cols-[0.9fr_1.4fr] gap-3 pb-2">
              <button
                onClick={() => {
                  setShowAddMemberModal(false);
                  setSelectedUserId("");
                  setAddMemberError("");
                }}
                disabled={addingMember}
                className="rounded-full border border-white/12 px-5 py-4 text-base font-bold text-white transition hover:bg-white/[0.05] disabled:opacity-35"
              >
                Cancel
              </button>

              <button
                onClick={handleAdminAddMember}
                disabled={addingMember || addableUsers.length === 0}
                className="rounded-full bg-[#f2eee8] px-5 py-4 text-base font-extrabold text-black transition hover:bg-white disabled:opacity-35"
              >
                {addingMember ? "Adding..." : "Add member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
