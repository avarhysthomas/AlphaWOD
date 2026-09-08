import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { hasAlphaWodAccess } from "../../../context/authUser";
import {
  CHECKOUT_DOCUMENTS,
  resolveCheckoutAcceptanceStatements,
} from "../../../lib/membershipPlans";

const adultWaiver = CHECKOUT_DOCUMENTS.adultWaiver;
const adultWaiverAcceptance = resolveCheckoutAcceptanceStatements(
  "adult_unlimited"
).find(({id}) => id === "adult_participant_waiver");

if (!adultWaiverAcceptance) {
  throw new Error("The canonical Adult Waiver acceptance statement is missing.");
}

const WAIVER_VERSION = adultWaiver.version;
const requiredAcknowledgements = [adultWaiverAcceptance.statement];
const LOCAL_TEST_USER_EMAILS = new Set([
  "dev-admin@zeroalpha.test",
  "dev-member@zeroalpha.test",
]);

export function shouldBypassWaiverForLocalTestUser({
  nodeEnv,
  useEmulators,
  email,
}: {
  nodeEnv?: string;
  useEmulators?: string;
  email?: string | null;
}) {
  return nodeEnv === "development" &&
    useEmulators === "true" &&
    typeof email === "string" &&
    LOCAL_TEST_USER_EMAILS.has(email.trim().toLowerCase());
}

function needsCurrentWaiver(appUser: ReturnType<typeof useAuth>["appUser"]) {
  return (
    appUser?.waiverAcceptedVersion !== WAIVER_VERSION ||
    !appUser.waiverAcceptedAt
  );
}

function describeWaiverSaveError(error: unknown): string {
  const code = typeof error === "object" && error !== null &&
    typeof (error as {code?: unknown}).code === "string" ?
    (error as {code: string}).code : "";

  if (code.includes("failed-precondition")) {
    return "This waiver was updated while the page was open. Refresh the page, review the current version and sign again.";
  }
  if (code.includes("unauthenticated")) {
    return "Your sign-in expired before the waiver was saved. Refresh the page, sign in again and retry.";
  }
  if (code.includes("permission-denied")) {
    return "Your account could not save this waiver. Sign out and back in, then retry or contact support.";
  }
  return "We could not save your waiver yet. Check your connection and try again.";
}

type WaiverGateState = {
  uid: string | null;
  signature: string;
  acknowledgements: boolean[];
  submitting: boolean;
  signedUid: string | null;
  error: string;
};

function emptyWaiverGateState(uid: string | null): WaiverGateState {
  return {
    uid,
    signature: "",
    acknowledgements: requiredAcknowledgements.map(() => false),
    submitting: false,
    signedUid: null,
    error: "",
  };
}

