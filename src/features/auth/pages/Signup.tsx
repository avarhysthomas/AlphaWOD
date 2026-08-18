import React, { useState } from "react";
import { auth } from "../../../firebase";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import { bootstrapUserProfile } from "../services/account";
import { readPendingClaim } from "../../memberships/services/membership";

const Signup = () => {
  const [searchParams] = useSearchParams();
  const invitedEmail = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const membershipRecoveryRequested = searchParams.get("membership") === "1";
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const hasPendingMembershipClaim =
    readPendingClaim() !== null || membershipRecoveryRequested;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await bootstrapUserProfile(name);
      if (membershipRecoveryRequested) {
        await sendEmailVerification(credential.user, {
          url: `${window.location.origin}/account/membership?claim=email`,
        });
      }

      navigate(hasPendingMembershipClaim ? "/account/membership" : "/pending-approval");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={hasPendingMembershipClaim ? "Claim Membership" : "Request Access"}
      title={hasPendingMembershipClaim ? "Finish setting up your membership." : "Welcome to Zero Alpha."}
      description={
        hasPendingMembershipClaim
          ? "Create your account and we’ll securely link the membership you just purchased."
          : "New accounts stay in review until an admin approves access."
      }
      footerPrompt="Already have an account?"
      footerLabel="Log in"
      footerTo={membershipRecoveryRequested ? "/?membership=1" : "/"}
    >
      <form onSubmit={handleSignup} className="space-y-5">
        <div>
          <h2 className="text-2xl font-heading tracking-tight text-white">Join Zero Alpha</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            {hasPendingMembershipClaim
              ? "Use this account to manage your membership and any access included with it."
              : "New accounts stay in review until an admin approves access."}
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-neutral-300">Full name</span>
          <input
            type="text"
            placeholder=""
            autoComplete="name"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/40 focus:bg-white/[0.06]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-neutral-300">Email</span>
          <input
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/40 focus:bg-white/[0.06]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {invitedEmail ? (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-sm leading-6 text-emerald-100/90">
            This email was prefilled from your invite. You can create your account with it here.
          </div>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-neutral-300">Password</span>
          <input
            type="password"
            placeholder="Choose a secure password"
            autoComplete="new-password"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/40 focus:bg-white/[0.06]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-100/90">
          {hasPendingMembershipClaim
            ? "After sign-up, we’ll link your purchase and show its current confirmation status."
            : "After sign-up, you’ll land on a waiting screen until an admin approves your account."}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[linear-gradient(135deg,#fde68a,#f59e0b)] px-4 py-3 font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </AuthShell>
  );
};

export default Signup;
