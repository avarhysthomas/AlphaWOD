// Signup.tsx
import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Write user profile with default role "user"
      await setDoc(doc(db, 'users', uid), {
        email,
        name,
        role: 'user'
      });

      navigate('/schedule');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <form onSubmit={handleSignup} className="bg-neutral-900 p-8 rounded-lg shadow-md space-y-4 w-full max-w-sm">
        <h1 className="text-3xl font-bold mb-4">Join AlphaFIT</h1>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <input
          type="text"
          placeholder="Name"
          className="w-full p-2 rounded bg-neutral-800 text-white"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

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
          Sign Up
        </button>

        <p className="text-sm mt-4">Already have an account? <a href="/login" className="text-blue-400 underline">Log in</a></p>
      </form>
    </div>
  );
};

export default Signup;
