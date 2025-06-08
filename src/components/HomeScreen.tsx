import React from 'react';
import { useNavigate } from 'react-router-dom';

const HomeScreen = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 space-y-8">
      <h1 className="text-5xl font-heading tracking-widest uppercase">AlphaFIT</h1>
      <p className="text-xl italic text-center text-bone max-w-xs">Wherever we go, we go together.</p>

      <div className="w-full max-w-xs space-y-4 mt-8">
        <button
          onClick={() => navigate('/display')}
          className="w-full bg-white text-black py-3 rounded font-bold hover:bg-bone transition"
        >
          View Today’s WOD
        </button>
        <button
          onClick={() => navigate('/editor')}
          className="w-full bg-neutral-700 text-white py-3 rounded font-bold hover:bg-neutral-600 transition"
        >
          Log New Workout
        </button>
        <button
          onClick={() => navigate('/past')}
          className="w-full bg-neutral-700 text-white py-3 rounded font-bold hover:bg-neutral-600 transition"
        >
          Past Sessions
        </button>
      </div>
    </div>
  );
};

export default HomeScreen;
