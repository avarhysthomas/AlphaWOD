// Login.tsx
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/schedule", { replace: true });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <form onSubmit={handleLogin} className="bg-neutral-900 p-8 rounded-lg shadow-md space-y-4 w-full max-w-sm">
        <h1 className="text-3xl font-bold mb-4">Login to AlphaFIT</h1>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <input  
          type="email"
          placeholder="Email"
          className="w-full p-2 rounded bg-neutral-800 text-white"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full p-2 rounded bg-neutral-800 text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          className="w-full bg-white text-black py-2 rounded font-bold"
        >
          Login
        </button>

        <p className="text-sm mt-4">Don't have an account? <a href="/signup" className="text-blue-400 underline">Sign up</a></p>
      </form>
    </div>
  );
};

export default Login;