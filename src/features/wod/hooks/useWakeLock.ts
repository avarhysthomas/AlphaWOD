import { useEffect } from "react";

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * Hold a screen wake lock while `enabled`, so a wall-mounted board never sleeps
 * mid-session. Browsers drop the lock whenever the tab is hidden, so we
 * re-request it every time the page becomes visible again.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;

      try {
        const next = await wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Denied (needs a user gesture on some browsers) or unsupported here.
        // Retried on the next visibility change.
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);
}
