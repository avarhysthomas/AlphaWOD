import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  LoaderCircle,
  MapPin,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getPaygCancellationPreview,
  paygErrorMessage,
  requestPaygCancellation,
  type PaygCancellationPreview,
  type PaygCancellationResult,
} from "../services/payg";

function formatDateTime(value: string, timezone = "Europe/London") {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function terminalStateMessage(state: PaygCancellationPreview["currentOrderState"]) {
  if (state === "refund_pending") {
    return "This class place has already been released and its eligible refund is being processed.";
  }
  if (state === "refunded") {
    return "This class place was cancelled and its payment has been refunded.";
  }
  if (state === "cancelled") {
    return "This class place has already been cancelled. No second cancellation is needed.";
  }
  if (state === "no_show") {
    return "This class was recorded as a no-show and is non-refundable.";
  }
  if (state === "disputed") {
    return "This booking needs support review, so it cannot be changed online.";
  }
  return "";
}

export default function PayAsYouGoCancellation() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [preview, setPreview] = useState<PaygCancellationPreview | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PaygCancellationResult | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void getPaygCancellationPreview(token)
      .then((nextPreview) => {
        if (!cancelled) setPreview(nextPreview);
      })
      .catch((previewError) => {
        if (!cancelled) setError(paygErrorMessage(previewError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewAttempt, token]);

  async function cancel() {
    if (!token || preview?.currentOrderState !== "confirmed") return;
    try {
      setBusy(true);
      setError("");
      setResult(await requestPaygCancellation(token));
    } catch (cancelError) {
      setError(paygErrorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  }

  const canCancel = preview?.currentOrderState === "confirmed";

  return (
    <main className="carbon-fiber-bg grid min-h-screen place-items-center bg-[#050505] px-5 py-10 font-barlow text-[#f4f0ea]">
      <section className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#151311] p-7 shadow-[0_28px_90px_rgba(0,0,0,0.5)] sm:p-9">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-red-300/20 bg-red-300/10 text-red-200">
          <X className="h-6 w-6" />
        </div>
        <h1 className="mt-6 font-heading text-5xl uppercase leading-none text-white">
          Cancel this class?
        </h1>

        {result ? (
          <div className="mt-6" role="status">
            <p className="text-base leading-7 text-white/70">
              {result.outcome === "refund_pending"
                ? "Your place has been released and the eligible refund is being processed."
                : result.outcome === "cancelled_non_refundable"
                ? "Your place has been cancelled. It was inside the 24-hour cutoff, so the payment is non-refundable."
                : "This booking was already cancelled; no second cancellation was created."}
            </p>
            <Link
              to="/pay-as-you-go"
              className="mt-7 inline-flex min-h-[48px] items-center rounded-xl bg-payg px-5 py-3 text-sm font-black text-black outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              View the timetable
            </Link>
          </div>
        ) : !token ? (
          <p className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
            This cancellation link is incomplete. Use the link from your confirmed booking or contact support.
          </p>
        ) : loading ? (
          <div
            className="mt-6 flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/70"
            role="status"
          >
            <LoaderCircle className="h-5 w-5 animate-spin text-payg" />
            Checking this booking and its refund deadline…
          </div>
        ) : !preview ? (
          <div className="mt-6">
            <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {error || "We could not check this cancellation link."}
            </p>
            <button
              type="button"
              onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
              className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : (
          <>
            <p className="mt-5 text-base leading-7 text-white/70">
              Review the exact class and refund position below before releasing the place. A PAYG booking cannot be moved or transferred.
            </p>

            <dl className="mt-6 grid gap-5 rounded-xl border border-white/10 bg-black/20 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">Class</dt>
                <dd className="mt-2 font-heading text-3xl uppercase text-white">{preview.class.title}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">When</dt>
                <dd className="mt-2 flex items-start gap-2 text-sm leading-6 text-white/75">
                  <CalendarDays className="mt-1 h-4 w-4 shrink-0 text-payg" />
                  {formatDateTime(preview.class.startTime, preview.class.timezone)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">Location</dt>
                <dd className="mt-2 flex items-start gap-2 text-sm leading-6 text-white/75">
                  <MapPin className="mt-1 h-4 w-4 shrink-0 text-payg" />
                  {preview.class.location || "Zero Alpha Fitness"}
                </dd>
              </div>
            </dl>

            {canCancel ? (
              <div
                className={`mt-5 rounded-xl border p-4 text-sm leading-6 ${
                  preview.refundEligibleNow
                    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-50"
                    : "border-amber-300/25 bg-amber-300/10 text-amber-50"
                }`}
              >
                <p className="flex items-center gap-2 font-bold">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  {preview.refundEligibleNow ? "Refund available now" : "Refund deadline passed"}
                </p>
                <p className="mt-1 opacity-80">
                  {preview.refundEligibleNow
                    ? `Cancel by ${formatDateTime(preview.cancellationCutoffAt, preview.class.timezone)} for a refund.`
                    : `The refund deadline was ${formatDateTime(preview.cancellationCutoffAt, preview.class.timezone)}. Cancelling now releases the place but does not refund or create credit.`}
                </p>
              </div>
            ) : (
              <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/75" role="status">
                {terminalStateMessage(preview.currentOrderState)}
              </p>
            )}

            {error ? (
              <p role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
                {error}
              </p>
            ) : null}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {canCancel ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancel}
                  className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-red-200 px-5 py-3 text-sm font-black text-red-950 outline-none transition hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-200 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Cancelling…" : "Confirm cancellation"}
                </button>
              ) : null}
              <Link
                to="/pay-as-you-go"
                className="inline-flex min-h-[50px] items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {canCancel ? "Keep my class" : "View the timetable"}
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
