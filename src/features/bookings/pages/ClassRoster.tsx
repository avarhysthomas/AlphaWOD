import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasAlphaWodAccess } from "../../../context/authUser";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  Ban,
  Bell,
  Check,
  LockKeyhole,
  Plus,
  ReceiptText,
  RefreshCcw,
  TriangleAlert,
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
import {
  beginClassCancellation,
  finalizeClassCancellation,
  type ClassCancellationPaygGuest,
  type ClassCancellationResult,
  type ClassCancellationState,
} from "../services/classCancellation";

type BookingStatus = "booked" | "checked_in" | "authorised_absence" | "dip";

type AttendanceStatus = "none" | "checked_in" | "dip";

type BookingRow = {
  bookingId?: string;
  bookingKind?: "member" | "payg_guest";
  isGuestBooking?: boolean;
  paygOrderId?: string;
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

type ClassControl = {
  status: "scheduled" | "cancelled";
  bookingOpen: boolean;
  bookingClosedReason?: string;
  cancellationOperationId?: string;
  cancellationState?: ClassCancellationState;
};

type GymUser = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  approvalStatus?: "approved" | "pending";
  entitlementStatus?: "none" | "active" | "restricted";
  alphaWodAccess?: boolean;
};

function normalizeStatus(r: BookingRow): BookingStatus {
  if (r.attendanceStatus === "dip") return "dip";
  if (r.attendanceStatus === "checked_in") return "checked_in";
  if (r.attended === true) return "checked_in";
  return "booked";
}

function StatusPill({ status, guest = false }: { status: BookingStatus; guest?: boolean }) {
  const base =
    "text-[10px] uppercase tracking-[0.16em] px-2.5 py-1 rounded-md inline-flex items-center gap-2 font-black";

  if (status === "checked_in") {
    return <span className={`${base} bg-emerald-300 text-black`}>In</span>;
  }

  if (status === "dip") {
    return <span className={`${base} bg-red-400/90 text-black`}>{guest ? "No show" : "Dip"}</span>;
  }

  if (status === "authorised_absence") {
    return <span className={`${base} bg-sky-300 text-black`}>Auth</span>;
  }

  return <span className={`${base} bg-white/[0.08] text-white/58`}>Booked</span>;
}

function cancellationStateLabel(
  state: ClassCancellationState | undefined,
  bookingOpen: boolean,
  status: ClassControl["status"]
) {
  if (status === "cancelled" || state === "cancelled") return "Class cancelled";
  if (state === "ready_to_finalize") return "Ready to finalize";
  if (state === "awaiting_payg_refunds") return "Refunds outstanding";
  if (state === "processing") return "Reconciliation in progress";
  if (!bookingOpen) return "Bookings frozen";
  return "Bookings open";
}

function formatCancellationMoney(amountPence: number, currency: string) {
  const normalizedCurrency = String(currency || "GBP").toUpperCase();
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(Number(amountPence || 0) / 100);
  } catch {
    return `${normalizedCurrency} ${(Number(amountPence || 0) / 100).toFixed(2)}`;
  }
}

function readableCancellationBlocker(value: string) {
  return value.replace(/_/g, " ");
}

function cancellationBlockerMessages(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map(readableCancellationBlocker);
  }
  if (!value || typeof value !== "object") return [];

  const blockers = value as Record<string, unknown>;
  const messages: string[] = [];
  const addCount = (key: string, label: string) => {
    const count = blockers[key];
    if (typeof count === "number" && count > 0) messages.push(`${label}: ${count}`);
  };
  const addIds = (key: string, label: string) => {
    const ids = Array.isArray(blockers[key])
      ? (blockers[key] as unknown[]).filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [];
    if (ids.length > 0) messages.push(`${label}: ${ids.join(", ")}`);
  };

  addCount("activeBookingCount", "Active bookings");
  addCount("activeMemberBookingCount", "Active member bookings");
  addCount("activePaygBookingCount", "Active PAYG bookings");
  addCount("malformedActiveBookingCount", "Malformed active bookings");
  if (blockers.bookedCount === null) messages.push("Class booked count is invalid");
  else addCount("bookedCount", "Class booked count");
  if (blockers.unpaidHoldCount === null) messages.push("PAYG unpaid hold count is invalid");
  else addCount("unpaidHoldCount", "PAYG unpaid holds");
  addIds("activePaygIntentIds", "Active PAYG intents");
  addIds("unreleasedPaygIntentIds", "Unreleased PAYG intents");
  addIds("activePaygLockIds", "Active PAYG capacity locks");
  addIds("unresolvedPaymentReviewIds", "Unresolved payment reviews");
  addIds("unresolvedPaygOrderIds", "Unresolved PAYG orders");
  addIds("unboundPaygOrderIds", "Unbound PAYG orders");
  addIds("unresolvedConfirmationOrderIds", "Unresolved PAYG confirmations");
  addIds("malformedPaygOrderIds", "Malformed PAYG orders");
  return messages;
}

