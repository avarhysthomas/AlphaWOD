import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { CalendarDays, Dumbbell, Flame, NotebookPen, Timer, Sun, Moon } from 'lucide-react';

const PastWODs = () => {
  const [wods, setWods] = useState<any[]>([]);

  useEffect(() => {
    const fetchWODs = async () => {
      try {
        const q = query(collection(db, 'wods'), orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        const wodList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setWods(wodList);
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
        <p className="text-center">No WODs found.</p>
      ) : (
        wods.map(wod => (
          <div key={wod.id} className="bg-neutral-900 border border-steel rounded-xl p-6 shadow space-y-4">
            <h2 className="text-2xl font-semibold text-bone flex items-center gap-2">
              <CalendarDays className="w-5 h-5" />
              {wod.date?.toDate?.().toISOString().split('T')[0] || 'Unknown Date'}
            </h2>

            <p className="text-bone text-lg">Type: <span className="font-medium">{wod.sessionType}</span></p>

            {wod.sessionType === 'WOD' && (
              <>
                <p className="text-bone">WOD Style: <span className="font-medium">{wod.wodType}</span></p>
                {wod.wodStructure && <p className="text-bone">Structure: <span className="font-medium">{wod.wodStructure}</span></p>}
                {wod.wodType === 'AMRAP' && <p className="flex items-center gap-2"><Timer className="w-4 h-4 text-bone" /> Duration: {wod.duration}</p>}
                {wod.wodType === 'For Time' && <p className="text-bone">Rounds: {wod.rounds}</p>}
                {wod.wodType === 'EMOM' && <p className="flex items-center gap-2"><Timer className="w-4 h-4 text-bone" /> Minutes: {wod.duration}</p>}
                <div>
                  <span className="font-bold text-bone">Movements:</span>
                  <ul className="list-disc list-inside text-white text-lg">
                    {wod.movements?.map((move: any, index: number) => (
                      <li key={index}>
                        {wod.wodStructure === 'Individual' ? (
                          <div className="flex items-center gap-2">
                            <Flame className="w-5 h-5 text-bone" /> {move.partner1}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-bone uppercase">Partner 1:</span> {move.partner1}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-bone uppercase">Partner 2:</span> {move.partner2}
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {wod.sessionType === 'Strength' && (
              <div>
                <span className="font-bold text-bone">Strength Movements:</span>
                <ul className="list-disc list-inside text-white text-lg">
                  {wod.strengthMovements?.map((sm: any, index: number) => (
                    <li key={index} className="flex items-center gap-2">
                      <Dumbbell className="w-5 h-5 text-bone" />
                      {sm.movement}
                      {sm.sets && ` – ${sm.sets} sets`}
                      {sm.reps && ` × ${sm.reps} reps`}
                      {sm.rpe && ` @ RPE ${sm.rpe}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 text-bone">
              <NotebookPen className="w-5 h-5 text-bone" />
              <span className="font-bold">Notes:</span> {wod.notes || '—'}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default PastWODs;
