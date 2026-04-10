import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebase";
import { useNavigate } from "react-router-dom";
import AuthShell from "../components/AuthShell";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/schedule", { replace: true });
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
      footerTo="/signup"
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
    </AuthShell>
  );
};

export default Login;
