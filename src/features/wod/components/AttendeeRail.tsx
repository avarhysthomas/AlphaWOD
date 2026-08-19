import React, { useState } from "react";
import { SessionAttendee } from "../hooks/useSessionAttendees";

/** Seconds one avatar takes to cross the bar — constant speed at any count. */
const SECONDS_PER_ATTENDEE = 3.2;

/** Copies of the list are repeated until there are enough tiles to fill a TV. */
const MIN_TILES = 14;

function initialsFor(name: string) {
  const letters = name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return letters.toUpperCase() || "M";
}

function AttendeeChip({ attendee }: { attendee: SessionAttendee }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const firstName = attendee.name.split(" ")[0] || "Member";
  const showPhoto = !!attendee.photoURL && !photoFailed;

  return (
    <div className="flex shrink-0 items-center gap-3 px-5 py-3">
      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[#5ef2dd]/45 bg-[#161616] text-sm font-black uppercase text-white/62 xl:h-16 xl:w-16">
        {showPhoto ? (
          <img
            src={attendee.photoURL}
            alt={attendee.name}
            draggable={false}
            onError={() => setPhotoFailed(true)}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <span>{initialsFor(attendee.name)}</span>
        )}
      </div>
      <span className="max-w-[10ch] truncate font-heading text-xl uppercase leading-none text-[#f4f4f4] xl:text-2xl">
        {firstName}
      </span>
    </div>
  );
}

/**
 * Who is in the room, scrolling across the foot of the board.
 *
 * The track holds whole copies of the list and slides by exactly one copy per
 * cycle, so the loop is seamless whether four people are booked or forty.
 */
export default function AttendeeRail({
  attendees,
  slotLabel,
}: {
  attendees: SessionAttendee[];
  slotLabel: string;
}) {
  const count = attendees.length;
  if (!count) return null;

  const copies = Math.max(2, Math.ceil(MIN_TILES / count));

  return (
    <div className="flex min-w-0 items-stretch border-t border-white/18 bg-[#0b0b0b]">
      <div className="flex shrink-0 flex-col justify-center gap-1.5 border-r border-white/18 bg-[#f4f4f4] px-5 py-3 text-[#050505]">
        <span className="text-[10px] font-black uppercase leading-none text-[#050505]/62">
          {slotLabel} squad
        </span>
        <span className="font-heading text-2xl uppercase leading-none">
          {count} booked
        </span>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="alpha-marquee-track flex w-max items-center"
          style={
            {
              "--marquee-shift": `-${100 / copies}%`,
              "--marquee-duration": `${(count * SECONDS_PER_ATTENDEE).toFixed(1)}s`,
            } as React.CSSProperties
          }
        >
          {Array.from({ length: copies }).map((_, copy) => (
            <div key={copy} className="flex items-center" aria-hidden={copy > 0}>
              {attendees.map((attendee) => (
                <AttendeeChip key={`${copy}-${attendee.userId}`} attendee={attendee} />
              ))}
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-[linear-gradient(90deg,#0b0b0b,transparent)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-[linear-gradient(270deg,#0b0b0b,transparent)]" />
      </div>
    </div>
  );
}
