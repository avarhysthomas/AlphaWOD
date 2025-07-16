import React, { useEffect, useState } from "react";
import { collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { FieldValue } from "firebase/firestore";

// Type definitions
type ClassType = {
  id: string;
  name: string;
  coach: string;
  time: string;
  weekday: string;
  capacity: number;
  attendees?: string[];
};

const weekdays: string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const TimetableView: React.FC = () => {
  const [classes, setClasses] = useState<ClassType[]>([]);
  const { user, role } = useAuth();

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const snapshot = await getDocs(collection(db, "classes"));
        const classList: ClassType[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<ClassType, "id">),
        }));
        setClasses(classList);
      } catch (err) {
        console.error("Error fetching classes:", err);
      }
    };

    fetchClasses();
  }, []);

  const handleBook = async (classId: string) => {
    if (!user) return;
    try {
      const classRef = doc(db, "classes", classId);
      await updateDoc(classRef, {
        attendees: arrayUnion(user.uid),
      });
      setClasses((prev) =>
        prev.map((cls) =>
          cls.id === classId && cls.attendees
            ? { ...cls, attendees: [...cls.attendees, user.uid] }
            : cls
        )
      );
    } catch (err) {
      console.error("Error booking class:", err);
    }
  };

  const handleCancel = async (classId: string, className: string) => {
    if (!user) return;

    const confirmed = window.confirm(
        `Are you sure you want to cancel your booking for ${className}?`
    );

    if (!confirmed) return;

    try {
        const classRef = doc(db, "classes", classId);
        await updateDoc(classRef, {
        attendees: arrayRemove(user.uid),
        });
        setClasses((prev) =>
        prev.map((cls) =>
            cls.id === classId && cls.attendees
            ? { ...cls, attendees: cls.attendees.filter((id) => id !== user.uid) }
            : cls
        )
        );
  } catch (err) {
    console.error("Error cancelling booking:", err);
  }
};


  return (
    <div className="max-w-3xl mx-auto px-4 pb-20">
      <h2 className="text-xl font-semibold text-neutral-300 uppercase mb-6 tracking-widest">
        Weekly Class Timetable
      </h2>
      {weekdays.map((day) => {
        const dailyClasses = classes.filter((cls) => cls.weekday === day);
        return (
          <div key={day} className="mb-6">
            <h3 className="text-sm font-semibold text-neutral-500 mt-10 mb-3 border-b border-neutral-700 pb-1 tracking-widest uppercase">
              {day}
            </h3>
            {dailyClasses.length > 0 ? (
              dailyClasses.map((cls) => {
                const attendeeCount = cls.attendees?.length || 0;
                const isFull = attendeeCount >= cls.capacity;
                const isBooked = cls.attendees?.includes(user?.uid || "");
                return (
                  <div
                    key={cls.id}
                    className="bg-neutral-900 text-white border border-neutral-700 rounded-xl p-4 mb-3 shadow-md hover:scale-[1.01] hover:border-white transition-all duration-150 ease-in-out"
                  >
                    <p className="font-extrabold text-base uppercase tracking-widest text-white drop-shadow-[0_1px_1px_rgba(255,255,255,0.1)]">
                      {cls.name} @ {cls.time}
                    </p>
                    <p className="text-sm text-neutral-400 mt-1">
                      Coach: <span className="text-white">{cls.coach}</span> • {" "}
                      {attendeeCount}/{cls.capacity} attending
                    </p>
                    {role !== "admin" && (
                    <>
                        {isBooked ? (
                        <button
                            onClick={() => handleCancel(cls.id, cls.name)}
                            className="mt-2 text-sm font-semibold px-3 py-1 rounded-md bg-green-700 text-white hover:bg-green-800 transition-all duration-200"
                        >
                            Cancel Booking
                        </button>
                        ) : (
                        <button
                            onClick={() => handleBook(cls.id)}
                            disabled={isFull}
                            className={`mt-2 text-sm font-semibold px-3 py-1 rounded-md transition-all duration-200
                            ${isFull
                                ? "bg-gray-600 text-gray-300 cursor-not-allowed"
                                : "bg-white text-black hover:bg-neutral-200"}
                            `}
                        >
                            {isFull ? "Class Full" : "Book Now"}
                        </button>
                        )}
                    </>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-gray-500">No classes scheduled.</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TimetableView;

