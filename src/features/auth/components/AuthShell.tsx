import React from "react";
import { Link } from "react-router-dom";
import { Download, PlusSquare } from "lucide-react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footerPrompt: string;
  footerLabel: string;
  footerTo: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneMode() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function InstallHint() {
  const standalone = isStandaloneMode();

  if (standalone) {
    return (
      <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
        Installed App Ready
      </div>
    );
  }

  if (isIosBrowser()) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-neutral-300">
        Add AlphaFIT to your Home Screen from Safari for a faster app launch.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-neutral-300">
      Install AlphaFIT to your Home Screen for one-tap access and a cleaner full-screen experience.
    </div>
  );
}

export default function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footerPrompt,
  footerLabel,
  footerTo,
}: AuthShellProps) {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = React.useState(() => isStandaloneMode());
  const [showIosHelp, setShowIosHelp] = React.useState(false);

  React.useEffect(() => {
    setIsStandalone(isStandaloneMode());

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setDeferredPrompt(null);
      setIsStandalone(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);
      return;
    }

    if (isIosBrowser() && !isStandalone) {
      setShowIosHelp((current) => !current);
    }
  }

  const canShowInstallButton = Boolean(deferredPrompt) || (isIosBrowser() && !isStandalone);

  return (
    <div className="auth-screen carbon-fiber-bg min-h-screen px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-xl items-center justify-center">
        <section className="relative w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.16),transparent_28%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(5,5,5,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur sm:p-6 lg:p-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/55 to-transparent" />

          <div className="relative flex h-full flex-col">
            <div className="mb-5">
              <div className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-100">
                {eyebrow}
              </div>

              <h1 className="mt-4 text-3xl font-heading uppercase tracking-wide text-white sm:text-4xl">
                {title}
              </h1>

              <p className="mt-3 text-sm leading-7 text-neutral-300 sm:text-base">
                {description}
              </p>
            </div>

            <div className="mb-5">
              <InstallHint />
            </div>

            {canShowInstallButton ? (
              <div className="mb-5">
                <button
                  type="button"
                  onClick={handleInstall}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                >
                  {deferredPrompt ? (
                    <Download className="h-4 w-4" />
                  ) : (
                    <PlusSquare className="h-4 w-4" />
                  )}
                  {deferredPrompt ? "Install app" : "How to add to Home Screen"}
                </button>

                {showIosHelp ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-neutral-300">
                    In Safari, tap Share, then choose <span className="font-semibold text-white">Add to Home Screen</span>.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex-1">{children}</div>

            <p className="mt-6 text-sm text-neutral-400">
              {footerPrompt}{" "}
              <Link to={footerTo} className="font-semibold text-amber-200 transition hover:text-amber-100">
                {footerLabel}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
