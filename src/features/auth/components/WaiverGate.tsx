import React, { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";

const WAIVER_VERSION = "2026-30-05";

const requiredAcknowledgements = [
  "I have read and understood this Agreement and accept the risks in Clause 3.",
  "I will follow all instructions and rules and take responsibility for my own pacing under Clause 4.",
  "I will disclose relevant medical conditions and stop if unwell under Clause 2.",
  "I understand the release/indemnity and the UK carve-out for negligence in Clause 5.",
  "I understand the data processing summary and where to find the Privacy Notice under Clause 8.",
  "If applicable, I agree to the Membership Terms under Clause 10.",
];

function needsCurrentWaiver(appUser: ReturnType<typeof useAuth>["appUser"]) {
  return appUser?.waiverAcceptedVersion !== WAIVER_VERSION;
}

function getLocalWaiverKey(uid: string) {
  return `zaf-waiver-accepted:${uid}:${WAIVER_VERSION}`;
}

function hasLocalWaiver(uid: string) {
  try {
    return window.localStorage.getItem(getLocalWaiverKey(uid)) === "true";
  } catch {
    return false;
  }
}

function rememberLocalWaiver(uid: string) {
  try {
    window.localStorage.setItem(getLocalWaiverKey(uid), "true");
  } catch {
    // Firestore remains the source of truth if local storage is unavailable.
  }
}

export default function WaiverGate({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading, refreshAppUser } = useAuth();
  const [signature, setSignature] = useState("");
  const [acknowledgements, setAcknowledgements] = useState<boolean[]>(
    () => requiredAcknowledgements.map(() => false)
  );
  const [mediaConsent, setMediaConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signedThisSession, setSignedThisSession] = useState(false);
  const [error, setError] = useState("");

  const suggestedName = useMemo(
    () => appUser?.name?.trim() || user?.displayName?.trim() || "",
    [appUser?.name, user?.displayName]
  );

  const signedOnThisDevice = !!user && hasLocalWaiver(user.uid);

  if (
    loading ||
    !user ||
    !appUser ||
    signedThisSession ||
    signedOnThisDevice ||
    !needsCurrentWaiver(appUser)
  ) {
    return <>{children}</>;
  }

  const typedName = signature.trim();
  const confirmedAll = acknowledgements.every(Boolean);
  const canSign = typedName.length >= 2 && confirmedAll && !submitting;

  const handleSign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSign) return;

    try {
      setSubmitting(true);
      setError("");
      await setDoc(
        doc(db, "users", user.uid),
        {
          waiverAcceptedAt: serverTimestamp(),
          waiverAcceptedBy: user.uid,
          waiverAcceptedEmail: user.email ?? null,
          waiverAcceptedName: typedName,
          waiverAcceptedVersion: WAIVER_VERSION,
          waiverAcknowledgements: requiredAcknowledgements,
          waiverMediaConsent: mediaConsent,
        },
        { merge: true }
      );
      rememberLocalWaiver(user.uid);
      setSignedThisSession(true);
      await refreshAppUser();
    } catch (err) {
      console.error("Failed to record waiver acceptance:", err);
      setError("We could not save your waiver yet. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="carbon-fiber-bg fixed inset-0 z-50 overflow-y-auto px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center">
        <form
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
              Participation Agreement, Assumption of Risk & Liability Waiver
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-neutral-500">
              Jurisdiction: England & Wales | Version: {WAIVER_VERSION}
            </p>
          </div>

          <div className="max-h-[52vh] overflow-y-auto px-5 py-5 text-sm leading-6 text-neutral-200 sm:px-8">
            <h2 className="font-semibold uppercase tracking-[0.16em] text-amber-200">
              Important - please read carefully
            </h2>
            <p>
              By tapping "I agree" you confirm you have read, understood, and accept this
              Agreement. If you do not agree, do not participate in any Zero Alpha Fitness
              ("ZAF") activities.
            </p>

            <h3 className="mt-5 font-semibold text-white">1) Parties & Scope</h3>
            <p className="mt-4">
              This Agreement is between Zero Alpha Fitness Ltd ("ZAF", "we", "our") and you
              ("Participant", "you", "your"). It applies to all ZAF services and activities
              you access, including but not limited to coached classes, open gym, events,
              workshops, online/remote programming, challenges, use of equipment, and any
              activities at partner or third-party facilities (collectively, "Activities").
            </p>

            <h3 className="mt-5 font-semibold text-white">2) Health, Fitness & Medical Disclosure</h3>
            <p className="mt-4">
              a) You confirm you are physically able to participate and have disclosed any
              relevant medical conditions, injuries, pregnancy, medications, or limitations.
            </p>
            <p className="mt-3">
              b) You agree to consult a qualified healthcare professional before starting or
              changing any exercise program and to follow their advice.
            </p>
            <p className="mt-4">
              c) You must immediately stop any Activity that causes unusual pain, dizziness,
              chest pain, shortness of breath beyond normal exertion, or any symptom of
              concern, and inform a coach.
            </p>

            <h3 className="mt-5 font-semibold text-white">3) Assumption of Risks</h3>
            <p className="mt-4">
              You understand that fitness Activities involve inherent risks, including but
              not limited to muscle strains/tears, joint injuries, slips, trips, falls,
              equipment failure, collisions, acute or chronic health events, and - rarely -
              serious injury or death. Risks may arise from your own actions/inactions,
              actions of others, the facility, equipment, environment, and programming
              variability. You voluntarily and knowingly accept all such risks to the
              fullest extent permitted by law.
            </p>

            <h3 className="mt-5 font-semibold text-white">4) Personal Responsibility & Compliance</h3>
            <p className="mt-4">You agree to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Follow all ZAF rules, signage, coach instructions, and safety briefings.</li>
              <li>Use equipment only as instructed and report defects immediately.</li>
              <li>Wear appropriate clothing/footwear and maintain good hygiene.</li>
              <li>Not participate while under the influence of alcohol, illegal substances, or impairing medications.</li>
              <li>Not exceed your own abilities; request alternatives or modifications when needed.</li>
            </ul>

            <h3 className="mt-5 font-semibold text-white">5) Release of Liability & Indemnity</h3>
            <p className="mt-4">
              a) To the fullest extent permitted by law, you release and discharge ZAF, its
              owners, directors, employees, coaches, contractors, and agents from any
              liability for loss, damage, or injury you may suffer arising from participation
              in the Activities.
            </p>
            <p className="mt-3">
              b) Nothing in this Agreement excludes or limits liability for death or personal
              injury caused by ZAF's negligence, fraud, or any liability that cannot be
              excluded under the Unfair Contract Terms Act 1977 or other applicable law.
            </p>
            <p className="mt-3">
              c) You agree to indemnify ZAF for reasonable losses or third-party claims
              arising from your breach of this Agreement or unsafe/unauthorised conduct.
            </p>

            <h3 className="mt-5 font-semibold text-white">6) Property & Valuables</h3>
            <p className="mt-4">
              You are responsible for your personal belongings. ZAF is not liable for loss,
              theft, or damage to personal property brought onto premises.
            </p>

            <h3 className="mt-5 font-semibold text-white">7) Minors</h3>
            <p className="mt-4">
              Participants under 18 require a Parent/Guardian Consent (see Addendum) and
              must follow additional supervision rules set by ZAF.
            </p>

            <h3 className="mt-5 font-semibold text-white">8) Data Protection & Privacy (UK GDPR)</h3>
            <p className="mt-4">
              a) ZAF processes your personal data (e.g., identity details, contact info,
              health flags you voluntarily disclose, attendance, training logs, payments if
              applicable) as a controller to: deliver services, ensure safety, manage
              accounts, and comply with legal obligations.
            </p>
            <p className="mt-3">
              b) Lawful bases include contract, legitimate interests (safety, operations),
              consent (where required, e.g., marketing or special-category health notes you
              choose to share), and legal obligations.
            </p>
            <p className="mt-3">
              c) You have rights to access, rectification, erasure, restriction, objection,
              and data portability, subject to law.
            </p>
            <p className="mt-3">
              d) We retain data only as long as necessary. See our Privacy Notice in-app for
              details of processors, transfers, retention, and your rights.
            </p>
            <p className="mt-3">e) You may withdraw marketing consent at any time in settings.</p>

            <h3 className="mt-5 font-semibold text-white">9) Media & Testimonials (Optional)</h3>
            <p className="mt-4">
              You may be photographed/filmed at sessions. By opting-in, you grant ZAF a
              royalty-free licence to use your image/likeness and testimonials for marketing
              across media, with reasonable edits. Opt-in is not required to participate and
              can be withdrawn for future use (not retroactive).
            </p>

            <h3 className="mt-5 font-semibold text-white">10) Membership, Payments & Cancellations (If Applicable)</h3>
            <p className="mt-4">
              a) Membership terms, billing cycles, auto-renewal, cancellation windows,
              no-show/late-cancel fees, and class credits are set out in the in-app
              Membership Terms.
            </p>
            <p className="mt-3">
              b) You agree to those terms when purchasing; they form part of this Agreement.
            </p>

            <h3 className="mt-5 font-semibold text-white">11) Emergencies & First Aid</h3>
            <p className="mt-4">
              You authorise ZAF staff or emergency responders to provide first aid and to
              arrange medical treatment if reasonably required. You are responsible for
              related costs.
            </p>

            <h3 className="mt-5 font-semibold text-white">12) Severability & Variation</h3>
            <p className="mt-4">
              If any clause is found invalid or unenforceable, the remaining clauses remain
              in force. ZAF may update this Agreement from time to time; we will notify you
              in-app and request renewed consent if changes are material.
            </p>

            <h3 className="mt-5 font-semibold text-white">13) Governing Law & Jurisdiction</h3>
            <p className="mt-4">
              This Agreement is governed by the laws of England & Wales, and the courts of
              England & Wales shall have exclusive jurisdiction, without affecting your
              statutory rights.
            </p>

            <h3 className="mt-5 font-semibold text-white">14) Acknowledgements</h3>
            <p className="mt-4">
              By agreeing, you confirm each acknowledgement below. Electronic Consent: By
              tapping "I agree", you sign this Agreement electronically. Signature / Consent
              Timestamp: captured by the app. Version: {WAIVER_VERSION}.
            </p>
          </div>

          <div className="space-y-4 border-t border-white/10 px-5 py-5 sm:px-8">
            {error ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
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
                onChange={(event) => setSignature(event.target.value)}
                placeholder={suggestedName || "Full name"}
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
                      setAcknowledgements(next);
                    }}
                    className="mt-1 h-4 w-4 accent-amber-400"
                  />
                  <span>{acknowledgement}</span>
                </label>
              ))}

              <label className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-neutral-200">
                <input
                  type="checkbox"
                  checked={mediaConsent}
                  onChange={(event) => setMediaConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-amber-400"
                />
                <span>
                  Optional: I consent to media and testimonial usage under Clause 9.
                </span>
              </label>
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
