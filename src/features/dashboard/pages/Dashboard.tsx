// src/features/dashboard/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import UserTopNav from "../../../components/layout/UserTopNav";
import LogoutButton from "../../../components/ui/LogoutButton";
import {
  Flame,
  Dumbbell,
  PersonStanding,
  Award,
  Activity,
  CalendarDays,
  ChevronRight,
  Zap,
  Trophy,
  Timer,
  Share,
  Sun,
  Moon,
} from "lucide-react";
import SessionShareModal from "../../wod/components/SessionShareModal";

// ── Types ────────────────────────────────────────────────────────────────────

type BookingDoc = {
  classId: string;
  userId: string;
  status: "booked" | "cancelled";
  createdAt?: Timestamp;
};

type ClassDoc = {
  title: string;
  timezone?: string;
  startTime: Timestamp;
  endTime: Timestamp;
  coachName?: string;
  location?: string;
  capacity?: number;
  bookedCount?: number;
  status?: "scheduled" | "cancelled";
};

type ClassWithId = { id: string; data: ClassDoc };

type UserStats = {
  totalCheckIns?: number;
  monthCheckIns?: Record<string, number>;
  currentStreak?: number;
  longestStreak?: number;
};

type TrainingLog = {
  movementSlug: string;
  metricType: string;
  value: string;
  unit: string;
  date: string;
};

type PBs = {
  backSquat: string | null;
  flatBench: string | null;
  run1km: string | null;
};

type SessionKey = "AM" | "PM";

type SessionSharePayload = {
  title: string;
  subtitle?: string;
  filename: string;
  shareTitle: string;
  shareText: string;
  dateLabel: string;
  sessionLabel: string;
  sessionTimeLabel?: string;
  sessionType: string;
  sessionStyle: string;
  sessionExtra?: string;
  highlight: string;
  highlightLabel: string;
  stationsLabel: string;
  coachNote?: string;
  items: string[];
};

type DashboardSessionCard = {
  key: SessionKey;
  timeLabel: string;
  title: string;
  meta: string;
  detail: string;
  payload: SessionSharePayload | null;
};

type Movement = {
  id?: string;
  name: string;
  target?: string;
  notes?: string;
};

type Station = {
  id?: string;
  title: string;
  movements: Movement[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const TZ = "Europe/London";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(
      new Date()
    )
  );
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayKeyLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function monthKeyLondon(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

function datekeyLondon(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(d);
}

function fmtDayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  }).format(d);
}

function fmtTodayFull(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date());
}

