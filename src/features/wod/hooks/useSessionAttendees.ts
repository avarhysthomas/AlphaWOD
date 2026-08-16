import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getHourInTimeZone } from "../../../utils/date";
import { SlotKey, slotForHour } from "../utils/programming";

/** Same zone the board uses to pick its opening slot. */
const TIME_ZONE = "Europe/London";

export type SessionAttendee = {
  userId: string;
  name: string;
  photoURL: string;
};

type BookingLite = {
  userId: string;
  userName: string;
};

type Profile = {
  name: string;
  photoURL: string;
};

/**
 * Profiles barely change and the board runs for hours, so cache them for the
 * life of the tab. Switching date/slot then costs bookings reads only.
 */
const profileCache = new Map<string, Profile>();

/**
 * Local midnight either side of a `YYYY-MM-DD` key. The board runs on a screen
 * in the gym, so local time is gym time — the same assumption Schedule makes.
 */
function dayBounds(dateKey: string): { start: Date; end: Date } | null {
  const start = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

/**
 * Everyone booked onto the class(es) running on `dateKey` in `slot`.
 *
 * `wods/{date}` and `classes` are separate collections with no shared id, so
 * the link is the clock: a class belongs to the slot its start hour falls in
 * (the same mapping the board uses to pick its opening slot). Both queries are
 * live — the rail fills in as people book, without touching the TV.
 */
export function useSessionAttendees(dateKey: string, slot: SlotKey) {
  const [classIdKey, setClassIdKey] = useState("");
  const [bookings, setBookings] = useState<BookingLite[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>(() =>
    Object.fromEntries(profileCache)
  );

  const classIds = useMemo(
    () => (classIdKey ? classIdKey.split(",") : []),
    [classIdKey]
  );

  useEffect(() => {
    const bounds = dateKey ? dayBounds(dateKey) : null;
    if (!bounds) {
      setClassIdKey("");
      return;
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, "classes"),
        where("startTime", ">=", Timestamp.fromDate(bounds.start)),
        where("startTime", "<", Timestamp.fromDate(bounds.end))
      ),
      (snapshot) => {
        const ids = snapshot.docs
          .filter((classDoc) => {
            const data = classDoc.data() as Record<string, any>;
            if (data?.status === "cancelled") return false;

            const startAt = data?.startTime?.toDate?.();
            if (!startAt) return false;

            return slotForHour(getHourInTimeZone(startAt, TIME_ZONE)) === slot;
          })
          .map((classDoc) => classDoc.id)
          .sort();

        // Joined string, so an unchanged class list is a no-op re-render.
        setClassIdKey(ids.join(","));
      },
      (error) => {
        console.error("Error watching classes for attendee rail:", error);
        setClassIdKey("");
      }
    );

    return unsubscribe;
  }, [dateKey, slot]);

  useEffect(() => {
    if (!classIds.length) {
      setBookings([]);
      return;
    }

    const byClassId = new Map<string, BookingLite[]>();

    const unsubscribes = classIds.map((classId) =>
      onSnapshot(
        query(
          collection(db, "bookings"),
          where("classId", "==", classId),
          where("status", "==", "booked")
        ),
        (snapshot) => {
          byClassId.set(
            classId,
            snapshot.docs
              .map((bookingDoc) => {
                const data = bookingDoc.data() as Record<string, any>;
                return {
                  userId: String(data?.userId ?? ""),
                  userName: String(data?.userName ?? ""),
                };
              })
              .filter((booking) => booking.userId)
          );

          // A member booked onto two classes in the same slot shows up once.
          const seen = new Set<string>();
          const merged: BookingLite[] = [];

          classIds.forEach((id) => {
            (byClassId.get(id) ?? []).forEach((booking) => {
              if (seen.has(booking.userId)) return;
              seen.add(booking.userId);
              merged.push(booking);
            });
          });

          setBookings(merged);
        },
        (error) => {
          console.error("Error watching bookings for attendee rail:", error);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [classIds]);

  useEffect(() => {
    const missing = Array.from(
      new Set(bookings.map((booking) => booking.userId))
    ).filter((userId) => !profileCache.has(userId));

    if (!missing.length) return;

    let cancelled = false;

    (async () => {
      const loaded = await Promise.all(
        missing.map(async (userId) => {
          try {
            const snapshot = await getDoc(doc(db, "users", userId));
            const data = snapshot.exists()
              ? (snapshot.data() as Record<string, any>)
              : null;

            const profile: Profile = {
              name: String(data?.name ?? "").trim(),
              photoURL: String(data?.photoURL ?? "").trim(),
            };

            // Only cache successes — a transient failure should retry later.
            profileCache.set(userId, profile);
            return [userId, profile] as const;
          } catch (error) {
            console.error("Error loading profile for attendee rail:", error);
            return null;
          }
        })
      );

      if (cancelled) return;

      const next = Object.fromEntries(
        loaded.filter((entry): entry is NonNullable<typeof entry> => !!entry)
      );

      if (Object.keys(next).length) {
        setProfiles((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookings]);

  const attendees = useMemo<SessionAttendee[]>(() => {
    return bookings
      .map((booking) => {
        const profile = profiles[booking.userId];
        return {
          userId: booking.userId,
          name: profile?.name || booking.userName.trim() || "Member",
          photoURL: profile?.photoURL ?? "",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bookings, profiles]);

  return attendees;
}