function confirmationDispositionLabel(
  disposition: ClassCancellationPaygGuest["confirmationDisposition"]
) {
  switch (disposition) {
    case "suppressed_before_send":
      return "Suppressed before send";
    case "accepted_before_change":
      return "Original confirmation accepted before cancellation";
    case "accepted_after_change_corrected":
      return "Late confirmation accepted; correction sent";
    case "accepted_after_change_unresolved":
      return "Late confirmation accepted; correction unresolved";
    default:
      return "Provider outcome ambiguous";
  }
}

function safePaygReferences(value: unknown): ClassCancellationPaygGuest[] | null {
  if (!Array.isArray(value)) return null;
  const references: ClassCancellationPaygGuest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.orderId !== "string" ||
      (candidate.bookingId !== null && typeof candidate.bookingId !== "string") ||
      (candidate.paymentIntentId !== null && typeof candidate.paymentIntentId !== "string") ||
      (candidate.chargeId !== null && typeof candidate.chargeId !== "string") ||
      (candidate.refundId !== null && typeof candidate.refundId !== "string") ||
      typeof candidate.orderStatus !== "string" ||
      (candidate.refundStatus !== null && typeof candidate.refundStatus !== "string") ||
      typeof candidate.amountPence !== "number" ||
      typeof candidate.currency !== "string" ||
      typeof candidate.confirmationSuppressed !== "boolean" ||
      typeof candidate.confirmationResolved !== "boolean" ||
      ![
        "suppressed_before_send",
        "accepted_before_change",
        "accepted_after_change_corrected",
        "accepted_after_change_unresolved",
        "ambiguous",
      ].includes(String(candidate.confirmationDisposition))
    ) {
      continue;
    }
    references.push({
      orderId: candidate.orderId,
      bookingId: candidate.bookingId,
      paymentIntentId: candidate.paymentIntentId,
      chargeId: candidate.chargeId,
      refundId: candidate.refundId,
      orderStatus: candidate.orderStatus,
      refundStatus: candidate.refundStatus,
      amountPence: candidate.amountPence,
      currency: candidate.currency,
      confirmationSuppressed: candidate.confirmationSuppressed,
      confirmationResolved: candidate.confirmationResolved,
      confirmationDisposition:
        candidate.confirmationDisposition as ClassCancellationPaygGuest["confirmationDisposition"],
    });
  }
  return references;
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

  const [classControl, setClassControl] = useState<ClassControl | null>(null);
  const [loadingClassControl, setLoadingClassControl] = useState(true);
  const [classControlError, setClassControlError] = useState("");
  const [cancellationResult, setCancellationResult] = useState<ClassCancellationResult | null>(null);
  const [cancellationBusy, setCancellationBusy] = useState<"begin" | "resume" | "finalize" | null>(null);
  const [cancellationError, setCancellationError] = useState("");
  const [cancellationBlockers, setCancellationBlockers] = useState<string[]>([]);
  const [confirmingCancellation, setConfirmingCancellation] = useState<"begin" | "finalize" | null>(null);
  const cancellationActionLock = useRef(false);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );
  const selectedHasGuest = useMemo(
    () => selectedIds.some((id) => rows.find((row) => row.userId === id)?.isGuestBooking),
    [rows, selectedIds]
  );

  const toggleSelected = useCallback((uid: string) => {
    setSelected((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }, []);

  const clearSelected = useCallback(() => setSelected({}), []);

  const loadClassControl = useCallback(async () => {
    if (!classId) return;

    setLoadingClassControl(true);
    setClassControlError("");
    try {
      const snap = await getDoc(doc(db, "classes", classId));
      if (!snap.exists()) {
        setClassControl(null);
        setClassControlError("This class could not be found. Cancellation controls are disabled.");
        return;
      }

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
      setClassControl({
        status: d.status === "cancelled" ? "cancelled" : "scheduled",
        bookingOpen: d.bookingOpen !== false,
        bookingClosedReason:
          typeof d.bookingClosedReason === "string" ? d.bookingClosedReason : undefined,
        cancellationOperationId:
          typeof d.cancellationOperationId === "string" ? d.cancellationOperationId : undefined,
        cancellationState: [
          "processing",
          "awaiting_payg_refunds",
          "ready_to_finalize",
          "cancelled",
        ].includes(d.cancellationState)
          ? d.cancellationState
          : undefined,
      });
    } catch (error) {
      console.error("Class control error:", error);
      setClassControl(null);
      setClassControlError(
        "We couldn’t verify the class state. Cancellation and roster changes are disabled until you retry."
      );
    } finally {
      setLoadingClassControl(false);
    }
  }, [classId]);

  useEffect(() => {
    void loadClassControl();
  }, [loadClassControl]);

  useEffect(() => {
    if (!showAddMemberModal || allUsersLoaded) return;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        const users: GymUser[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<GymUser, "id">),
        })).filter(hasAlphaWodAccess);

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

  const canManageCancellation = appUser?.role === "admin";
  const cancellationState =
    cancellationResult?.operation.state ?? classControl?.cancellationState;
  const cancellationStarted = Boolean(
    cancellationState ||
      classControl?.cancellationOperationId ||
      classControl?.bookingClosedReason === "class_cancellation"
  );
  const classMutationsFrozen =
    loadingClassControl ||
    Boolean(cancellationBusy) ||
    Boolean(classControlError) ||
    classControl?.bookingOpen === false ||
    classControl?.status === "cancelled";

  const applyCancellationResult = useCallback((result: ClassCancellationResult) => {
    setCancellationResult(result);
    setShowAddMemberModal(false);
    setSelectMode(false);
    setSelected({});
    setClassControl((current) => ({
      status:
        result.alreadyFinalized || result.operation.state === "cancelled"
          ? "cancelled"
          : current?.status ?? "scheduled",
      bookingOpen: false,
      bookingClosedReason: "class_cancellation",
      cancellationOperationId: result.operation.id,
      cancellationState: result.operation.state,
    }));
  }, []);

  async function handleBeginCancellation(mode: "begin" | "resume") {
    if (!classId || cancellationBusy || cancellationActionLock.current || !canManageCancellation) return;
    if (!auth.currentUser) {
      setCancellationError("Log in as an administrator before changing this class.");
      return;
    }

    cancellationActionLock.current = true;
    setConfirmingCancellation(null);
    setCancellationBusy(mode);
    setCancellationError("");
    setCancellationBlockers([]);
    try {
      const result = await beginClassCancellation({ classId });
      applyCancellationResult(result);
      await Promise.all([loadClassControl(), loadRoster()]);
    } catch (error: any) {
      console.error("Begin class cancellation error:", error);
      // The callable freezes bookings before it releases/reconciles records.
      // A transport error is therefore ambiguous: hold the UI closed until an
      // authoritative class re-read proves whether the first phase committed.
      setClassControl((current) =>
        current
          ? {
              ...current,
              bookingOpen: false,
              bookingClosedReason: "class_cancellation",
              cancellationState: current.cancellationState ?? "processing",
            }
          : current
      );
      setCancellationError(
        error?.code === "permission-denied"
          ? "Your admin permission could not be verified. No class changes were made."
          : error?.message ||
              "The cancellation could not be started. Bookings may already be frozen; retry to resume safely."
      );
      await Promise.all([loadClassControl(), loadRoster()]);
    } finally {
      cancellationActionLock.current = false;
      setCancellationBusy(null);
    }
  }

  async function handleFinalizeCancellation() {
    if (!classId || cancellationBusy || cancellationActionLock.current || !canManageCancellation) return;
    if (!auth.currentUser) {
      setCancellationError("Log in as an administrator before changing this class.");
      return;
    }

    cancellationActionLock.current = true;
    setConfirmingCancellation(null);
    setCancellationBusy("finalize");
    setCancellationError("");
    setCancellationBlockers([]);
    try {
      const result = await finalizeClassCancellation({ classId });
      applyCancellationResult(result);
      await Promise.all([loadClassControl(), loadRoster()]);
    } catch (error: any) {
      console.error("Finalize class cancellation error:", error);
      const details = error?.details ?? {};
      const blockers = cancellationBlockerMessages(details.blockers);
      const latestPaygGuests = safePaygReferences(details.paygGuests);
      if (latestPaygGuests) {
        setCancellationResult((current) =>
          current ? { ...current, paygGuests: latestPaygGuests } : current
        );
      }
      setCancellationBlockers(blockers);
      setCancellationError(
        details.reason === "class_cancellation_not_ready"
          ? "Cancellation cannot be finalized yet. Resolve every blocker, then resume reconciliation."
          : error?.message ||
              "The class was not finalized. Resume reconciliation to confirm the current state before retrying."
      );
      await Promise.all([loadClassControl(), loadRoster()]);
    } finally {
      cancellationActionLock.current = false;
      setCancellationBusy(null);
    }
  }

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
    if (classMutationsFrozen) {
      return alert("Roster changes are paused while this class is frozen or cancelled.");
    }

    try {
      setBusyUserId(userId);
      const rosterRow = rows.find((row) => row.userId === userId);
      const bookingPayload = rosterRow?.bookingId
        ? { bookingId: rosterRow.bookingId }
        : { classId, userId };

      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";
        const mod = await import("../services/checkin");
        await mod.checkInBooking({ ...bookingPayload, attended });
      } else {
        if (next === "authorised_absence" && rosterRow?.isGuestBooking) {
          return alert("PAYG cancellations must use the PAYG cancellation flow so the refund policy is applied correctly.");
        }
        const functions = getFunctions(undefined, "europe-west1");
        const mark = httpsCallable(functions, "markBookingStatus");
        await mark({ ...bookingPayload, status: next });
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
    if (classMutationsFrozen) {
      return alert("Roster changes are paused while this class is frozen or cancelled.");
    }

    const ids = idsArg ?? selectedIds;
    if (!ids.length) return;
    const selectedRows = ids.map((id) => rows.find((row) => row.userId === id)).filter(
      (row): row is BookingRow => Boolean(row)
    );
    if (next === "authorised_absence" && selectedRows.some((row) => row.isGuestBooking)) {
      return alert("PAYG cancellations must use the PAYG cancellation flow, so guest bookings were not changed.");
    }

    try {
      setBulkBusy(true);

      if (next === "checked_in" || next === "booked") {
        const attended = next === "checked_in";
        const mod = await import("../services/checkin");

        const results = await Promise.allSettled(
          selectedRows.map((row) => mod.checkInBooking({
            ...(row.bookingId ? { bookingId: row.bookingId } : { classId, userId: row.userId }),
            attended,
          }))
        );

        const failed = results.filter((x) => x.status === "rejected").length;
        await loadRoster();

        if (failed > 0) {
          alert(`Updated ${ids.length - failed}/${ids.length}. ${failed} failed — try again or refresh.`);
        }
      } else {
        const functions = getFunctions(undefined, "europe-west1");
        const mark = httpsCallable(functions, "markBookingStatus");

        const results = await Promise.allSettled(selectedRows.map((row) => mark({
          ...(row.bookingId ? { bookingId: row.bookingId } : { classId, userId: row.userId }),
          status: next,
        })));
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
  if (classMutationsFrozen) {
    setAddMemberError("Members cannot be added while this class is frozen or cancelled.");
    return;
  }

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
  const canBulkCheckIn =
    !classMutationsFrozen &&
    !loadingRoster &&
    !bulkBusy &&
    rows.some((r) => normalizeStatus(r) !== "checked_in");
  const canBulkUncheck =
    !classMutationsFrozen &&
    !loadingRoster &&
    !bulkBusy &&
    rows.some((r) => normalizeStatus(r) === "checked_in");
  const canBulkSelected =
    !classMutationsFrozen && !loadingRoster && !bulkBusy && selectedIds.length > 0;
  const cancellationFinalized =
    classControl?.status === "cancelled" || cancellationState === "cancelled";
  const cancellationReadyToFinalize =
    cancellationResult?.operation.state === "ready_to_finalize";
  const cancellationLabel = loadingClassControl
    ? "Checking class state"
    : classControlError
    ? "State unavailable"
    : cancellationStateLabel(
        cancellationState,
        classControl?.bookingOpen ?? false,
        classControl?.status ?? "scheduled"
      );
  const navItems = getUserNavItems(appUser);
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

        {canManageCancellation ? (
          <section
            className="mt-8 overflow-hidden rounded-2xl bg-[#151311] shadow-[0_18px_54px_rgba(0,0,0,0.28)]"
            aria-labelledby="class-cancellation-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
              <div className="min-w-0">
                <h2 id="class-cancellation-title" className="font-heading text-3xl uppercase text-white">
                  Class cancellation
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/65">
                  Freeze new bookings, release member places, reconcile every paid PAYG guest, then finalize.
                </p>
              </div>
              <span
                className={[
                  "inline-flex min-h-9 items-center gap-2 rounded-full px-3 py-2 text-xs font-black uppercase tracking-[0.12em]",
                  cancellationFinalized
                    ? "bg-red-400/15 text-red-100"
                    : cancellationReadyToFinalize
                    ? "bg-emerald-300/15 text-emerald-100"
                    : cancellationStarted || classControl?.bookingOpen === false
                    ? "bg-amber-300/15 text-amber-100"
                    : "bg-white/[0.07] text-white/70",
                ].join(" ")}
                role="status"
              >
                {cancellationFinalized ? <Ban className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                {cancellationLabel}
              </span>
            </div>

            <div className="p-5">
              {loadingClassControl ? (
                <p className="text-sm leading-6 text-white/65" role="status">
                  Verifying the durable class state…
                </p>
              ) : classControlError ? (
                <div className="rounded-xl bg-red-400/10 p-4" role="alert">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-200" />
                    <div>
                      <p className="text-sm leading-6 text-red-100">{classControlError}</p>
                      <button
                        type="button"
                        onClick={() => void loadClassControl()}
                        disabled={loadingClassControl}
                        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#f2eee8] px-4 py-2 text-sm font-bold text-black outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                      >
                        Retry class state
                      </button>
                    </div>
                  </div>
                </div>
              ) : cancellationFinalized ? (
                <div className="rounded-xl bg-red-400/10 p-4">
                  <p className="text-sm font-bold text-red-100">This class is cancelled.</p>
                  <p className="mt-2 text-sm leading-6 text-red-100/75">
                    Booking remains closed. The operation record and payment references below are retained for audit.
                  </p>
                </div>
              ) : !cancellationStarted ? (
                <div>
                  <p className="text-sm leading-6 text-white/65">
                    Starting is fail-closed: the class stops accepting bookings before member releases and PAYG refund checks begin.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmingCancellation("begin")}
                    disabled={Boolean(cancellationBusy)}
                    className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-red-400/15 px-5 py-3 text-sm font-bold text-red-100 outline-none transition hover:bg-red-400/22 focus-visible:ring-2 focus-visible:ring-red-200 disabled:opacity-40"
                  >
                    Cancel whole class
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-start gap-3 rounded-xl bg-amber-300/10 p-4">
                    <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-100" />
                    <div>
                      <p className="text-sm font-bold text-amber-50">New bookings are frozen.</p>
                      <p className="mt-1 text-sm leading-6 text-amber-50/75">
                        This operation is resumable. Re-running reconciliation does not create a second cancellation.
                      </p>
                      {classControl?.cancellationOperationId ? (
                        <p className="mt-2 break-all font-mono text-xs text-amber-50/65">
                          Operation {classControl.cancellationOperationId}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {!cancellationResult ? (
                    <div className="mt-4">
                      <p className="text-sm leading-6 text-white/65">
                        Load the authoritative reconciliation snapshot before taking the next action.
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleBeginCancellation("resume")}
                        disabled={Boolean(cancellationBusy)}
                        className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f2eee8] px-5 py-3 text-sm font-bold text-black outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                      >
                        <RefreshCcw className={`h-4 w-4 ${cancellationBusy === "resume" ? "animate-spin" : ""}`} />
                        {cancellationBusy === "resume" ? "Reconciling…" : "Resume reconciliation"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {confirmingCancellation === "begin" ? (
                <div className="mt-5 rounded-xl bg-red-400/10 p-5" role="alert">
                  <h3 className="text-lg font-extrabold text-red-50">Freeze this class and start cancellation?</h3>
                  <p className="mt-2 text-sm leading-6 text-red-100/80">
                    Members will have their places released. Paid PAYG guests must be fully reconciled before final cancellation.
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setConfirmingCancellation(null)}
                      disabled={Boolean(cancellationBusy)}
                      className="min-h-12 rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                    >
                      Keep class
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBeginCancellation("begin")}
                      disabled={Boolean(cancellationBusy)}
                      className="min-h-12 rounded-xl bg-red-300 px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-red-200 focus-visible:ring-2 focus-visible:ring-red-100 disabled:opacity-40"
                    >
                      {cancellationBusy === "begin" ? "Freezing bookings…" : "Freeze bookings and start"}
                    </button>
                  </div>
                </div>
              ) : null}

              {cancellationResult ? (
                <div className="mt-5" aria-live="polite">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-extrabold text-white">Reconciliation snapshot</h3>
                    <span className="break-all font-mono text-xs text-white/55">
                      {cancellationResult.operation.id}
                    </span>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
                    {[
                      ["Member places released", cancellationResult.operation.memberBookingsReleased],
                      ["Member bookings remaining", cancellationResult.operation.activeMemberBookingsRemaining],
                      ["Paid PAYG guests", cancellationResult.operation.paidPaygGuestCount],
                      ["PAYG refunds recorded", cancellationResult.operation.refundedPaygGuestCount],
                      ["PAYG unresolved", cancellationResult.operation.unresolvedPaygGuestCount],
                      ["Unpaid holds", cancellationResult.operation.unpaidHoldCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="min-w-0 bg-[#151311] p-4">
                        <dt className="text-xs leading-5 text-white/58">{label}</dt>
                        <dd className="mt-2 font-mono text-2xl font-bold text-white">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5">
                    <div className="flex items-center gap-2">
                      <ReceiptText className="h-5 w-5 text-white/65" />
                      <h3 className="text-base font-extrabold text-white">PAYG payment references</h3>
                    </div>
                    {cancellationResult.paygGuests.length === 0 ? (
                      <p className="mt-3 rounded-xl bg-white/[0.04] p-4 text-sm leading-6 text-white/65">
                        No paid PAYG guests require reconciliation.
                      </p>
                    ) : (
                      <div className="mt-3 overflow-hidden rounded-xl bg-white/10">
                        {cancellationResult.paygGuests.map((guest) => (
                          <dl
                            key={guest.orderId}
                            className="grid gap-3 border-b border-white/10 bg-[#151311] p-4 text-sm last:border-b-0 sm:grid-cols-2"
                          >
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Order</dt>
                              <dd className="mt-1 break-all font-mono text-white">{guest.orderId}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Booking</dt>
                              <dd className="mt-1 break-all font-mono text-white">{guest.bookingId ?? "Not recorded"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Payment intent</dt>
                              <dd className="mt-1 break-all font-mono text-white">{guest.paymentIntentId ?? "Not recorded"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Charge</dt>
                              <dd className="mt-1 break-all font-mono text-white">{guest.chargeId ?? "Not recorded"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Refund</dt>
                              <dd className="mt-1 break-all font-mono text-white">{guest.refundId ?? "Not recorded"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Amount</dt>
                              <dd className="mt-1 text-white">{formatCancellationMoney(guest.amountPence, guest.currency)}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Order / refund</dt>
                              <dd className="mt-1 break-words text-white">{guest.orderStatus} / {guest.refundStatus ?? "not recorded"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Confirmation resolution</dt>
                              <dd className="mt-1 text-white">{guest.confirmationResolved ? "Resolved" : "Unresolved"}</dd>
                            </div>
                            <div className="min-w-0 sm:col-span-2">
                              <dt className="text-xs font-bold uppercase tracking-[0.1em] text-white/50">Confirmation disposition</dt>
                              <dd className="mt-1 break-words text-white">{confirmationDispositionLabel(guest.confirmationDisposition)}</dd>
                            </div>
                          </dl>
                        ))}
                      </div>
                    )}
                  </div>

                  {!cancellationFinalized ? (
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => void handleBeginCancellation("resume")}
                        disabled={Boolean(cancellationBusy)}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                      >
                        <RefreshCcw className={`h-4 w-4 ${cancellationBusy === "resume" ? "animate-spin" : ""}`} />
                        {cancellationBusy === "resume" ? "Reconciling…" : "Refresh reconciliation"}
                      </button>
                      {cancellationReadyToFinalize ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingCancellation("finalize")}
                          disabled={Boolean(cancellationBusy)}
                          className="min-h-12 rounded-xl bg-red-400/15 px-5 py-3 text-sm font-bold text-red-100 outline-none transition hover:bg-red-400/22 focus-visible:ring-2 focus-visible:ring-red-200 disabled:opacity-40"
                        >
                          Finalize class cancellation
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {confirmingCancellation === "finalize" ? (
                <div className="mt-5 rounded-xl bg-red-400/10 p-5" role="alert">
                  <h3 className="text-lg font-extrabold text-red-50">Permanently mark this class cancelled?</h3>
                  <p className="mt-2 text-sm leading-6 text-red-100/80">
                    Finalize only when every member place is released and each paid PAYG guest shows a resolved refund state.
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setConfirmingCancellation(null)}
                      disabled={Boolean(cancellationBusy)}
                      className="min-h-12 rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                    >
                      Review again
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleFinalizeCancellation()}
                      disabled={Boolean(cancellationBusy)}
                      className="min-h-12 rounded-xl bg-red-300 px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-red-200 focus-visible:ring-2 focus-visible:ring-red-100 disabled:opacity-40"
                    >
                      {cancellationBusy === "finalize" ? "Finalizing…" : "Confirm final cancellation"}
                    </button>
                  </div>
                </div>
              ) : null}

              {cancellationError ? (
                <div className="mt-5 rounded-xl bg-red-400/10 p-4" role="alert">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-200" />
                    <div className="min-w-0">
                      <p className="text-sm leading-6 text-red-100">{cancellationError}</p>
                      {cancellationBlockers.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-100/80">
                          {cancellationBlockers.map((blocker) => (
                            <li key={blocker} className="break-all">{blocker}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

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
                disabled={loadingRoster || bulkBusy || classMutationsFrozen}
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
                disabled={loadingRoster || bulkBusy || classMutationsFrozen}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <Plus className="h-4 w-4" />
                Add member
              </button>

              <button
                onClick={() => void Promise.all([loadRoster(), loadClassControl()])}
                disabled={loadingRoster || loadingClassControl || bulkBusy}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#151311] px-4 py-3 text-sm font-bold text-white/68 transition hover:bg-white/[0.06] disabled:opacity-35"
              >
                <RefreshCcw className="h-4 w-4" />
                {loadingRoster || loadingClassControl ? "Loading..." : "Refresh"}
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
                  disabled={!canBulkSelected || selectedHasGuest}
                  title={selectedHasGuest ? "Use the PAYG cancellation flow for guest bookings" : undefined}
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
                const isBusy = busyUserId === r.userId || bulkBusy || classMutationsFrozen;
                const isSelected = !!selected[r.userId];
                const isPaygGuest = r.bookingKind === "payg_guest" || r.isGuestBooking === true;

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
                        <div className="mt-1 truncate text-sm font-medium text-white/38">
                          {isPaygGuest ? "PAYG guest · no app account" : r.email ?? ""}
                        </div>
                      </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {r.addedByAdmin && (
                            <span className="rounded-md bg-[#f2eee8] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                              Admin
                            </span>
                          )}
                          {isPaygGuest ? (
                            <span className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-200">PAYG</span>
                          ) : null}
                          <StatusPill status={status} guest={isPaygGuest} />
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
                              disabled={isBusy || isPaygGuest}
                              className="grid h-9 w-9 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-35"
                              aria-label={isPaygGuest ? "PAYG cancellation uses its cancellation flow" : "Mark authorised absence"}
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
