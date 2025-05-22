import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Dumbbell, Timer, CalendarDays, Flame, NotebookPen } from 'lucide-react';

const WODDisplay = () => {
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const fetchWODForDate = async (dateString: string) => {
    try {
      const selected = new Date(dateString);
      selected.setHours(0, 0, 0, 0);
      const end = new Date(dateString);
      end.setHours(23, 59, 59, 999);

      const q = query(
        collection(db, 'wods'),
        where('date', '>=', Timestamp.fromDate(selected)),
        where('date', '<=', Timestamp.fromDate(end))
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
    <div className="bg-black text-white min-h-screen flex flex-col items-center p-6 space-y-6">
      <div className="w-full max-w-4xl">
        <div className="flex justify-center mb-6">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            <div className="space-y-8">
              <h1 className="text-7xl font-heading text-bone uppercase tracking-widest">AlphaWOD</h1>
              <h2 className="text-4xl font-semibold text-bone flex items-center gap-2">
                <CalendarDays className="w-6 h-6" />
                {wod.date.toDate().toISOString().split('T')[0]}
              </h2>
              <p className="text-2xl text-bone">Type: <span className="font-bold uppercase">{wod.sessionType}</span></p>
              {wod.sessionType === 'WOD' && (
                <>
                  <p className="text-2xl text-bone">Style: <span className="uppercase font-semibold">{wod.wodType}</span></p>
                  {wod.wodStructure && <p className="text-xl text-bone">Structure: {wod.wodStructure}</p>}
                  {wod.wodType === 'AMRAP' && <p className="text-xl text-bone flex items-center gap-2"><Timer className="w-5 h-5" /> Duration: {wod.duration} min</p>}
                  {wod.rounds && (<p className="text-xl text-bone">Rounds: <span className="font-semibold">{wod.rounds}</span></p>)}
                  {wod.wodType === 'EMOM' && <p className="text-xl text-bone flex items-center gap-2"><Timer className="w-5 h-5" /> Minutes: {wod.duration}</p>}
                </>
              )}

              {wod.sessionType === 'Strength' && (
                <div>
                  <h3 className="text-2xl font-bold text-bone mb-2">Strength Work</h3>
                  <ul className="space-y-2 text-xl text-white">
                    {wod.strengthMovements?.map((sm: any, index: number) => (
                      <li key={index} className="flex items-center gap-2">
                        <Dumbbell className="w-5 h-5 text-bone" />
                        {sm.movement} – {sm.sets} sets × {sm.reps} reps
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-xl text-bone flex items-center gap-2">
                <NotebookPen className="w-5 h-5 text-bone" />
                <span className="font-bold">Notes:</span> {wod.notes || '—'}
              </div>
            </div>

            {wod.sessionType === 'WOD' && (
              <div className="flex flex-col items-center justify-center text-center">
                <h3 className="text-5xl font-bold text-bone mb-8 uppercase">Movements</h3>
                <ul className="space-y-6 text-4xl text-white">
                  {wod.movements?.map((move: any, index: number) => (
                    <li key={index} className="flex flex-col gap-2">
                      {wod.wodStructure === 'Individual' ? (
                        <div className="flex items-center gap-4 justify-center">
                          <Flame className="w-6 h-6 text-bone" />
                          {move.partner1}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-4 justify-center">
                            <span className="text-sm text-bone uppercase">Partner 1:</span> {move.partner1}
                          </div>
                          <div className="flex items-center gap-4 justify-center">
                            <span className="text-sm text-bone uppercase">Partner 2:</span> {move.partner2}
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
