import { useCallback, useEffect, useState } from "react";

/** Fullscreen toggle for the TV board, kept in sync with browser-driven exits (Esc). */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && Boolean(document.fullscreenElement)
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Blocked outside a user gesture, or unsupported. Nothing to recover from.
    }
  }, []);

  const supported =
    typeof document !== "undefined" &&
    typeof document.documentElement?.requestFullscreen === "function";

  return { isFullscreen, toggle, supported };
}