export default function WaiverGate({
  children,
  bypass = false,
}: {
  children: React.ReactNode;
  bypass?: boolean;
}) {
  const { user, appUser, loading, refreshAppUser } = useAuth();
  const activeUid = user?.uid ?? null;
  const activeUidRef = useRef(activeUid);
  activeUidRef.current = activeUid;
  const [waiverState, setWaiverState] = useState<WaiverGateState>(
    () => emptyWaiverGateState(activeUid)
  );
  const scopedState = waiverState.uid === activeUid
    ? waiverState
    : emptyWaiverGateState(activeUid);
  const {signature, acknowledgements, submitting, signedUid, error} = scopedState;

  useEffect(() => {
    setWaiverState((current) =>
      current.uid === activeUid ? current : emptyWaiverGateState(activeUid)
    );
  }, [activeUid]);

  function updateScopedState(
    patch: Partial<Omit<WaiverGateState, "uid">>
  ) {
    setWaiverState((current) => ({
      ...(current.uid === activeUid ? current : emptyWaiverGateState(activeUid)),
      ...patch,
    }));
  }

  const suggestedName = useMemo(
    () => appUser?.name?.trim() || user?.displayName?.trim() || "",
    [appUser?.name, user?.displayName]
  );
  const localTestWaiverBypass = shouldBypassWaiverForLocalTestUser({
    nodeEnv: process.env.NODE_ENV,
    useEmulators: process.env.REACT_APP_USE_EMULATORS,
    email: user?.email,
  });

  // Billing, cancellation and the public legal/purchase routes must remain
  // reachable even when the participation waiver is outstanding. The waiver
  // controls workout access; it cannot condition access to payment controls.
  // The two fixed synthetic emulator personas bypass the unresolved waiver
  // rollover without writing fake legal evidence. Real users still fail closed.
  if (bypass || localTestWaiverBypass || !user) {
    return <>{children}</>;
  }

  if (loading || !appUser) {
    return (
      <div className="carbon-fiber-bg flex min-h-screen items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  if (
    !hasAlphaWodAccess(appUser) ||
    signedUid === activeUid ||
    !needsCurrentWaiver(appUser)
  ) {
    return <>{children}</>;
  }

  const typedName = signature.trim();
  const confirmedAll = acknowledgements.every(Boolean);
  const canSign = typedName.length >= 2 && confirmedAll && !submitting;

  const handleSign = async (event: React.FormEvent) => {
    event.preventDefault();
    const submissionUid = activeUid;
    if (!canSign || !submissionUid) return;

    try {
      setWaiverState({...scopedState, submitting: true, error: ""});
      const { acceptCurrentWaiver } = await import("../services/account");
      if (activeUidRef.current !== submissionUid) return;
      await acceptCurrentWaiver({
        acceptedName: typedName,
        waiverVersion: WAIVER_VERSION,
        acknowledgements: requiredAcknowledgements,
        mediaConsent: false,
      });
      if (activeUidRef.current !== submissionUid) return;
      setWaiverState((current) =>
        current.uid === submissionUid
          ? {...current, signedUid: submissionUid}
          : current
      );
      await refreshAppUser();
    } catch (err) {
      if (activeUidRef.current !== submissionUid) return;
      console.error("Failed to record waiver acceptance:", err);
      setWaiverState((current) =>
        current.uid === submissionUid
          ? {...current, error: describeWaiverSaveError(err)}
          : current
      );
    } finally {
      if (activeUidRef.current === submissionUid) {
        setWaiverState((current) =>
          current.uid === submissionUid
            ? {...current, submitting: false}
            : current
        );
      }
    }
  };

  return (
    <div className="carbon-fiber-bg fixed inset-0 z-50 overflow-y-auto px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center">
        <form
          aria-busy={submitting}
          onSubmit={handleSign}
          className="w-full rounded-lg border border-white/10 bg-[#101010] shadow-2xl shadow-black/50"
        >
          <div className="border-b border-white/10 px-5 py-5 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
              Required waiver
            </p>
            <h1 className="mt-3 font-heading text-3xl tracking-tight text-white sm:text-4xl">
              Zero Alpha Fitness
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-300">
              {adultWaiver.title}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-neutral-500">
              Jurisdiction: England & Wales | Version: {WAIVER_VERSION}
            </p>
          </div>

          <div className="max-h-[52vh] overflow-y-auto px-5 py-5 text-sm leading-6 text-neutral-200 sm:px-8">
            <div
              aria-label={adultWaiver.title}
              className="whitespace-pre-wrap"
              role="document"
            >
              {adultWaiver.content}
            </div>
            <a
              className="mt-5 inline-flex font-medium text-amber-200 underline underline-offset-4"
              href={adultWaiver.publicUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open the permanent text copy
            </a>
          </div>

          <div className="space-y-4 border-t border-white/10 px-5 py-5 sm:px-8">
            {error ? (
              <div
                id="waiver-save-error"
                role="alert"
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"
              >
                {error}
              </div>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-200">
                Type your full name to sign
              </span>
              <input
                type="text"
                autoComplete="name"
                value={signature}
                onChange={(event) => updateScopedState({signature: event.target.value})}
                placeholder={suggestedName || "Full name"}
                aria-describedby={error ? "waiver-save-error" : undefined}
                maxLength={160}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/50 focus:bg-white/[0.06]"
                required
              />
            </label>

            <div className="space-y-3">
              {requiredAcknowledgements.map((acknowledgement, index) => (
                <label
                  key={acknowledgement}
                  className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-neutral-200"
                >
                  <input
                    type="checkbox"
                    checked={acknowledgements[index]}
                    onChange={(event) => {
                      const next = [...acknowledgements];
                      next[index] = event.target.checked;
                      updateScopedState({acknowledgements: next});
                    }}
                    className="mt-1 h-4 w-4 accent-amber-400"
                  />
                  <span>{acknowledgement}</span>
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={!canSign}
              className="w-full rounded-lg bg-[linear-gradient(135deg,#fde68a,#f59e0b)] px-4 py-3 font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving agreement..." : "I agree"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
