import React from "react";
import { Link } from "react-router-dom";
import {
  Home,
  Maximize,
  Minimize,
  Moon,
  Repeat,
  Settings2,
  Share,
  Sun,
} from "lucide-react";
import { SLOT_KEYS, SLOT_LABELS, SlotKey } from "../../utils/programming";

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-11 items-center gap-2 border px-4 text-sm font-black uppercase tracking-[0.12em] transition-colors duration-200 ${
        active
          ? "border-[var(--zaf-accent)] bg-[var(--zaf-accent)] text-black"
          : "border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] text-[var(--zaf-text-dim)] hover:text-[var(--zaf-text)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Operator surface. Deliberately near-invisible until hovered or focused: this
 * is for the coach at the keyboard, not for athletes reading from the floor.
 */
export default function DisplayControls({
  controlsOpen,
  setControlsOpen,
  selectedDate,
  handleDateChange,
  sessionKey,
  setSessionKey,
  canShare,
  onShare,
  isFullscreen,
  onToggleFullscreen,
  fullscreenSupported,
  autoRotate,
  onToggleAutoRotate,
  canAutoRotate,
}: {
  controlsOpen: boolean;
  setControlsOpen: (open: boolean) => void;
  selectedDate: string;
  handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionKey: SlotKey;
  setSessionKey: (key: SlotKey) => void;
  canShare: boolean;
  onShare: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenSupported: boolean;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  canAutoRotate: boolean;
}) {
  return (
    <div className="fixed left-3 top-3 z-50">
      <div className="flex items-center gap-2">
        <Link
          to="/dashboard"
          aria-label="Back to dashboard"
          className="inline-grid h-11 w-11 place-items-center border border-[var(--zaf-line-strong)] bg-black/80 text-[var(--zaf-text-dim)] opacity-20 transition hover:text-[var(--zaf-text)] hover:opacity-100 focus:opacity-100"
        >
          <Home className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => setControlsOpen(!controlsOpen)}
          aria-expanded={controlsOpen}
          aria-label="Toggle board controls"
          className="inline-grid h-11 w-11 place-items-center border border-[var(--zaf-line-strong)] bg-black/80 text-[var(--zaf-text-dim)] opacity-20 transition hover:text-[var(--zaf-text)] hover:opacity-100 focus:opacity-100"
        >
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      {controlsOpen ? (
        <div className="mt-2 w-[min(92vw,560px)] border border-[var(--zaf-line-strong)] bg-[#080807]/96 p-3 shadow-[0_1.5rem_4rem_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              aria-label="Board date"
              className="h-11 border border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] px-3 text-sm font-semibold text-white outline-none [color-scheme:dark]"
            />

            {SLOT_KEYS.map((slot) => (
              <ToggleButton
                key={slot}
                active={sessionKey === slot}
                onClick={() => setSessionKey(slot)}
              >
                {SLOT_LABELS[slot]}
                {slot === "AM" ? <Sun className="h-4 w-4" /> : null}
                {slot === "PM" ? <Moon className="h-4 w-4" /> : null}
              </ToggleButton>
            ))}

            {canShare ? (
              <button
                type="button"
                onClick={onShare}
                className="ml-auto inline-flex h-11 items-center gap-2 border border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] px-4 text-sm font-bold text-white transition-colors duration-200 hover:bg-white/[0.08]"
              >
                <Share className="h-4 w-4" />
                Share
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {canAutoRotate ? (
              <ToggleButton active={autoRotate} onClick={onToggleAutoRotate}>
                <Repeat className="h-4 w-4" />
                Auto-rotate {autoRotate ? "on" : "off"}
              </ToggleButton>
            ) : null}

            {fullscreenSupported ? (
              <ToggleButton active={isFullscreen} onClick={onToggleFullscreen}>
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
                {isFullscreen ? "Exit full screen" : "Full screen"}
              </ToggleButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
