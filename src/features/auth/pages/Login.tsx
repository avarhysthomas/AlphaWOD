import React, { useState } from "react";
import { sendEmailVerification, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebaseApp";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import { readPendingClaim } from "../../memberships/services/membership";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = (location.state as {
    from?: {pathname?: unknown; search?: unknown; hash?: unknown};
  } | null)?.from;
  const safeReturnPath = typeof from?.pathname === "string" &&
      from.pathname.startsWith("/") && !from.pathname.startsWith("//") ?
    `${from.pathname}${typeof from.search === "string" ? from.search : ""}` +
      `${typeof from.hash === "string" ? from.hash : ""}` : null;
  const membershipRecoveryRequested = searchParams.get("membership") === "1" ||
    safeReturnPath?.startsWith("/account/membership?claim=email") === true;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (membershipRecoveryRequested && !credential.user.emailVerified) {
        await sendEmailVerification(credential.user, {
          url: `${window.location.origin}/account/membership?claim=email`,
        });
      }
      navigate(
        safeReturnPath ?? (readPendingClaim() || membershipRecoveryRequested ?
          "/account/membership" : "/schedule"),
        {
          replace: true,
        }
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Member Login"
      title="Train, book, and track with Zero Alpha."
      description="Sign in to Zero Alpha to manage classes, training progress, leaderboards, and your profile."
      footerPrompt="Don’t have an account yet?"
      footerLabel="Create one"
      footerTo={membershipRecoveryRequested ? "/signup?membership=1" : "/signup"}
    >
      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <h2 className="text-2xl font-heading tracking-tight text-white">Welcome back</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            Pick up where you left off.
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

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

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-neutral-300">Password</span>
          <input
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/40 focus:bg-white/[0.06]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[linear-gradient(135deg,#fde68a,#f59e0b)] px-4 py-3 font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Signing in..." : "Log In"}
        </button>
      </form>
      <div className="mt-6 border-t border-white/10 pt-5">
        <p className="text-sm leading-6 text-neutral-400">Not looking for the member app?</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold">
          <Link to="/pay-as-you-go" className="text-amber-200 underline decoration-amber-400/40 underline-offset-4 transition hover:text-amber-100">
            Book one PAYG class
          </Link>
          <Link to="/memberships" className="text-white/65 underline decoration-white/20 underline-offset-4 transition hover:text-white">
            View memberships
          </Link>
        </div>
      </div>
    </AuthShell>
  );
};

export default Login;
