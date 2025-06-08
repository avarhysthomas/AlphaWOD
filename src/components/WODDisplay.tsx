import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Dumbbell, Timer, CalendarDays, Flame, NotebookPen, Sun, Moon } from 'lucide-react';

const WODDisplay = () => {
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const fetchWODForDate = async (dateString: string) => {
    try {
      const selected = new Date(dateString + 'T00:00:00.000Z');
      const end = new Date(dateString + 'T23:59:59.999Z');
  
      const q = query(
        collection(db, 'wods'),
        where('date', '>=', Timestamp.fromDate(selected)),
        where('date', '<=', Timestamp.fromDate(end)),
      );
  
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        setWod(doc.data());
      } else {
        setWod(null);
      }
    } catch (error) {
      console.error("Error fetching WOD:", error);
    }
  };
  

  useEffect(() => {
    const today = new Date();
    const isoToday = today.toISOString().split('T')[0];
    setSelectedDate(isoToday);
    fetchWODForDate(isoToday);
  }, []);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSelectedDate(value);
    fetchWODForDate(value);
  };

  return (
    <div className="bg-black text-white min-h-screen flex flex-col items-center p-4 sm:p-6 space-y-6 pb-24">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col sm:flex-row justify-center sm:justify-between gap-4 mb-6 items-center">
          <input
            type="date"
            value={selectedDate}
            onChange={handleDateChange}
            className="p-2 rounded bg-neutral-800 text-white border border-steel"
          />
        </div>

        {!wod ? (
          <div className="text-center text-xl">No WOD found for selected date.</div>
        ) : (
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-6 sm:p-12 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            <div className="space-y-8">
              <h1 className="text-6xl font-heading text-bone uppercase tracking-widest">AlphaFIT</h1>
              <h2 className="text-3xl font-semibold text-bone flex items-center gap-2">
                <CalendarDays className="w-6 h-6" />
                {wod.date.toDate().toISOString().split('T')[0]}
              </h2>
              <p className="text-xl text-bone">Type: <span className="font-bold uppercase">{wod.sessionType}</span></p>

              {wod.sessionType === 'WOD' && (
                <>
                  <p className="text-xl text-bone">Style: <span className="uppercase font-semibold">{wod.wodType}</span></p>
                  {wod.wodStructure && <p className="text-base text-bone">Structure: {wod.wodStructure}</p>}
                  {wod.wodType === 'AMRAP' && <p className="text-base flex items-center gap-2"><Timer className="w-5 h-5" /> Duration: {wod.duration} min</p>}
                  {wod.rounds && (<p className="text-base">Rounds: <span className="font-semibold">{wod.rounds}</span></p>)}
                  {wod.wodType === 'EMOM' && <p className="text-base flex items-center gap-2"><Timer className="w-5 h-5" /> Minutes: {wod.duration}</p>}
                </>
              )}

              {wod.sessionType === 'Strength' && (
                <div>
                  <h3 className="text-xl font-bold text-bone mb-2">Strength Work</h3>
                  <ul className="space-y-2 text-base">
                    {wod.strengthMovements?.map((sm: any, index: number) => {
                      const parts = [
                        sm.sets ? `${sm.sets} sets` : '',
                        sm.reps ? `${sm.reps} reps` : '',
                        sm.rpe ? `${sm.rpe} RPE` : ''
                      ].filter(Boolean).join(' × ');
                      return (
                        <li key={index} className="flex items-center gap-2">
                          <Dumbbell className="w-5 h-5 text-bone" />
                          <span>{sm.movement}{parts ? ` – ${parts}` : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="text-base text-bone flex items-center gap-2">
                <NotebookPen className="w-5 h-5 text-bone" />
                <span className="font-bold">Notes:</span> {wod.notes || '—'}
              </div>
            </div>

            {wod.sessionType === 'WOD' && (
              <div className="flex flex-col items-center text-center space-y-6">
                <h3 className="text-4xl font-bold text-bone uppercase">Movements</h3>
                <ul className="space-y-4 text-lg text-white w-full">
                  {wod.movements?.map((move: any, index: number) => (
                    <li key={index} className="flex flex-col gap-2 bg-neutral-800 p-3 rounded-md">
                      {wod.wodStructure === 'Individual' ? (
                        <div className="flex items-center gap-2 justify-center text-base">
                          <Flame className="w-5 h-5 text-bone" />
                          {move.partner1}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-bone">Partner 1:</span> {move.partner1}
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-bone">Partner 2:</span> {move.partner2}
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
