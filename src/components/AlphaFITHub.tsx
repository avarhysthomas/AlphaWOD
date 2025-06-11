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

const AlphaFITHub = () => {
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isPM, setIsPM] = useState<boolean>(false);
  const dayName = new Date(selectedDate).toLocaleDateString('en-GB', {
    weekday: 'long',
  });
  
  const strengthTitle =
    dayName === 'Tuesday'
      ? 'Upper Strength'
      : dayName === 'Thursday'
      ? 'Lower Strength'
      : 'Strength Work';

  const fetchWODForDate = async (dateString: string, isPMClass: boolean) => {
    try {
      const docRef = doc(db, 'wods', dateString);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const sessionKey = isPMClass ? 'PM' : 'AM';
        const sessionData = data[sessionKey];

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
      fetchWODForDate(selectedDate, isPM);
    }
  }, [selectedDate, isPM]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSelectedDate(value);
  };

  return (
    <div className="bg-black text-white min-h-screen flex flex-col items-center p-4 sm:p-6 pb-24 space-y-6">
      <div className="w-full max-w-7xl flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              className="p-2 rounded bg-neutral-800 text-white border border-steel"
            />
            <button
              onClick={() => setIsPM(false)}
              className={`px-4 py-2 rounded ${!isPM ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
            >
              AM <Sun className="inline ml-1 w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPM(true)}
              className={`px-4 py-2 rounded ${isPM ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
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
                <h1 className="text-9xl font-heading text-bone uppercase tracking-widest">AlphaFIT</h1>
              <h2 className="text-3xl font-semibold text-bone flex items-center gap-2">
                <CalendarDays className="w-6 h-6" />
                {selectedDate}
              </h2>
              <p className="text-xl text-bone">
                Type: <span className="font-bold uppercase">{wod.sessionType}</span>
              </p>

              {(wod.sessionType === 'WOD' || wod.sessionType === 'HYROX') && (
                <>
                  <p className="text-xl text-bone">
                    Style: <span className="uppercase font-semibold">{wod.wodType}</span>
                  </p>
                  {wod.wodStructure && (
                    <p className="text-base text-bone">Structure: {wod.wodStructure}</p>
                  )}
                  {wod.duration && (
                    <p className="text-base flex items-center gap-2">
                      <Timer className="w-5 h-5" /> Duration: {wod.duration}
                    </p>
                  )}
                  {wod.rounds && (
                    <p className="text-base">Rounds: <span className="font-semibold">{wod.rounds}</span></p>
                  )}
                </>
              )}



              <div className="text-lg text-bone flex items-center gap-2">
                <NotebookPen className="w-5 h-5 text-bone" />
                <span className="font-bold">Notes:</span> {wod.notes || '—'}
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

export default AlphaFITHub;
