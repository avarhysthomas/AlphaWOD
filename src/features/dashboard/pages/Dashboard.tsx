// src/features/dashboard/pages/Dashboard.tsx
import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
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
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import LogoutButton from "../../../components/ui/LogoutButton";
import {
  Flame,
  Dumbbell,
  PersonStanding,
  Award,
  Activity,
  Zap,
  Share,
  Sun,
  Moon,
  Bell,
  Newspaper,
  FileText,
  Percent,
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

function capacityPercent(bookedCount?: number, capacity?: number) {
  const cap = Number(capacity ?? 0);
  if (!cap || cap <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(bookedCount ?? 0) / cap) * 100));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { appUser } = useAuth();
  const auth = getAuth();
  const isBanned = appUser?.role === "banned";

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [bookedClasses, setBookedClasses] = useState<ClassWithId[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [todayProgramming, setTodayProgramming] = useState<Record<string, any> | null>(null);
  const [sharePayload, setSharePayload] = useState<SessionSharePayload | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [calculatorWeight, setCalculatorWeight] = useState("");
  const [percentageInput, setPercentageInput] = useState("75");

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
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  if (isBanned) {
    return (
      <div className="carbon-fiber-bg min-h-screen text-white overflow-x-hidden">
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

  const nextUp = todayClasses[0] ?? upcomingClasses[0] ?? null;
  const nextUpMeta = nextUp ? typeMeta(nextUp.data.title) : null;
  const nextUpStart = nextUp?.data.startTime.toDate();
  const nextUpEnd = nextUp?.data.endTime.toDate();
  const nextUpCapacity = Number(nextUp?.data.capacity ?? 0);
  const nextUpBooked = Number(nextUp?.data.bookedCount ?? 0);
  const nextUpProgress = capacityPercent(nextUpBooked, nextUpCapacity);
  const hasNextUpToday = Boolean(
    nextUpStart && datekeyLondon(nextUpStart) === todayKey
  );
  const navItems = getUserNavItems(appUser?.role);
  const percentagePresets = [50, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  const enteredWeight = Number.parseFloat(calculatorWeight);
  const selectedPercentage = Number.parseFloat(percentageInput);
  const calculatedLoad =
    Number.isFinite(enteredWeight) && enteredWeight > 0 && Number.isFinite(selectedPercentage)
      ? enteredWeight * (selectedPercentage / 100)
      : 0;
  const roundedLoad = calculatedLoad ? Math.round(calculatedLoad / 2.5) * 2.5 : 0;

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-32 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img
              src="/ZERO-ALPHA.png"
              alt="ZERO-ALPHA"
              className="h-20 w-auto object-contain"
            />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-5 w-5" />
            </button>
            <Link
              to="/profile"
              aria-label="Profile"
              className="grid h-12 w-12 overflow-hidden rounded-full border border-[#8b725b]/60 bg-[#765f4b] text-sm font-bold uppercase text-[#f8efe5] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
            >
              {profilePhotoURL ? (
                <img
                  src={profilePhotoURL}
                  alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  {firstName.slice(0, 1)}
                </span>
              )}
            </Link>
          </div>
        </header>

        <section className="mt-12 sm:mt-16">
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
            {fmtTodayFull()}
          </p>
          <h1 className="mt-6 max-w-[12ch] font-heading text-[4rem] uppercase leading-[0.98] tracking-[0.01em] text-white sm:text-[5.7rem]">
            {greeting()}, {firstName}.
          </h1>
        </section>

        <section className="mt-10">
          {loadingClasses ? (
            <div className="rounded-[28px] border border-white/10 bg-[#151311] p-7 text-sm text-white/45">
              Loading your next session...
            </div>
          ) : nextUp && nextUpMeta && nextUpStart && nextUpEnd ? (
            <div className="rounded-[28px] border border-white/10 bg-[#151311] p-7 shadow-[0_26px_80px_rgba(0,0,0,0.42)]">
              <div className="flex items-start justify-between gap-4">
                <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                  Next up {hasNextUpToday ? "- today" : `- ${fmtDayShort(nextUpStart)}`}
                </p>
                <span className="rounded-full bg-emerald-400/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-emerald-200">
                  Booked
                </span>
              </div>

              <div className="mt-7 flex items-end gap-3">
                <div className="font-heading text-[4.55rem] leading-[0.88] tracking-[0.02em] text-white">
                  {fmtTime(nextUpStart)}
                </div>
                <div className="pb-2 text-lg font-semibold text-white/35">
                  - {fmtTime(nextUpEnd)}
                </div>
              </div>

              <div className="mt-3 font-heading text-4xl uppercase leading-none tracking-[0.02em] text-white">
                {nextUpMeta.label}
              </div>
              <p className="mt-6 text-[15px] text-white/48">
                {[nextUp.data.coachName, nextUp.data.location].filter(Boolean).join(" · ") || "AlphaFIT"}
              </p>

              <div className="mt-8">
                <div className="mb-3 flex items-center justify-between text-[12px] font-bold uppercase tracking-[0.18em] text-white/38">
                  <span>Capacity</span>
                  <span>
                    {nextUpBooked} / {nextUpCapacity || "-"}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[#f2eee8]"
                    style={{ width: `${nextUpProgress || 10}%` }}
                  />
                </div>
              </div>

            </div>
          ) : (
            <div className="rounded-[28px] border border-white/10 bg-[#151311] p-7">
              <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                Next up
              </p>
              <div className="mt-6 font-heading text-5xl uppercase leading-none text-white">
                No booking
              </div>
              <p className="mt-4 text-[15px] leading-6 text-white/50">
                Find a class for the week and lock it in.
              </p>
              <Link
                to="/schedule"
                className="mt-7 inline-flex rounded-full bg-[#f2eee8] px-6 py-4 text-sm font-bold text-black"
              >
                View schedule
              </Link>
            </div>
          )}
        </section>

        <section className="mt-5 grid grid-cols-2 gap-4">
          <Link
            to="/workouts"
            className="group rounded-[20px] border border-white/10 bg-[#151311] p-5 transition hover:bg-[#1b1815]"
          >
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.06] text-white/52">
              <FileText className="h-5 w-5" />
            </div>
            <div className="mt-7 text-[17px] font-bold text-white">Log session</div>
            <div className="mt-1 text-sm text-white/35">{thisMonthCount} this month</div>
          </Link>
          <Link
            to="/feed"
            className="group rounded-[20px] border border-white/10 bg-[#151311] p-5 transition hover:bg-[#1b1815]"
          >
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.06] text-white/52">
              <Newspaper className="h-5 w-5" />
            </div>
            <div className="mt-7 text-[17px] font-bold text-white">Feed</div>
            <div className="mt-1 text-sm text-white/35">Latest posts</div>
          </Link>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
              Programming
            </p>
            <Link to="/schedule" className="text-sm font-bold text-white/64">
              View all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {sessionCards.map((session) => {
              const Icon = session.key === "AM" ? Sun : Moon;
              return (
                <article
                  key={session.key}
                  className="rounded-[24px] border border-white/10 bg-[#151311] p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em] text-white/42">
                      <Icon className="h-4 w-4" />
                      {session.timeLabel}
                    </div>
                    {session.payload ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSharePayload(session.payload);
                          setShareOpen(true);
                        }}
                        aria-label={`Share ${session.timeLabel} programming`}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        <Share className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-7 font-heading text-4xl uppercase leading-none text-white">
                    {session.title}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-white/45">{session.detail}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-10 overflow-hidden rounded-[24px] border border-white/10 bg-[#151311] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                Percentage calculator
              </p>
              <p className="mt-2 text-sm font-medium text-white/38">
                Work out a percentage of any weight.
              </p>
            </div>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/52">
              <Percent className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[1fr_104px] gap-3">
            <label className="block">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                Weight
              </span>
              <input
                value={calculatorWeight}
                onChange={(event) => setCalculatorWeight(event.target.value)}
                inputMode="decimal"
                placeholder="e.g. 100"
                className="w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-4 font-mono text-xl font-bold text-white outline-none placeholder:text-white/20 focus:border-white/22"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                %
              </span>
              <input
                value={percentageInput}
                onChange={(event) => setPercentageInput(event.target.value)}
                inputMode="decimal"
                placeholder="75"
                className="w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-4 text-center font-mono text-xl font-bold text-white outline-none placeholder:text-white/20 focus:border-white/22"
              />
            </label>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {percentagePresets.map((preset) => {
              const isActive = Number(percentageInput) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPercentageInput(String(preset))}
                  className={[
                    "shrink-0 rounded-full border px-3.5 py-2 font-mono text-sm font-bold transition",
                    isActive
                      ? "border-white/20 bg-white/[0.10] text-white"
                      : "border-white/10 bg-transparent text-white/36 hover:text-white/70",
                  ].join(" ")}
                >
                  {preset}%
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-[20px] border border-white/10 bg-black/18 p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
              Target load
            </div>
            <div className="mt-3 flex items-end gap-2">
              <div className="font-mono text-[3.4rem] font-bold leading-none text-white">
                {roundedLoad ? roundedLoad.toFixed(roundedLoad % 1 === 0 ? 0 : 1) : "--"}
              </div>
              <div className="pb-2 text-sm font-bold uppercase tracking-[0.12em] text-white/38">
                kg
              </div>
            </div>
          </div>
        </section>

      </main>

      <nav
        className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-[28px] border border-white/45 bg-white/90 px-3 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:max-w-2xl"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: Icon, danger, adminOnly }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2 py-2 text-[11px] font-bold transition",
                  isActive
                    ? "bg-black/10 text-black"
                    : "text-black hover:bg-black/5",
                  danger && !isActive ? "text-black" : "",
                  adminOnly && !isActive ? "text-black" : "",
                ].join(" ")
              }
            >
              <Icon className="h-5 w-5 text-black" />
              <span className="max-w-full truncate">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
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
