import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  Ticket,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  createPaygCheckoutAttemptId,
  createPaygCheckoutSession,
  getPublicPaygSchedule,
  paygErrorMessage,
  type PaygClass,
  type PublicPaygSchedule,
} from "../services/payg";

const LONDON_TZ = "Europe/London";
const FIELD =
  "mt-2 w-full rounded-xl border border-white/15 bg-black/35 px-4 py-3.5 text-[16px] text-white outline-none transition placeholder:text-white/55 focus:border-payg focus:ring-2 focus:ring-payg/25";

function asDate(value: string) {
  return new Date(value);
}

function formatTime(value: string, timezone = LONDON_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(asDate(value));
}

function formatLongDate(value: string, timezone = LONDON_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(asDate(value));
}

function formatDayHeading(value: string, timezone = LONDON_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(asDate(value));
}

function formatShortDate(value: string, timezone = LONDON_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(asDate(value));
}

function dayKey(value: string, timezone = LONDON_TZ) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(asDate(value));
  const part = (type: "year" | "month" | "day") =>
    parts.find((valuePart) => valuePart.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, 12));
}

function shiftDayKey(day: string, amount: number) {
  const value = calendarDate(day);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function weekKey(day: string) {
  const value = calendarDate(day);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  return shiftDayKey(day, -daysSinceMonday);
}

function sessionWeekKey(session: PaygClass) {
  return weekKey(dayKey(session.startTime, session.timezone));
}

function shortMonth(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(calendarDate(day));
}

function formatWeekRange(startDay: string, endDay: string) {
  const start = calendarDate(startDay);
  const end = calendarDate(endDay);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const startDate = start.getUTCDate();
  const endDate = end.getUTCDate();

  if (sameMonth) {
    return `${startDate}–${endDate} ${shortMonth(endDay)} ${end.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${startDate} ${shortMonth(startDay)}–${endDate} ${shortMonth(endDay)} ${end.getUTCFullYear()}`;
  }
  return `${startDate} ${shortMonth(startDay)} ${start.getUTCFullYear()}–${endDate} ${shortMonth(endDay)} ${end.getUTCFullYear()}`;
}

function formatPrice(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function adultDobMax() {
  const value = new Date();
  value.setFullYear(value.getFullYear() - 18);
  return value.toISOString().slice(0, 10);
}

function sessionAvailability(session: PaygClass) {
  if (session.availability === "full") return "Full";
  if (session.availability === "unavailable") return "Not available for PAYG";
  return `${session.spacesRemaining} ${session.spacesRemaining === 1 ? "space" : "spaces"} left`;
}

export default function PayAsYouGo() {
  const [schedule, setSchedule] = useState<PublicPaygSchedule | null>(null);
  const [selected, setSelected] = useState<PaygClass | null>(null);
  const [visibleWeekIndex, setVisibleWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [cancellationAccepted, setCancellationAccepted] = useState(false);
  const detailsRef = useRef<HTMLElement | null>(null);
  const attemptRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getPublicPaygSchedule()
      .then((result) => {
        if (!mounted) return;
        setSchedule(result);
      })
      .catch((error) => {
        if (!mounted) return;
        setLoadError(paygErrorMessage(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const weeks = useMemo(() => {
    const groups = new Map<string, Map<string, PaygClass[]>>();
    for (const session of schedule?.classes ?? []) {
      const sessionDay = dayKey(session.startTime, session.timezone);
      const sessionWeek = weekKey(sessionDay);
      const days = groups.get(sessionWeek) ?? new Map<string, PaygClass[]>();
      days.set(sessionDay, [...(days.get(sessionDay) ?? []), session]);
      groups.set(sessionWeek, days);
    }
    const populatedWeeks = Array.from(groups.keys()).sort();
    if (populatedWeeks.length === 0) return [];

    const result: Array<{
      key: string;
      endKey: string;
      days: Array<[string, PaygClass[]]>;
    }> = [];
    const lastWeek = populatedWeeks[populatedWeeks.length - 1];
    for (
      let key = populatedWeeks[0];
      key <= lastWeek;
      key = shiftDayKey(key, 7)
    ) {
      result.push({
        key,
        endKey: shiftDayKey(key, 6),
        days: Array.from(groups.get(key)?.entries() ?? []).sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      });
    }
    return result;
  }, [schedule?.classes]);

  useEffect(() => {
    setVisibleWeekIndex((index) => Math.min(index, Math.max(weeks.length - 1, 0)));
  }, [weeks.length]);

  const activeWeekIndex = Math.min(visibleWeekIndex, Math.max(weeks.length - 1, 0));
  const visibleWeek = weeks[activeWeekIndex] ?? null;

  const checkoutOpen = Boolean(
    schedule?.available && schedule.checkoutAvailable && schedule.legal
  );
  const allAccepted = adultConfirmed && waiverAccepted && termsAccepted && cancellationAccepted;

  function resetAttempt() {
    attemptRef.current = null;
    setSubmitError("");
  }

  function chooseSession(session: PaygClass) {
    if (session.availability !== "available") return;
    setSelected(session);
    resetAttempt();
  }

  function showWeek(index: number) {
    const nextIndex = Math.max(0, Math.min(index, weeks.length - 1));
    const nextWeek = weeks[nextIndex];
    if (!nextWeek || nextIndex === activeWeekIndex) return;
    if (selected && sessionWeekKey(selected) !== nextWeek.key) {
      setSelected(null);
    }
    resetAttempt();
    setVisibleWeekIndex(nextIndex);
  }

  function continueToDetails() {
    const details = detailsRef.current;
    if (!details) return;
    details.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => details.focus({ preventScroll: true }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !schedule?.legal || !checkoutOpen || !allAccepted) return;

    try {
      setSubmitting(true);
      setSubmitError("");
      const checkoutAttemptId =
        attemptRef.current ?? (attemptRef.current = createPaygCheckoutAttemptId());
      const result = await createPaygCheckoutSession({
        checkoutSchemaVersion: 1,
        checkoutAttemptId,
        classId: selected.classId,
        attendee: {
          fullName: fullName.trim(),
          dateOfBirth,
        },
        contact: {
          email: email.trim(),
          phone: phone.trim(),
        },
        acceptances: {
          adultConfirmed: true,
          waiverAccepted: true,
          termsAccepted: true,
          cancellationPolicyAccepted: true,
          waiverVersion: schedule.legal.waiver.version,
          termsVersion: schedule.legal.terms.version,
        },
      });
      window.location.assign(result.sessionUrl);
    } catch (error) {
      setSubmitError(paygErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <div className="carbon-fiber-bg min-h-screen bg-[#050505] font-barlow text-[#f4f0ea]">
      <header className="border-b border-white/10 bg-black/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-8">
          <Link
            to="/"
            aria-label="Zero Alpha home"
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-payg"
          >
            <img src="/ZERO-ALPHA.png" alt="Zero Alpha Fitness" className="h-16 w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-4 text-sm font-bold" aria-label="Public">
            <Link className="text-white/65 transition hover:text-white" to="/memberships">
              Memberships
            </Link>
            <Link className="text-payg transition hover:text-payg-hover" to="/">
              Member sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-36 pt-8 sm:px-8 lg:pb-20 lg:pt-12">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-12">
          <section aria-labelledby="payg-title">
            <div className="flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 id="payg-title" className="font-heading text-[3.15rem] uppercase leading-[0.92] text-white sm:text-7xl">
                  Choose your class
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-white/62">
                  The live weekly timetable is below. Pick one named session and pay
                  {schedule ? ` ${formatPrice(schedule.offering.amountPence)}` : " £7.50"}
                  —no account and no membership required.
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="font-heading text-4xl text-payg">£7.50</p>
                <p className="mt-1 text-sm font-bold text-white/60">one class · one attendee</p>
              </div>
            </div>

            <div className="mt-7">
              {loading ? (
                <div className="grid min-h-64 place-items-center rounded-2xl border border-white/10 bg-[#151311]">
                  <LoaderCircle className="h-7 w-7 animate-spin text-payg" aria-label="Loading timetable" />
                </div>
              ) : loadError ? (
                <div role="alert" className="rounded-2xl border border-red-400/25 bg-red-400/10 p-6 text-red-100">
                  <h2 className="font-heading text-3xl uppercase">Timetable unavailable</h2>
                  <p className="mt-3 text-sm leading-6 text-red-100/75">{loadError}</p>
                </div>
              ) : !schedule?.available ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-6 text-amber-50">
                  <h2 className="font-heading text-3xl uppercase">Not open yet</h2>
                  <p className="mt-3 text-sm leading-6 text-amber-50/75">
                    Pay As You Go is being prepared. Membership options are still available to view.
                  </p>
                </div>
              ) : weeks.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#151311] p-6">
                  <h2 className="font-heading text-3xl uppercase">No sessions listed</h2>
                  <p className="mt-3 text-sm leading-6 text-white/55">Check back when the next timetable is published.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {visibleWeek ? (
                    <nav
                      aria-label="Timetable weeks"
                      className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3 rounded-2xl border border-white/10 bg-[#151311] p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4"
                    >
                      <button
                        type="button"
                        disabled={activeWeekIndex === 0}
                        aria-label={activeWeekIndex === 0
                          ? "No previous timetable week"
                          : `Show previous week, ${formatWeekRange(weeks[activeWeekIndex - 1].key, weeks[activeWeekIndex - 1].endKey)}`}
                        onClick={() => showWeek(activeWeekIndex - 1)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-black text-white outline-none transition hover:border-white/30 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-payg disabled:cursor-not-allowed disabled:opacity-30 sm:px-4"
                      >
                        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                        <span className="hidden sm:inline">Previous</span>
                      </button>

                      <div className="min-w-0 text-center" aria-live="polite" aria-atomic="true">
                        <h2 className="font-heading text-2xl uppercase leading-none text-white sm:text-3xl">
                          {formatWeekRange(visibleWeek.key, visibleWeek.endKey)}
                        </h2>
                        <p className="mt-1.5 text-xs font-bold text-white/60">
                          Week {activeWeekIndex + 1} of {weeks.length}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={activeWeekIndex === weeks.length - 1}
                        aria-label={activeWeekIndex === weeks.length - 1
                          ? "No next timetable week"
                          : `Show next week, ${formatWeekRange(weeks[activeWeekIndex + 1].key, weeks[activeWeekIndex + 1].endKey)}`}
                        onClick={() => showWeek(activeWeekIndex + 1)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-black text-white outline-none transition hover:border-white/30 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-payg disabled:cursor-not-allowed disabled:opacity-30 sm:px-4"
                      >
                        <span className="hidden sm:inline">Next</span>
                        <ChevronRight className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </nav>
                  ) : null}

                  {visibleWeek?.days.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-[#151311] p-6">
                      <h2 className="font-heading text-3xl uppercase text-white">No sessions this week</h2>
                      <p className="mt-3 text-sm leading-6 text-white/60">
                        Use the week controls to view the next published sessions.
                      </p>
                    </div>
                  ) : null}

                  {visibleWeek?.days.map(([key, sessions]) => (
                    <section key={key} aria-labelledby={`day-${key}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 id={`day-${key}`} className="font-heading text-3xl uppercase text-white">
                          {formatDayHeading(sessions[0].startTime, sessions[0].timezone)}
                        </h3>
                        <span className="text-sm font-bold text-white/55">
                          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#11100f]">
                        {sessions.map((session) => {
                          const isSelected = selected?.classId === session.classId;
                          const canSelect = session.availability === "available";
                          return (
                            <button
                              key={session.classId}
                              type="button"
                              disabled={!canSelect}
                              aria-pressed={isSelected}
                              aria-label={`${formatTime(session.startTime, session.timezone)} ${session.title}, ${sessionAvailability(session)}${isSelected ? ", selected" : ""}`}
                              onClick={() => chooseSession(session)}
                              className={[
                                "group grid w-full grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/8 px-4 py-5 text-left outline-none transition last:border-b-0 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:px-5",
                                isSelected
                                  ? "bg-payg text-black"
                                  : canSelect
                                  ? "bg-transparent text-white hover:bg-white/[0.045] focus-visible:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-payg"
                                  : "cursor-not-allowed bg-black/20 text-white/35",
                              ].join(" ")}
                            >
                              <span className="font-heading text-2xl leading-none sm:text-3xl">
                                {formatTime(session.startTime, session.timezone)}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-base font-black sm:text-lg">{session.title}</span>
                                <span className={isSelected ? "mt-1 block truncate text-sm text-black/70" : "mt-1 block truncate text-sm text-white/60"}>
                                  {[session.coachName, session.location].filter(Boolean).join(" · ") || "Zero Alpha Fitness"}
                                </span>
                                <span className={[
                                  "mt-1.5 block text-xs font-black uppercase tracking-[0.06em] sm:hidden",
                                  isSelected ? "text-black/70" : canSelect ? "text-emerald-200" : "text-white/60",
                                ].join(" ")}>
                                  {sessionAvailability(session)}
                                </span>
                              </span>
                              <span className="flex items-center gap-3">
                                <span className={[
                                  "hidden text-right text-xs font-black uppercase tracking-[0.08em] sm:block",
                                  isSelected ? "text-black/70" : canSelect ? "text-emerald-200" : "text-white/60",
                                ].join(" ")}>
                                  {isSelected ? `Selected · ${sessionAvailability(session)}` : sessionAvailability(session)}
                                </span>
                                {isSelected ? (
                                  <span className="grid h-8 w-8 place-items-center rounded-full bg-black text-payg">
                                    <Check className="h-4 w-4" />
                                  </span>
                                ) : canSelect ? (
                                  <ArrowRight className="h-5 w-5 text-white/55 transition group-hover:translate-x-0.5 group-hover:text-payg" />
                                ) : (
                                  <LockKeyhole className="h-4 w-4 text-white/25" />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside
            ref={detailsRef}
            id="payg-details"
            tabIndex={-1}
            className="scroll-mt-6 outline-none lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
          >
            <div className="overflow-hidden rounded-2xl border border-payg/30 bg-[#151311] shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
              <div className="flex items-center justify-between border-b border-dashed border-white/18 bg-payg px-5 py-4 text-black">
                <span className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em]">
                  <Ticket className="h-4 w-4" /> Your class ticket
                </span>
                <span className="font-heading text-3xl">£7.50</span>
              </div>

              <div className="p-5 sm:p-6">
                {selected ? (
                  <div aria-live="polite">
                    <p className="font-heading text-3xl uppercase leading-none text-white">{selected.title}</p>
                    <div className="mt-4 space-y-2 text-sm text-white/65">
                      <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 text-payg" /> {formatLongDate(selected.startTime, selected.timezone)}</p>
                      <p className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 text-payg" /> {formatTime(selected.startTime, selected.timezone)}–{formatTime(selected.endTime, selected.timezone)}</p>
                      <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-payg" /> {selected.location || "Zero Alpha Fitness"}</p>
                      <p className="flex items-start gap-2"><UsersRound className="mt-0.5 h-4 w-4 text-payg" /> {sessionAvailability(selected)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-2">
                    <p className="font-heading text-3xl uppercase leading-none text-white">Select a session</p>
                    <p className="mt-3 text-sm leading-6 text-white/52">
                      Choose an available row to pin its date, time and location to this ticket.
                    </p>
                  </div>
                )}

                <div className="my-6 border-t border-dashed border-white/16" />

                <ul className="space-y-3 text-sm leading-6 text-white/60">
                  <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-payg" /> Payment is for this named class, not a reusable credit.</li>
                  <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-payg" /> The booking cannot be transferred or rescheduled.</li>
                  <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-payg" /> Cancellations inside 24 hours and no-shows are non-refundable.</li>
                </ul>

                {!checkoutOpen ? (
                  <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50/80">
                    <p className="font-black text-amber-100">Checkout not open yet</p>
                    <p className="mt-1">You can view the timetable, but online PAYG purchase remains closed while the release checks are completed.</p>
                  </div>
                ) : selected ? (
                  <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                    <div>
                      <h2 className="font-heading text-3xl uppercase text-white">Attendee details</h2>
                      <p className="mt-2 text-sm leading-6 text-white/50">Adult guests only. No account will be created.</p>
                    </div>

                    <label className="block text-sm font-bold text-white/75">
                      Full name
                      <input required autoComplete="name" value={fullName} onChange={(event) => { setFullName(event.target.value); resetAttempt(); }} className={FIELD} />
                    </label>
                    <label className="block text-sm font-bold text-white/75">
                      Date of birth
                      <input required type="date" max={adultDobMax()} value={dateOfBirth} onChange={(event) => { setDateOfBirth(event.target.value); resetAttempt(); }} className={`${FIELD} [color-scheme:dark]`} />
                    </label>
                    <label className="block text-sm font-bold text-white/75">
                      Email
                      <input required type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); resetAttempt(); }} className={FIELD} />
                    </label>
                    <label className="block text-sm font-bold text-white/75">
                      Mobile number
                      <input required type="tel" autoComplete="tel" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+447700900000" value={phone} onChange={(event) => { setPhone(event.target.value); resetAttempt(); }} className={FIELD} />
                      <span className="mt-2 block text-xs font-normal leading-5 text-white/60">Include the country code, for example +44.</span>
                    </label>

                    <fieldset className="space-y-3 border-t border-white/10 pt-5">
                      <legend className="font-heading text-2xl uppercase text-white">Confirm before payment</legend>
                      <Acceptance checked={adultConfirmed} onChange={(value) => { setAdultConfirmed(value); resetAttempt(); }}>
                        I confirm I am the named attendee and I am aged 18 or over.
                      </Acceptance>
                      <Acceptance checked={waiverAccepted} onChange={(value) => { setWaiverAccepted(value); resetAttempt(); }}>
                        I have read and accept the <a className="font-bold text-payg underline underline-offset-4" href={schedule?.legal?.waiver.publicUrl} target="_blank" rel="noreferrer">adult participant waiver</a>.
                      </Acceptance>
                      <Acceptance checked={termsAccepted} onChange={(value) => { setTermsAccepted(value); resetAttempt(); }}>
                        I have read and accept the <a className="font-bold text-payg underline underline-offset-4" href={schedule?.legal?.terms.publicUrl} target="_blank" rel="noreferrer">Pay As You Go terms</a>.
                      </Acceptance>
                      <Acceptance checked={cancellationAccepted} onChange={(value) => { setCancellationAccepted(value); resetAttempt(); }}>
                        I understand this class cannot be transferred or rescheduled, and cancellations made less than 24 hours before it starts or a no-show are non-refundable.
                      </Acceptance>
                    </fieldset>

                    {submitError ? <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-100">{submitError}</p> : null}

                    <button
                      type="submit"
                      disabled={submitting || !allAccepted}
                      className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-payg px-5 py-3.5 text-base font-black text-black outline-none transition hover:bg-payg-hover focus-visible:ring-2 focus-visible:ring-payg focus-visible:ring-offset-2 focus-visible:ring-offset-[#151311] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                      {submitting ? "Opening Stripe…" : "Reserve and pay £7.50"}
                    </button>
                    <p className="flex items-center justify-center gap-2 text-center text-xs leading-5 text-white/55"><LockKeyhole className="h-3.5 w-3.5" /> Secure payment is completed on Stripe.</p>
                  </form>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {selected ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#11100f]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_50px_rgba(0,0,0,0.45)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white">
                {formatShortDate(selected.startTime, selected.timezone)} · {formatTime(selected.startTime, selected.timezone)}
              </p>
              <p className="mt-0.5 truncate text-xs text-white/60">{selected.title} · £7.50</p>
            </div>
            <button
              type="button"
              aria-controls="payg-details"
              onClick={continueToDetails}
              className="shrink-0 rounded-xl bg-payg px-4 py-3 text-sm font-black text-black outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Acceptance({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/25 p-3.5 text-sm leading-6 text-white/65 transition hover:border-white/20 focus-within:border-payg focus-within:ring-2 focus-within:ring-payg/20">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-payg"
      />
      <span>{children}</span>
    </label>
  );
}
