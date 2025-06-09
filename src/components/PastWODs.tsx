import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { CalendarDays, Dumbbell, Flame, NotebookPen, Timer } from 'lucide-react';

const PastWODs = () => {
  const [wods, setWods] = useState<any[]>([]);

  useEffect(() => {
    const fetchWODs = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'wods'));
        const today = new Date();

        const filtered = snapshot.docs
          .filter(doc => {
            const dateParts = doc.id.split('-');
            if (dateParts.length !== 3) return false;
            const docDate = new Date(`${doc.id}T00:00:00`);
            return docDate <= today;
          })
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .map(doc => ({ id: doc.id, ...doc.data() }));

        setWods(filtered);
      } catch (err) {
        console.error('Failed to fetch WODs:', err);
      }
    };

    fetchWODs();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-6 space-y-8 pb-24">
      <h1 className="text-4xl font-heading text-bone text-center uppercase tracking-widest">Past AlphaWODs</h1>
      {wods.length === 0 ? (
        <p className="text-center">No Sessions found.</p>
      ) : (
        wods.map(wod => (
          <div key={wod.id} className="bg-neutral-900 border border-steel rounded-xl p-6 shadow space-y-8">
            {['AM', 'PM'].map(period => (
              wod[period] ? (
                <div key={period} className="space-y-4">
                  <h2 className="text-2xl font-semibold text-bone flex items-center gap-2">
                    <CalendarDays className="w-5 h-5" />
                    {wod.id} — {period} Session
                  </h2>

                  <p className="text-bone text-lg">Type: <span className="font-medium">{wod[period].sessionType}</span></p>

                  {(wod[period].sessionType === 'WOD' || wod[period].sessionType === 'HYROX') && (
                    <>
                      <p className="text-bone">Style: <span className="font-medium">{wod[period].wodType}</span></p>
                      {wod[period].wodStructure && <p className="text-bone">Structure: <span className="font-medium">{wod[period].wodStructure}</span></p>}
                      {wod[period].wodType === 'AMRAP' && <p className="flex items-center gap-2"><Timer className="w-4 h-4 text-bone" /> Duration: {wod[period].duration}</p>}
                      {wod[period].wodType === 'For Time' && <p className="text-bone">Rounds: {wod[period].rounds}</p>}
                      {wod[period].wodType === 'EMOM' && <p className="flex items-center gap-2"><Timer className="w-4 h-4 text-bone" /> Minutes: {wod[period].duration}</p>}
                      <div>
                        <span className="font-bold text-bone">Movements:</span>
                        <div className="mt-4 grid gap-3">
                          {wod[period].movements?.map((move: any, index: number) => (
                            <div
                              key={index}
                              className="flex flex-col gap-1 px-4 py-3 rounded-lg bg-neutral-800 border border-neutral-700 shadow transition hover:scale-[1.01]"
                            >
                              <div className="flex justify-between items-center text-sm text-bone uppercase font-bold tracking-wide">
                                <span>Station {index + 1}</span>
                                <span>{wod[period].wodStructure}</span>
                              </div>
                              {wod[period].wodStructure === 'Individual' ? (
                                <div className="flex justify-between text-white text-base">
                                  <span className="flex items-center gap-2 font-semibold">
                                    <Flame className="w-4 h-4 text-yellow-400" /> Movement:
                                  </span>
                                  <span>{move.partner1}</span>
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
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {wod[period].sessionType === 'Strength' && (
                    <div>
                      <span className="font-bold text-bone">Strength Movements:</span>
                      <div className="mt-4 grid gap-3">
                        {wod[period].strengthMovements?.map((sm: any, index: number) => (
                          <div
                            key={index}
                            className="flex flex-col gap-1 px-4 py-3 rounded-lg bg-neutral-800 border border-neutral-700 shadow transition hover:scale-[1.01]"
                          >
                            <div className="flex justify-between items-center text-white text-base font-semibold">
                              <span className="flex items-center gap-2">
                                <Dumbbell className="w-5 h-5 text-bone" /> {sm.movement}
                              </span>
                              <span>{sm.sets} × {sm.reps} reps</span>
                            </div>
                            {sm.rpe && (
                              <div className="text-sm text-neutral-400 font-medium pl-7">
                                RPE {sm.rpe}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-bone">
                    <NotebookPen className="w-5 h-5 text-bone" />
                    <span className="font-bold">Notes:</span> {wod[period].notes || '—'}
                  </div>
                </div>
              ) : null
            ))}
          </div>
        ))
      )}
    </div>
  );
};

export default PastWODs;
