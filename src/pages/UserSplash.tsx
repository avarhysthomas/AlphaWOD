// UserSplash.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';

const UserSplash = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center space-y-8 px-4">
      <h1 className="text-5xl font-heading font-bold uppercase tracking-widest">AlphaFIT</h1>
      <p className="text-lg italic text-gray-300">Wherever we go, we go together.</p>

      <div className="w-full max-w-xs space-y-4">
      <button
        className="w-full bg-white text-black py-3 rounded font-bold text-sm"
        onClick={() => navigate('/show')}
      >
        View Today’s WOD
      </button>

      <button
        className="w-full bg-neutral-600 text-white py-3 rounded font-bold text-sm"
        onClick={() => navigate('/timetable')}
      >
        Book a Class
      </button>
        <button
          className="w-full bg-neutral-700 text-white py-3 rounded font-bold text-sm"
          onClick={() => navigate('/log')}
        >
          Log New Workout
        </button>

        <button
          className="w-full bg-neutral-800 text-white py-3 rounded font-bold text-sm border border-neutral-600"
          onClick={() => navigate('/past')}
        >
          Past Sessions
        </button>
      </div>
    </div>
  );
};

export default UserSplash;