function parseSeconds(value: string): number | null {
  const v = value.trim();
  if (v.includes(":")) {
    const [min, sec] = v.split(":").map(Number);
    if (Number.isFinite(min) && Number.isFinite(sec)) return min * 60 + sec;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function parseDurationToSeconds(duration: unknown): number | null {
  if (!duration || typeof duration !== "string") return null;
  const value = duration.trim();
  if (!value) return null;

  const parts = value.split(":").map((part) => part.trim());
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (Number.isFinite(mm) && Number.isFinite(ss)) return mm * 60 + ss;
  }

  const mins = value.match(/(\d+)\s*m/i);
  const secs = value.match(/(\d+)\s*s/i);
  const total = (mins ? Number(mins[1]) * 60 : 0) + (secs ? Number(secs[1]) : 0);
  return total > 0 ? total : null;
}

function normalizeMovements(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((movement) => {
      if (typeof movement === "string") return movement;
      if (movement && typeof movement === "object") {
        const value = (movement as { partner1?: string; movement?: string }).partner1
          ?? (movement as { movement?: string }).movement
          ?? "";
        return String(value);
      }
      return String(movement ?? "");
    })
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeStations(rawStations: unknown, rawMovements: unknown): Station[] {
  if (Array.isArray(rawStations) && rawStations.length) {
    return rawStations.map((station, index) => {
      const s = station as {
        id?: string;
        title?: string;
        movements?: Array<{ id?: string; name?: string; target?: string; notes?: string }>;
      };

      return {
        id: s.id,
        title: String(s.title ?? `Station ${index + 1}`).trim() || `Station ${index + 1}`,
        movements: (Array.isArray(s.movements) ? s.movements : [])
          .map((movement) => ({
            id: movement.id,
            name: String(movement.name ?? "").trim(),
            target: String(movement.target ?? "").trim() || undefined,
            notes: String(movement.notes ?? "").trim() || undefined,
          }))
          .filter((movement) => movement.name || movement.target || movement.notes),
      };
    });
  }

  const legacy = normalizeMovements(rawMovements);
  if (legacy.length) {
    return [
      {
        title: "Station 1",
        movements: legacy.map((name) => ({ name })),
      },
    ];
  }

  return [];
}

function getSessionTimeLabel(sessionKey: SessionKey) {
  return sessionKey === "AM" ? "6AM" : "6PM";
}

function getDashboardSessionPayload(
  wod: any,
  sessionKey: SessionKey,
  dateKey: string
): SessionSharePayload | null {
  if (!wod) return null;

  const selectedDate = new Date(dateKey);
  if (Number.isNaN(selectedDate.getTime())) return null;

  const dayName = selectedDate.toLocaleDateString("en-GB", { weekday: "long" });
  const dateLabel = selectedDate.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const sessionTimeLabel = getSessionTimeLabel(sessionKey);

  if (wod.sessionType === "Strength") {
    const movements = Array.isArray(wod.strengthMovements) ? wod.strengthMovements : [];
    const items = movements
      .map((movement: any) => {
        const name = String(movement?.movement ?? "").trim();
        const percent = String(movement?.percent ?? "").trim();
        const repRange = String(movement?.repRange ?? "").trim();
        const details = [percent, repRange].filter(Boolean).join(" • ");
        return name ? `${name}${details ? ` • ${details}` : ""}` : "";
      })
      .filter(Boolean);

    return {
      title: wod.wodName?.trim() || "Strength",
      subtitle: `${dayName} strength session`,
      filename: `${dateKey}-${sessionKey.toLowerCase()}-session.png`,
      shareTitle: `${sessionTimeLabel} session`,
      shareText: `Today's ${sessionTimeLabel.toLowerCase()} session is live: ${wod.wodName?.trim() || "Strength session"}`,
      dateLabel,
      sessionLabel: sessionKey,
      sessionTimeLabel,
      sessionType: "STRENGTH",
      sessionStyle: "STRENGTH",
      sessionExtra: `${movements.length || 0} STATIONS`,
      highlight: `${movements.length || 0}`,
      highlightLabel: "Stations",
      stationsLabel: `${movements.length || 0} strength stations`,
      coachNote: String(wod?.strengthCue ?? "").trim() || undefined,
      items,
    };
  }

  const stations = normalizeStations(wod?.stations, wod?.movements);
  const stationCount = stations.length;
  const timerMode = wod?.timerMode === "stationControlled" ? "stationControlled" : "timed";
  const groupSize = typeof wod?.groupSize === "number" && wod.groupSize > 0 ? wod.groupSize : null;
  const roundsRaw = wod?.rounds;
  const rounds =
    typeof roundsRaw === "number" && roundsRaw >= 1
      ? roundsRaw
      : typeof roundsRaw === "string" && roundsRaw.trim() && !Number.isNaN(Number(roundsRaw))
      ? Math.max(1, Math.floor(Number(roundsRaw)))
      : null;
  const roundDurationSeconds =
    typeof wod?.roundDurationSeconds === "number" && wod.roundDurationSeconds > 0
      ? wod.roundDurationSeconds
      : parseDurationToSeconds(wod?.duration);
  const controlStationIndex =
    typeof wod?.controlStationIndex === "number" && wod.controlStationIndex >= 0
      ? wod.controlStationIndex
      : null;
  const controlStationTitle =
    controlStationIndex != null ? stations[controlStationIndex]?.title ?? null : null;

  const items = stations
    .map((station, index) => {
      const title = (station.title || `Station ${index + 1}`).trim();
      const movementNames = station.movements
        .map((movement) => String(movement.name ?? "").trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" + ");
      return movementNames ? `${title} • ${movementNames}` : title;
    })
    .filter(Boolean);

  const highlight =
    timerMode === "timed"
      ? roundDurationSeconds && rounds
        ? `${formatSeconds(roundDurationSeconds)} x ${rounds}`
        : `${stationCount || 0}`
      : controlStationIndex != null
      ? `${controlStationIndex + 1}/${stationCount || 1}`
      : `${stationCount || 0}`;

  const highlightLabel =
    timerMode === "timed"
      ? "Timer"
      : controlStationIndex != null
      ? "Control"
      : "Stations";

  const sessionExtra =
    wod.sessionType === "HYROX"
      ? `${groupSize ? `GROUP OF ${groupSize}` : "GROUP"} | ${timerMode === "timed" ? "TIMED" : "STATION CONTROL"}`
      : "—";

  const stationsLabel =
    timerMode === "timed"
      ? `${stationCount || 0} stations • ${rounds || 1} rounds`
      : controlStationTitle
      ? `Control station: ${controlStationTitle}`
      : `${stationCount || 0} stations`;

  return {
    title: wod.wodName?.trim() || `${dayName} Session`,
    subtitle: `${dayName} HYROX session`,
    filename: `${dateKey}-${sessionKey.toLowerCase()}-session.png`,
    shareTitle: `${sessionTimeLabel} session`,
    shareText: `Today's ${sessionTimeLabel.toLowerCase()} session is live: ${wod.wodName?.trim() || "HYROX session"}`,
    dateLabel,
    sessionLabel: sessionKey,
    sessionTimeLabel,
    sessionType: "HYROX",
    sessionStyle: String(wod.wodType ?? "HYROX").toUpperCase(),
    sessionExtra,
    highlight,
    highlightLabel,
    stationsLabel,
    items,
  };
}

function typeMeta(title?: string) {
  const t = (title || "").toLowerCase();
  if (t.includes("hyrox"))
    return {
      label: "HYROX",
      stripe: "bg-yellow-500/80",
      icon: <Flame className="h-4 w-4" />,
      pill: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    };
  if (t.includes("strength"))
    return {
      label: "STRENGTH",
      stripe: "bg-sky-500/80",
      icon: <Dumbbell className="h-4 w-4" />,
      pill: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    };
  if (t.includes("bags"))
    return {
      label: "BAGS",
      stripe: "bg-red-500/80",
      icon: <Award className="h-4 w-4" />,
      pill: "border-red-500/30 bg-red-500/10 text-red-200",
    };
  if (t.includes("yoga"))
    return {
      label: "YOGA",
      stripe: "bg-teal-500/80",
      icon: <PersonStanding className="h-4 w-4" />,
      pill: "border-teal-500/30 bg-teal-500/10 text-teal-200",
    };
  if (t.includes("run club"))
    return {
      label: "RUN CLUB",
      stripe: "bg-orange-500/80",
      icon: <Activity className="h-4 w-4" />,
      pill: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    };
  return {
    label: (title || "SESSION").toUpperCase(),
    stripe: "bg-white/20",
    icon: <Zap className="h-4 w-4" />,
    pill: "border-white/15 bg-white/5 text-white/80",
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { appUser } = useAuth();
  const auth = getAuth();
  const isBanned = appUser?.role === "banned";

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [pbs, setPbs] = useState<PBs>({ backSquat: null, flatBench: null, run1km: null });
  const [bookedClasses, setBookedClasses] = useState<ClassWithId[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [todayProgramming, setTodayProgramming] = useState<Record<string, any> | null>(null);
  const [sharePayload, setSharePayload] = useState<SessionSharePayload | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Track auth user
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  // Fetch user stats once
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as { stats?: UserStats };
        setStats(data.stats ?? null);
      }
    });
  }, [user]);

  // Fetch PBs from trainingLogs subcollection
  useEffect(() => {
    if (!user) return;

    const logsRef = collection(db, "users", user.uid, "trainingLogs");

    async function fetchBest(slug: string, metricType: string, lowerIsBetter = false) {
      const snap = await getDocs(
        query(logsRef, where("movementSlug", "==", slug), where("metricType", "==", metricType))
      );
      let best: number | null = null;
      snap.docs.forEach((d) => {
        const log = d.data() as TrainingLog;
        const parsed = parseSeconds(log.value);
        if (parsed === null) return;
        if (best === null) { best = parsed; return; }
        if (lowerIsBetter ? parsed < best : parsed > best) best = parsed;
      });
      return best;
    }

    Promise.all([
      fetchBest("back-squat", "1RM"),
      fetchBest("flat-bench", "1RM"),
      fetchBest("1km-run", "Time Trial", true),
    ]).then(([backSquat, flatBench, run1km]) => {
      setPbs({
        backSquat: backSquat !== null ? `${backSquat} kg` : null,
        flatBench: flatBench !== null ? `${flatBench} kg` : null,
        run1km: run1km !== null ? formatSeconds(run1km) : null,
      });
    }).catch((e) => console.error("PB fetch error:", e));
  }, [user]);

  // Subscribe to active bookings, then fetch corresponding class docs
  useEffect(() => {
    if (!user) {
      setBookedClasses([]);
      setLoadingClasses(false);
      return;
    }

    const q = query(
      collection(db, "bookings"),
      where("userId", "==", user.uid),
      where("status", "==", "booked")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const classIds = snap.docs.map((d) => (d.data() as BookingDoc).classId).filter(Boolean);

      if (classIds.length === 0) {
        setBookedClasses([]);
        setLoadingClasses(false);
        return;
      }

      // Firestore "in" supports up to 30 per query
      const chunks: string[][] = [];
      for (let i = 0; i < classIds.length; i += 30) {
        chunks.push(classIds.slice(i, i + 30));
      }

      try {
        const results: ClassWithId[] = [];
        await Promise.all(
          chunks.map(async (chunk) => {
            const { documentId } = await import("firebase/firestore");
            const classSnap = await getDocs(
              query(collection(db, "classes"), where(documentId(), "in", chunk))
            );
            classSnap.docs.forEach((d) => {
              results.push({ id: d.id, data: d.data() as ClassDoc });
            });
          })
        );

        // Sort by startTime ascending, filter future / today only
        const now = Date.now();
        const upcoming = results
          .filter((c) => c.data.startTime.toDate().getTime() > now - 60 * 60 * 1000) // within last hour
          .sort((a, b) => a.data.startTime.toMillis() - b.data.startTime.toMillis());

        setBookedClasses(upcoming);
      } catch (e) {
        console.error("Dashboard class fetch error:", e);
      } finally {
        setLoadingClasses(false);
      }
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    const todayRef = doc(db, "wods", todayKeyLondon());
    return onSnapshot(
      todayRef,
      (snap) => setTodayProgramming(snap.exists() ? (snap.data() as Record<string, any>) : null),
      (error) => console.error("Dashboard programming fetch error:", error)
    );
  }, []);

  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";

  if (isBanned) {
    return (
      <div className="min-h-screen bg-black text-white overflow-x-hidden">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-12">
          <div className="w-full rounded-[2rem] border border-red-500/20 bg-gradient-to-br from-red-500/10 via-black to-black p-8 shadow-[0_0_60px_rgba(127,29,29,0.18)] sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-red-200">
              Account Suspended
            </div>

            <h1 className="mt-5 text-4xl font-heading uppercase tracking-[0.18em] text-white sm:text-5xl">
              Access paused
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-lg">
              Your account has been suspended for 7 days, due to not turning up to your booking on multiple occasions.
            </p>

            <div className="mt-8">
              <LogoutButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const todayKey = todayKeyLondon();
  const todayClasses = bookedClasses.filter(
    (c) => datekeyLondon(c.data.startTime.toDate()) === todayKey
  );
  const upcomingClasses = bookedClasses.filter(
    (c) => datekeyLondon(c.data.startTime.toDate()) !== todayKey
  );

  const thisMonthCount = stats?.monthCheckIns?.[monthKeyLondon()] ?? 0;
  const streak = stats?.currentStreak ?? 0;
  const total = stats?.totalCheckIns ?? 0;
  const sessionCards: DashboardSessionCard[] = (["AM", "PM"] as SessionKey[]).map((key) => {
    const payload = getDashboardSessionPayload(todayProgramming?.[key], key, todayKey);
    const emptyLabel = key === "AM" ? "6AM" : "6PM";

    if (!payload) {
      return {
        key,
        timeLabel: emptyLabel,
        title: "Coming soon",
        meta: "Programming not published yet",
        detail: "Check back later for today’s session.",
        payload: null,
      };
    }

    return {
      key,
      timeLabel: payload.sessionTimeLabel || emptyLabel,
      title: payload.title,
      meta: `${payload.sessionType} · ${payload.sessionStyle}`,
      detail: payload.stationsLabel,
      payload,
    };
  });

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <UserTopNav />

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* ── Greeting ────────────────────────────────────────── */}
        <div>
          <p className="text-white/40 text-sm uppercase tracking-widest font-semibold mb-1">
            {fmtTodayFull()}
          </p>
          <h1 className="text-5xl sm:text-6xl font-heading uppercase tracking-widest text-white leading-none">
            {greeting()},
          </h1>
          <h1 className="text-5xl sm:text-6xl font-heading uppercase tracking-widest text-white leading-none">
            {firstName}.
          </h1>
        </div>

        <section>
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/workouts"
              className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-white/[0.02] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/68">
                  <Dumbbell className="h-3.5 w-3.5" />
                  Training
                </div>
                <ChevronRight className="h-4 w-4 text-white/30 transition group-hover:text-white/70" />
              </div>
              <div className="mt-3 text-lg font-heading uppercase tracking-[-0.04em] text-white sm:text-xl">
                Log sessions
              </div>
            </Link>

            <Link
              to="/feed"
              className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-white/[0.02] p-4 transition hover:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/68">
                  <Share className="h-3.5 w-3.5" />
                  Feed
                </div>
                <ChevronRight className="h-4 w-4 text-white/30 transition group-hover:text-white/70" />
              </div>
              <div className="mt-3 text-lg font-heading uppercase tracking-[-0.04em] text-white sm:text-xl">
                Zero Alpha feed
              </div>
            </Link>
          </div>
        </section>

        {/* ── Today's Classes ─────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="h-4 w-4 text-white/40" />
            <h2 className="text-xs uppercase tracking-widest font-semibold text-white/40">
              Today's classes
            </h2>
          </div>

          {loadingClasses ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/40 text-sm">
              Loading…
            </div>
          ) : todayClasses.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-white/50 text-sm">No classes booked today.</p>
              <Link
                to="/schedule"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white transition"
              >
                View schedule <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {todayClasses.map(({ id, data }) => {
                const meta = typeMeta(data.title);
                const start = data.startTime.toDate();
                const end = data.endTime.toDate();
                return (
                  <div
                    key={id}
                    className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.04] to-white/[0.01] p-5 flex items-center gap-4"
                  >
                    <div className={`absolute left-0 top-0 h-full w-[4px] ${meta.stripe}`} />
                    <div
                      className={`shrink-0 h-10 w-10 rounded-xl border flex items-center justify-center ${meta.pill} pl-2`}
                    >
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1 pl-1">
                      <div className="text-base font-heading tracking-widest text-white">
                        {meta.label}
                      </div>
                      <div className="text-sm text-white/50 mt-0.5">
                        {fmtTime(start)}–{fmtTime(end)}
                        {data.coachName ? ` · ${data.coachName}` : ""}
                        {data.location ? ` · ${data.location}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                      Booked
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="h-4 w-4 text-white/40" />
            <h2 className="text-xs uppercase tracking-widest font-semibold text-white/40">
              Today&apos;s programming
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {sessionCards.map((session) => {
              const Icon = session.key === "AM" ? Sun : Moon;

              return (
                <div
                  key={session.key}
                  className="rounded-[26px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.04] to-white/[0.02] p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/72">
                      <Icon className="h-3 w-3" />
                      {session.timeLabel}
                    </div>
                    {session.payload ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSharePayload(session.payload);
                          setShareOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/82 transition hover:bg-white/[0.08]"
                      >
                        <Share className="h-3 w-3" />
                        Share
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 text-2xl font-heading uppercase tracking-[-0.04em] leading-[0.92] text-white">
                    {session.title}
                  </div>
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
                    {session.meta}
                  </div>
                  <div className="mt-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-2.5 text-[13px] leading-snug text-white/68">
                    {session.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Quick Stats ─────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-white/40" />
            <h2 className="text-xs uppercase tracking-widest font-semibold text-white/40">
              Your stats
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Streak", value: streak, suffix: streak === 1 ? "week" : "weeks", icon: <Flame className="h-5 w-5 text-orange-400" /> },
              { label: "This month", value: thisMonthCount, suffix: thisMonthCount === 1 ? "class" : "classes", icon: <CalendarDays className="h-5 w-5 text-sky-400" /> },
              { label: "All time", value: total, suffix: total === 1 ? "check-in" : "check-ins", icon: <Award className="h-5 w-5 text-emerald-400" /> },
            ].map(({ label, value, suffix, icon }) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 flex flex-col items-center text-center gap-1"
              >
                {icon}
                <div className="text-3xl font-heading tracking-wider text-white mt-1">{value}</div>
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold leading-tight">
                  {label}
                </div>
                <div className="text-[10px] text-white/30 leading-tight">{suffix}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Personal Bests ──────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-white/40" />
            <h2 className="text-xs uppercase tracking-widest font-semibold text-white/40">
              Personal bests
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { label: "Back Squat", sub: "1RM", value: pbs.backSquat, icon: <Dumbbell className="h-5 w-5 text-sky-400" />, link: "/training/strength/back-squat" },
              { label: "Flat Bench", sub: "1RM", value: pbs.flatBench, icon: <Dumbbell className="h-5 w-5 text-violet-400" />, link: "/training/strength/flat-bench" },
              { label: "1km Run", sub: "Time Trial", value: pbs.run1km, icon: <Timer className="h-5 w-5 text-orange-400" />, link: "/training/engine/1km-run" },
            ] as const).map(({ label, sub, value, icon, link }) => (
              <Link
                key={label}
                to={link}
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 flex flex-col items-center text-center gap-1 hover:bg-white/[0.08] transition"
              >
                {icon}
                <div className="text-2xl font-heading tracking-wider text-white mt-1">
                  {value ?? "—"}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold leading-tight">
                  {label}
                </div>
                <div className="text-[10px] text-white/30 leading-tight">{sub}</div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Upcoming Bookings ────────────────────────────────── */}
        {upcomingClasses.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-white/40" />
              <h2 className="text-xs uppercase tracking-widest font-semibold text-white/40">
                Upcoming
              </h2>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden divide-y divide-white/[0.06]">
              {upcomingClasses.slice(0, 5).map(({ id, data }) => {
                const meta = typeMeta(data.title);
                const start = data.startTime.toDate();
                const end = data.endTime.toDate();
                return (
                  <div key={id} className="flex items-center gap-4 px-5 py-4">
                    <div className={`shrink-0 w-1 self-stretch rounded-full ${meta.stripe}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-heading tracking-widest text-white">{meta.label}</div>
                      <div className="text-xs text-white/40 mt-0.5">
                        {fmtDayShort(start)} · {fmtTime(start)}–{fmtTime(end)}
                        {data.coachName ? ` · ${data.coachName}` : ""}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${meta.pill}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Schedule CTA ─────────────────────────────────────── */}
        <Link
          to="/schedule"
          className="flex items-center justify-between w-full rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition px-5 py-4 group"
        >
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-white/50 group-hover:text-white/80 transition" />
            <span className="text-sm font-semibold text-white/70 group-hover:text-white transition">
              View full schedule
            </span>
          </div>
          <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/60 transition" />
        </Link>

      </div>
      {sharePayload ? (
        <SessionShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={sharePayload.title}
          subtitle={sharePayload.subtitle}
          filename={sharePayload.filename}
          shareTitle={sharePayload.shareTitle}
          shareText={sharePayload.shareText}
          dateLabel={sharePayload.dateLabel}
          sessionLabel={sharePayload.sessionLabel}
          sessionTimeLabel={sharePayload.sessionTimeLabel}
          sessionType={sharePayload.sessionType}
          sessionStyle={sharePayload.sessionStyle}
          sessionExtra={sharePayload.sessionExtra}
          highlight={sharePayload.highlight}
          highlightLabel={sharePayload.highlightLabel}
          stationsLabel={sharePayload.stationsLabel}
          coachNote={sharePayload.coachNote}
          items={sharePayload.items}
        />
      ) : null}
    </div>
  );
}
