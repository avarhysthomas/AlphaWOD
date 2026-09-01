import React, { useEffect, useState } from "react";
import { CalendarDays, Check, LoaderCircle, MapPin, Ticket } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  clearPendingPaygCheckout,
  getPaygCheckoutStatus,
  paygErrorMessage,
  readPendingPaygCheckout,
  type PaygCheckoutStatus,
} from "../services/payg";

const SESSION_KEY = "zaf.paygCheckoutSession.v1";

function formatDateTime(value: string, timezone = "Europe/London") {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function rememberedSessionId() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export default function PayAsYouGoSuccess() {
  const [params] = useSearchParams();
  const returnedSessionId = params.get("session_id");
  const [sessionId] = useState(() => returnedSessionId || rememberedSessionId());
  const [status, setStatus] = useState<PaygCheckoutStatus | null>(null);
  const [error, setError] = useState("");
  const [settled, setSettled] = useState(false);
  const [retryExhausted, setRetryExhausted] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);

  useEffect(() => {
    if (!returnedSessionId) return;
    try {
      window.sessionStorage.setItem(SESSION_KEY, returnedSessionId);
    } catch {
      // The status can still be read during this render.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("session_id");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [returnedSessionId]);

  useEffect(() => {
    if (!sessionId) {
      setSettled(true);
      return;
    }
    setError("");
    setSettled(false);
    setRetryExhausted(false);
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const load = async () => {
      try {
        const result = await getPaygCheckoutStatus(sessionId);
        if (cancelled) return;
        setStatus(result);
        attempts += 1;
        if (result.state === "processing" && attempts < 7) {
          timer = window.setTimeout(load, 2000);
        } else {
          setRetryExhausted(result.state === "processing");
          setSettled(true);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(paygErrorMessage(loadError));
        setSettled(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollGeneration, sessionId]);

  useEffect(() => {
    if (status && status.state !== "processing") {
      const pendingCheckout = readPendingPaygCheckout();
      if (pendingCheckout?.sessionId === sessionId) {
        clearPendingPaygCheckout();
      }
    }
  }, [sessionId, status]);

  const terminal = status && status.state !== "processing" ? status : null;
  const orderTerminal = terminal && "order" in terminal ? terminal : null;
  const reviewTerminal = terminal && "review" in terminal ? terminal : null;
  const confirmed = orderTerminal?.state === "confirmed";
  const stillConfirming = settled && retryExhausted && status?.state === "processing";
  const title = !sessionId
    ? "Checkout reference missing"
    : stillConfirming
    ? "Still confirming"
    : confirmed
    ? "You’re booked"
    : terminal
    ? terminal.state === "refund_pending"
      ? "Refund requested"
      : terminal.state === "refunded"
      ? "Booking refunded"
      : terminal.state === "cancelled"
      ? "Booking cancelled"
      : terminal.state === "no_show"
      ? "Class marked as missed"
      : "Booking needs attention"
    : "Confirming your class";

  return (
    <main className="carbon-fiber-bg min-h-screen bg-[#050505] px-5 py-10 font-barlow text-[#f4f0ea] sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link to="/" aria-label="Zero Alpha home" className="inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-payg">
          <img src="/ZERO-ALPHA.png" alt="Zero Alpha Fitness" className="h-20 w-auto object-contain" />
        </Link>

        <section className="mt-7 overflow-hidden rounded-2xl border border-payg/25 bg-[#151311] shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
          <div className="flex items-center justify-between border-b border-dashed border-black/30 bg-payg px-5 py-4 text-black sm:px-7">
            <span className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em]"><Ticket className="h-4 w-4" /> Pay As You Go</span>
            {confirmed ? <Check className="h-6 w-6" aria-label="Confirmed" /> : <span className="font-heading text-2xl">£7</span>}
          </div>
          <div className="p-6 sm:p-8">
            <h1 className="font-heading text-5xl uppercase leading-none text-white sm:text-6xl">{title}</h1>

            {!settled ? (
              <div className="mt-7 flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/62" role="status">
                <LoaderCircle className="h-5 w-5 animate-spin text-payg" /> Stripe is confirming the payment. This can take a moment.
              </div>
            ) : stillConfirming ? (
              <div className="mt-7 rounded-xl border border-amber-300/20 bg-amber-300/10 p-5 text-amber-50" role="status">
                <p className="text-sm leading-6 text-amber-50/85">
                  Stripe has not returned the final confirmation yet. Your reference is safe; checking again will not create another charge.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setPollGeneration((value) => value + 1)}
                    className="inline-flex min-h-[46px] items-center justify-center rounded-xl bg-payg px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-payg-hover focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Check again
                  </button>
                  <a
                    href="mailto:support@zeroalphafitness.co.uk"
                    className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-amber-50/20 px-5 py-3 text-sm font-bold text-amber-50 outline-none transition hover:bg-amber-50/10 focus-visible:ring-2 focus-visible:ring-amber-50"
                  >
                    Contact support
                  </a>
                </div>
              </div>
            ) : error ? (
              <div className="mt-7 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-red-100">
                <p role="alert" className="text-sm leading-6">{error}</p>
                <button
                  type="button"
                  onClick={() => setPollGeneration((value) => value + 1)}
                  className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-xl bg-[#f2eee8] px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white"
                >
                  Try checking again
                </button>
              </div>
            ) : orderTerminal ? (
              <>
                <p className="mt-5 text-base leading-7 text-white/65">
                  {confirmed
                    ? `Payment is confirmed for ${orderTerminal.order.attendeeName}. This receipt is for one specific class, not a reusable credit.`
                    : orderTerminal.state === "refund_pending"
                    ? "Your class place has been cancelled and the eligible refund is being processed."
                    : orderTerminal.state === "refunded"
                    ? "The payment for this class has been refunded."
                    : orderTerminal.state === "cancelled"
                    ? "This class booking has been cancelled."
                    : orderTerminal.state === "no_show"
                    ? "This booking was recorded as a no-show and is non-refundable."
                    : "A payment dispute is open for this booking. Contact Zero Alpha Fitness if you need help."}
                </p>

                <dl className="mt-7 grid gap-5 border-y border-dashed border-white/16 py-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/38">Class</dt>
                    <dd className="mt-2 font-heading text-3xl uppercase text-white">{orderTerminal.order.class.title}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/38">Paid</dt>
                    <dd className="mt-2 font-heading text-3xl text-white">{formatMoney(orderTerminal.order.amountPence)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/38">When</dt>
                    <dd className="mt-2 flex items-start gap-2 text-sm leading-6 text-white/70"><CalendarDays className="mt-1 h-4 w-4 shrink-0 text-payg" /> {formatDateTime(orderTerminal.order.class.startTime, orderTerminal.order.class.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-white/38">Location</dt>
                    <dd className="mt-2 flex items-start gap-2 text-sm leading-6 text-white/70"><MapPin className="mt-1 h-4 w-4 shrink-0 text-payg" /> {orderTerminal.order.class.location || "Zero Alpha Fitness"}</dd>
                  </div>
                </dl>

                <p className="mt-5 text-sm leading-6 text-white/48">
                  Reference <span className="font-mono text-white/72">{orderTerminal.order.reference}</span>. Cancellation refund deadline: {formatDateTime(orderTerminal.order.cancellationCutoffAt, orderTerminal.order.class.timezone)}. The class cannot be transferred or rescheduled.
                </p>

                {confirmed && orderTerminal.cancellation.token ? (
                  <Link
                    to={`/pay-as-you-go/cancel?token=${encodeURIComponent(orderTerminal.cancellation.token)}`}
                    className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-payg"
                  >
                    Cancel this class
                  </Link>
                ) : null}
              </>
            ) : reviewTerminal ? (
              <div className="mt-6" role="status">
                <p className="text-base leading-7 text-white/70">
                  {reviewTerminal.state === "refund_pending"
                    ? "This payment did not create a usable class booking. An automatic refund is being processed."
                    : reviewTerminal.state === "refunded"
                    ? "This payment did not create a usable class booking and has been refunded."
                    : "This payment needs support review. No class booking can be managed from this receipt."}
                </p>
                <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/60">
                  Support reference <span className="font-mono text-white/80">{reviewTerminal.review.reference}</span>.
                  {reviewTerminal.review.supportRequired
                    ? " Please include it when contacting Zero Alpha Fitness."
                    : " You do not need to retry payment while the refund is processing."}
                </div>
                {reviewTerminal.review.supportRequired ? (
                  <a
                    href={`mailto:support@zeroalphafitness.co.uk?subject=${encodeURIComponent(`PAYG support ${reviewTerminal.review.reference}`)}`}
                    className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-payg px-5 py-3 text-sm font-black text-black outline-none transition hover:bg-payg-hover focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Contact support
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-6 text-sm leading-7 text-white/60">We can’t identify the returned checkout. Use the complete Stripe return link or contact support.</p>
            )}
          </div>
        </section>

        <div className="mt-7 flex flex-wrap gap-5 text-sm font-bold">
          <Link to="/pay-as-you-go" className="text-payg underline decoration-payg/40 underline-offset-4">View more classes</Link>
          <a href="mailto:support@zeroalphafitness.co.uk" className="text-white/55 underline decoration-white/20 underline-offset-4">Contact support</a>
        </div>
      </div>
    </main>
  );
}
