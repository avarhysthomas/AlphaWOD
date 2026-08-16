import React from "react";

export type BoardMovement = {
  id: string;
  name: string;
  /** Target, load, rep scheme — whatever the block type carries. */
  detail: string;
};

export type BoardStation = {
  id: string;
  /** Only set when the coach named the station something meaningful. */
  title: string;
  movements: BoardMovement[];
  /** The pace setter in a station-controlled block. */
  isControl: boolean;
};

export type StationDensity = "roomy" | "normal" | "tight";

/**
 * Movement names carry the workout, so they get the biggest step down from the
 * station number. Everything else is deliberately quieter.
 */
const MOVEMENT_TYPE: Record<StationDensity, string> = {
  roomy: "text-[clamp(1.5rem,2.1vw,4rem)]",
  normal: "text-[clamp(1.2rem,1.5vw,2.9rem)]",
  tight: "text-[clamp(1rem,1.1vw,2.1rem)]",
};

const NUMBER_TYPE: Record<StationDensity, string> = {
  roomy: "text-[clamp(2.75rem,5vw,9rem)]",
  normal: "text-[clamp(2rem,3.4vw,6rem)]",
  tight: "text-[clamp(1.5rem,2.2vw,4rem)]",
};

const DETAIL_TYPE: Record<StationDensity, string> = {
  roomy: "text-[clamp(0.8rem,0.95vw,1.75rem)]",
  normal: "text-[clamp(0.75rem,0.85vw,1.5rem)]",
  tight: "text-[clamp(0.7rem,0.72vw,1.25rem)]",
};

export default function StationCard({
  index,
  station,
  density,
}: {
  index: number;
  station: BoardStation;
  density: StationDensity;
}) {
  const { isControl } = station;

  return (
    <article
      className={[
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden border",
        isControl
          ? "border-[var(--zaf-accent)]/55 bg-[var(--zaf-raised)] shadow-[0_0_0_1px_rgba(94,242,221,0.12),0_1.5rem_3rem_rgba(0,0,0,0.55)]"
          : "border-[var(--zaf-line)] bg-[var(--zaf-panel)]",
      ].join(" ")}
    >
      {/* Edge highlight: the elevated card catches the accent, the rest a hairline. */}
      <span
        aria-hidden="true"
        className={[
          "absolute inset-x-0 top-0 h-[3px]",
          isControl ? "bg-[var(--zaf-accent)]" : "bg-[var(--zaf-line-strong)]",
        ].join(" ")}
      />

      <div className="flex shrink-0 items-start justify-between gap-3 px-[clamp(0.7rem,1vw,2rem)] pt-[clamp(0.5rem,0.8vw,1.5rem)]">
        <span
          className={[
            "font-heading leading-[0.8] tabular-nums",
            NUMBER_TYPE[density],
            isControl ? "text-[var(--zaf-accent)]" : "text-[var(--zaf-text)]",
          ].join(" ")}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        {isControl ? (
          <span className="mt-[0.35em] shrink-0 border border-[var(--zaf-accent)] bg-[var(--zaf-accent)] px-[0.6em] py-[0.3em] font-body text-[clamp(0.8rem,0.92vw,1.65rem)] font-black uppercase leading-none tracking-[0.16em] text-[#050505]">
            Pace
          </span>
        ) : null}
      </div>

      {station.title ? (
        <div className="shrink-0 truncate px-[clamp(0.7rem,1vw,2rem)] pt-[clamp(0.2rem,0.35vw,0.7rem)] font-body text-[clamp(0.9rem,0.95vw,1.75rem)] font-bold uppercase leading-none tracking-[0.2em] text-[var(--zaf-text-faint)]">
          {station.title}
        </div>
      ) : null}

      <div className="mt-[clamp(0.4rem,0.7vw,1.2rem)] flex min-h-0 flex-1 flex-col overflow-hidden px-[clamp(0.7rem,1vw,2rem)] pb-[clamp(0.6rem,0.9vw,1.6rem)]">
        {station.movements.length ? (
          /* Rows share the card's height, so the sequence fills it rather than
             leaving the bottom of the board empty. */
          <ul className="flex min-h-0 flex-1 flex-col">
            {station.movements.map((movement) => (
              <li
                key={movement.id}
                className="flex min-h-0 min-w-0 flex-1 flex-col justify-center border-t border-[var(--zaf-line)] py-[clamp(0.25rem,0.4vw,0.8rem)] first:border-t-0"
              >
                <div
                  className={[
                    "truncate font-heading uppercase leading-[0.95] text-[var(--zaf-text)]",
                    MOVEMENT_TYPE[density],
                  ].join(" ")}
                >
                  {movement.name}
                </div>

                {movement.detail ? (
                  <div
                    className={[
                      "truncate font-body font-bold uppercase leading-tight tracking-[0.12em] text-[var(--zaf-text-dim)]",
                      DETAIL_TYPE[density],
                    ].join(" ")}
                  >
                    {movement.detail}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div
            className={[
              "font-body font-bold uppercase tracking-[0.14em] text-[var(--zaf-text-faint)]",
              DETAIL_TYPE[density],
            ].join(" ")}
          >
            No movements added
          </div>
        )}
      </div>
    </article>
  );
}
