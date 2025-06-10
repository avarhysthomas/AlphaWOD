// UserLogWorkout.tsx
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { Sun, Moon, Flame, Dumbbell } from 'lucide-react';

const units = ['kg', 'lbs', 'mins', 'km', 'm', 'reps'];

const UserLogWorkout = () => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isPM, setIsPM] = useState(false);
  const [wodData, setWodData] = useState<any>(null);
  const [formData, setFormData] = useState<{ [key: string]: any }>({ result: '', notes: '', strength: {}, completed: false });
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    setSelectedDate(today);
  }, []);

  useEffect(() => {
    const fetchWODByDate = async () => {
      if (!selectedDate) return;
      setLoading(true);
      const wodDoc = await getDoc(doc(db, 'wods', selectedDate));
      if (wodDoc.exists()) {
        const data = wodDoc.data();
        const sessionKey = isPM ? 'PM' : 'AM';
        setWodData(data[sessionKey] || null);
      } else {
        setWodData(null);
      }
      setLoading(false);
    };
    fetchWODByDate();
  }, [selectedDate, isPM]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type, checked } = target;
    const fieldValue = type === 'checkbox' ? checked : value;
    setFormData(prev => ({ ...prev, [name]: fieldValue }));
  };

  const handleStrengthChange = (index: number, field: string, value: string) => {
    setFormData(prev => {
      const updated = { ...prev.strength };
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, strength: updated };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !wodData) return;

    const entryRef = doc(collection(db, 'userLogs', user.uid, 'entries'), `${selectedDate}_${isPM ? 'PM' : 'AM'}`);
    await setDoc(entryRef, {
      date: Timestamp.now(),
      wodDate: selectedDate,
      session: isPM ? 'PM' : 'AM',
      type: wodData.sessionType,
      result: formData.result,
      notes: formData.notes,
      completed: formData.completed || false,
      strength: wodData.sessionType === 'Strength' ? formData.strength : null,
      wodSnapshot: wodData
    });
    setSubmitted(true);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto text-white pb-24">
      <h1 className="text-3xl font-bold mb-4">Log Your Workout</h1>

      <label className="block mb-2">Select WOD Date:</label>
      <input
        type="date"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
        className="w-full p-2 bg-neutral-800 rounded mb-4"
      />

      <div className="flex gap-2 mb-6">
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

      {loading ? (
        <div className="text-center">Loading WOD...</div>
      ) : wodData ? (
        <div className="mb-6 bg-neutral-800 p-4 rounded-lg space-y-4">
          <p className="font-semibold text-lg">WOD Type: {wodData.sessionType}</p>

          {wodData.sessionType === 'Strength' && (
            <>
              <h2 className="text-xl font-semibold">Strength Movements</h2>
              {wodData.strengthMovements?.map((sm: any, index: number) => (
                <div key={index} className="mt-2 bg-neutral-900 p-3 rounded">
                  <p className="mb-1">{sm.movement}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Weight"
                      value={formData.strength?.[index]?.weight || ''}
                      onChange={(e) => handleStrengthChange(index, 'weight', e.target.value)}
                      className="w-2/3 p-2 bg-neutral-800 rounded"
                    />
                    <select
                      value={formData.strength?.[index]?.unit || ''}
                      onChange={(e) => handleStrengthChange(index, 'unit', e.target.value)}
                      className="w-1/3 p-2 bg-neutral-800 rounded"
                    >
                      <option value="">Unit</option>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </>
          )}

          {wodData.sessionType === 'HYROX' && (
            <>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="completed"
                    checked={formData.completed}
                    onChange={handleChange}
                  />
                  Completed this session?
                </label>
              </div>

              <div className="space-y-4 mt-4">
                {wodData.movements?.map((move: any, index: number) => (
                  <div key={index} className="bg-neutral-900 p-3 rounded-md">
                    {wodData.wodStructure === 'Individual' ? (
                      <div className="flex items-center justify-between text-white text-base">
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
            </>
          )}
        </div>
      ) : (
        <p className="mb-4">No WOD found for selected date and session.</p>
      )}

      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            name="result"
            placeholder="Your result (e.g. 12:34, 80kg, 3 rounds)"
            value={formData.result}
            onChange={handleChange}
            className="w-full p-2 bg-neutral-800 rounded"
          />
          <textarea
            name="notes"
            placeholder="Any notes about this session?"
            value={formData.notes}
            onChange={handleChange}
            className="w-full p-2 bg-neutral-800 rounded"
          />
          <button
            type="submit"
            className="bg-white text-black px-4 py-2 rounded font-bold w-full"
          >
            Submit Log
          </button>
        </form>
      ) : (
        <div className="text-green-400 font-bold">Workout logged successfully! 🎉</div>
      )}
    </div>
  );
};

export default UserLogWorkout;
