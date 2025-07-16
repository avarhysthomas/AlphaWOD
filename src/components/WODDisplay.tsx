import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Dumbbell,
  Timer,
  CalendarDays,
  Flame,
  NotebookPen,
  Sun,
  Moon,
} from 'lucide-react';

const WODDisplay = () => {
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [sessionKey, setSessionKey] = useState<'AM' | 'PM' | '930AM'>('AM');
  const dayName = new Date(selectedDate).toLocaleDateString('en-GB', {
    weekday: 'long',
  });
  
  const strengthTitle =
    dayName === 'Tuesday'
      ? 'Upper Strength'
      : dayName === 'Thursday'
      ? 'Lower Strength'
      : 'Strength Work';

    const fetchWODForDate = async (dateString: string, key: 'AM' | 'PM' | '930AM') => {
      try {
        const docRef = doc(db, 'wods', dateString);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          const sessionData = data[key];
          setWod(sessionData || null);
        } else {
          setWod(null);
        }
      } catch (error) {
        console.error('Error fetching WOD:', error);
        setWod(null);
      }
    };

  useEffect(() => {
    const today = new Date();
    const isoToday = today.toISOString().split('T')[0];
    setSelectedDate(isoToday);
  }, []);

  useEffect(() => {
  if (selectedDate) {
    fetchWODForDate(selectedDate, sessionKey);
  }
}, [selectedDate, sessionKey]);


  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSelectedDate(value);
  };

  return (
    <div className="bg-black text-white min-h-screen flex flex-col items-center p-4 sm:p-6 pb-24 space-y-6">
      <div className="w-full max-w-7xl flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              className="p-2 rounded bg-neutral-800 text-white border border-steel w-full sm:w-auto"
            />
            <button
              onClick={() => setSessionKey('AM')}
              className={`px-4 py-2 rounded ${sessionKey === 'AM' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
            >
              AM <Sun className="inline ml-1 w-4 h-4" />
            </button>
            <button
              onClick={() => setSessionKey('930AM')}
              className={`px-4 py-2 rounded ${sessionKey === '930AM' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
            >
              9:30AM
            </button>
            <button
              onClick={() => setSessionKey('PM')}
              className={`px-4 py-2 rounded ${sessionKey === 'PM' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
            >
              PM <Moon className="inline ml-1 w-4 h-4" />
            </button>
          </div>

        </div>
        {!wod ? (
          <div className="text-center text-xl">No WOD found for selected date.</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8">

            {/* LEFT PANEL */}
            <div className="space-y-6">
                <h1 className="text-8xl font-heading text-bone uppercase tracking-widest">AlphaFIT</h1>
                {wod.wodName && (
                  <h2 className="text-4xl font-bold text-white italic mb-4 tracking-tight">{wod.wodName}</h2>
                )}
              <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 space-y-4 w-full sm:max-w-md shadow-md">
              <div className="flex items-center gap-2 text-xl font-semibold text-white">
                <CalendarDays className="w-6 h-6 text-bone" />
                {new Date(selectedDate).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
              <div className="text-bone text-base flex items-center gap-2">
                <span className="font-bold">Type:</span> {wod.sessionType}
              </div>
              {wod.wodType && (
                <div className="text-bone text-base flex items-center gap-2">
                  <span className="font-bold">Style:</span> {wod.wodType}
                </div>
              )}
              {wod.wodStructure && (
                <div className="text-bone text-base flex items-center gap-2">
                  <span className="font-bold">Format:</span> {wod.wodStructure}
                </div>
              )}
              {wod.duration && (
                <div className="text-bone text-base flex items-center gap-2">
                  <span className="font-bold">Duration:</span> {wod.duration}
                </div>
              )}
              {wod.rounds && (
                <div className="text-bone text-base flex items-center gap-2">
                  <span className="font-bold">Rounds:</span> {wod.rounds}
                </div>
              )}
              <div className="text-bone text-base flex items-start gap-2">
                <NotebookPen className="w-5 h-5 text-bone mt-1" />
                <div>
                  <span className="font-bold">Notes:</span> {wod.notes || '—'}
                </div>
              </div>
            </div>


              <div className="flex justify-center mt-10">
                <img
                  src="/ZERO-ALPHA.png"
                  alt="Zero Alpha Fitness Logo"
                  className="h-65 object-contain"
                />
              </div>
            </div>

            {/* RIGHT PANEL */}
            {wod.sessionType === 'Strength' && (
                <div>
                  <h3 className="text-3xl font-bold text-bone uppercase mb-6 text-center w-full">{strengthTitle}</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {wod.strengthMovements?.map((sm: any, index: number) => (
                      <div
                        key={index}
                        className="flex flex-col gap-1 px-4 py-3 rounded-lg bg-neutral-800 border border-neutral-700 shadow transition hover:scale-[1.01]"
                      >
                        <div className="text-white text-lg font-semibold">
                          <span className="flex items-center gap-2">
                            <Dumbbell className="w-5 h-5 text-bone" /> {sm.movement}
                          </span>
                        </div>
                        <div className="text-base text-neutral-300">
                          {sm.sets} × {sm.reps} 
                          {sm.rpe && ` @ RPE ${sm.rpe}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            {wod.sessionType !== 'Strength' && (
              <div className="flex flex-col items-center text-center space-y-6">
                <h3 className="text-4xl font-bold text-bone uppercase">The WOD</h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg text-white w-full">
                  {wod.movements?.map((move: any, index: number) => (
                    <li
                      key={index}
                      className="flex flex-col gap-2 bg-neutral-800 p-4 rounded-xl border border-neutral-700 shadow"
                    >
                      {wod.wodStructure === 'Individual' ? (
                        <div className="flex items-center gap-4">
                          <Flame className="w-6 h-6 text-yellow-400 flex-shrink-0" />
                          <span className="text-lg font-medium text-left">{move.partner1}</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-white text-base">
                            <span className="flex items-center gap-2 font-semibold">
                              <Flame className="w-4 h-4 text-yellow-400" /> Partner 1:
                            </span>
                            <span>{move.partner1}</span>
                          </div>
                          <div className="flex items-center justify-between text-white text-base">
                            <span className="flex items-center gap-2 font-semibold">
                              <Dumbbell className="w-4 h-4 text-blue-400" /> Partner 2:
                            </span>
                            <span>{move.partner2}</span>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WODDisplay;
