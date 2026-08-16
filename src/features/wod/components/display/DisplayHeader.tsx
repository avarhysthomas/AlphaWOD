import React from "react";

/**
 * Broadcast-style identity strip: brand, one dominant session heading, and the
 * session's metadata read once, in order of what a coach scans first.
 */
export default function DisplayHeader({
  title,
  dateLabel,
  meta,
  isLive,
}: {
  title: string;
  /** Already formatted, e.g. "Mon 10 Aug" — the only place the day appears. */
  dateLabel: string;
  /** Slot, type, format, group, timing. Empty entries are dropped upstream. */
  meta: string[];
  isLive: boolean;
}) {
  return (
    <header
      className="relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[clamp(1rem,2vw,3rem)] border-b border-[var(--zaf-line-strong)] bg-[var(--zaf-panel)] px-[var(--zaf-inset)] py-[clamp(0.5rem,0.9vw,1.5rem)]"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(244,244,244,0.045), transparent 62%)",
      }}
    >
      <img
        src="/ZERO-ALPHA.png"
        alt="Zero Alpha Fitness"
        draggable={false}
        className="h-[clamp(2.75rem,4.6vw,8.5rem)] w-auto select-none object-contain"
      />

      <div className="min-w-0">
        <h1 className="truncate font-heading uppercase leading-[0.86] text-[var(--zaf-text)] text-[clamp(1.75rem,3.5vw,6.5rem)]">
          {title}
        </h1>

        <div className="mt-[clamp(0.25rem,0.5vw,0.9rem)] flex min-w-0 flex-wrap items-center gap-x-[clamp(0.5rem,0.9vw,1.6rem)] gap-y-1 font-body text-[clamp(1rem,0.95vw,1.75rem)] font-bold uppercase leading-none tracking-[0.14em]">
          <span className="text-[var(--zaf-accent-soft)]">{dateLabel}</span>

          {meta.map((item, index) => (
            <React.Fragment key={`${index}-${item}`}>
              <span
                aria-hidden="true"
                className="h-[0.7em] w-px shrink-0 bg-[var(--zaf-line-strong)]"
              />
              <span className="text-[var(--zaf-text-dim)]">{item}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[clamp(0.5rem,0.8vw,1.25rem)] border border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] px-[clamp(0.6rem,0.9vw,1.5rem)] py-[clamp(0.4rem,0.6vw,1rem)]">
        {isLive ? (
          <span
            aria-hidden="true"
            className="h-[0.5em] w-[0.5em] shrink-0 rounded-full bg-[var(--zaf-accent)] shadow-[0_0_1.2em_var(--zaf-accent)]"
          />
        ) : null}
        <span className="font-body text-[clamp(0.9rem,0.85vw,1.5rem)] font-black uppercase leading-none tracking-[0.28em] text-[var(--zaf-text)]">
          {isLive ? "Live" : "Board"}
        </span>
      </div>
    </header>
  );
}
