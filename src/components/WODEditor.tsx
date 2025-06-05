import React, { useState } from 'react';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

const WODEditor = () => {
  const [formData, setFormData] = useState({
    date: '',
    sessionType: 'WOD',
    wodType: 'AMRAP',
    wodStructure: 'Individual',
    duration: '',
    rounds: '',
    movements: [{ partner1: '', partner2: '' }],
    strengthMovements: [{ movement: '', sets: '', reps: '', rpe: '' }],
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const finalData = {
        ...formData,
        date: Timestamp.fromDate(new Date(formData.date)),
        rounds: formData.rounds && formData.rounds.trim() !== '' ? formData.rounds : '1',
      };
      await addDoc(collection(db, 'wods'), finalData);
      alert('WOD saved to Firebase!');
    } catch (err) {
      console.error('Error saving WOD:', err);
      alert('Failed to save WOD');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto bg-neutral-900 p-6 rounded-lg space-y-6 text-white">
      <h1 className="text-3xl font-heading font-bold text-center uppercase tracking-widest">AlphaFIT Editor</h1>

      <input type="date" name="date" value={formData.date} onChange={handleChange} className="w-full p-2 bg-neutral-800 rounded" />

      <select name="sessionType" value={formData.sessionType} onChange={handleChange} className="w-full p-2 bg-neutral-800 rounded">
        <option value="WOD">WOD</option>
        <option value="Strength">Strength</option>
      </select>

      {formData.sessionType === 'WOD' && (
        <>
          <select name="wodType" value={formData.wodType} onChange={handleChange} className="w-full p-2 bg-neutral-800 rounded">
            <option value="AMRAP">AMRAP</option>
            <option value="For Time">For Time</option>
            <option value="EMOM">EMOM</option>
            <option value="Chipper">Chipper</option>
          </select>

          <select name="wodStructure" value={formData.wodStructure} onChange={handleChange} className="w-full p-2 bg-neutral-800 rounded">
            <option value="Individual">Individual</option>
            <option value="Pair Split">Pair Split</option>
            <option value="Group Split">Group Split</option>
          </select>

          <input
            type="text"
            name="duration"
            placeholder="Duration (e.g. 12 min)"
            value={formData.duration}
            onChange={handleChange}
            className="w-full p-2 bg-neutral-800 rounded"
          />

          <input
            type="text"
            name="rounds"
            placeholder="Rounds (if applicable)"
            value={formData.rounds}
            onChange={handleChange}
            className="w-full p-2 bg-neutral-800 rounded"
          />

          <div>
            <label className="font-semibold">Movements:</label>
            {formData.movements.map((move, idx) => (
              formData.wodStructure === 'Individual' ? (
                <input
                  key={idx}
                  type="text"
                  placeholder={`Movement ${idx + 1}`}
                  value={move.partner1}
                  onChange={e => {
                    const updated = [...formData.movements];
                    updated[idx].partner1 = e.target.value;
                    setFormData(prev => ({ ...prev, movements: updated }));
                  }}
                  className="w-full p-2 mt-1 bg-neutral-800 rounded"
                />
              ) : (
                <div key={idx} className="flex flex-col gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Partner 1 movement"
                    value={move.partner1}
                    onChange={e => {
                      const updated = [...formData.movements];
                      updated[idx].partner1 = e.target.value;
                      setFormData(prev => ({ ...prev, movements: updated }));
                    }}
                    className="w-full p-2 bg-neutral-800 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Partner 2 movement"
                    value={move.partner2}
                    onChange={e => {
                      const updated = [...formData.movements];
                      updated[idx].partner2 = e.target.value;
                      setFormData(prev => ({ ...prev, movements: updated }));
                    }}
                    className="w-full p-2 bg-neutral-800 rounded"
                  />
                </div>
              )
            ))}
            <button
              type="button"
              className="text-sm text-white mt-2 underline"
              onClick={() => setFormData(prev => ({ ...prev, movements: [...prev.movements, { partner1: '', partner2: '' }] }))}
            >
              + Add Movement
            </button>
          </div>
        </>
      )}

      {formData.sessionType === 'Strength' && (
        <div>
          <label className="font-semibold">Strength Movements:</label>
          {formData.strengthMovements.map((sm, idx) => (
            <div key={idx} className="flex flex-col gap-2 mt-2">
              <input
                type="text"
                placeholder="Movement"
                value={sm.movement}
                onChange={e => {
                  const updated = [...formData.strengthMovements];
                  updated[idx].movement = e.target.value;
                  setFormData(prev => ({ ...prev, strengthMovements: updated }));
                }}
                className="w-full p-2 bg-neutral-800 rounded"
              />
              <input
                type="text"
                placeholder="Sets"
                value={sm.sets}
                onChange={e => {
                  const updated = [...formData.strengthMovements];
                  updated[idx].sets = e.target.value;
                  setFormData(prev => ({ ...prev, strengthMovements: updated }));
                }}
                className="w-full p-2 bg-neutral-800 rounded"
              />
              <input
                type="text"
                placeholder="Reps"
                value={sm.reps}
                onChange={e => {
                  const updated = [...formData.strengthMovements];
                  updated[idx].reps = e.target.value;
                  setFormData(prev => ({ ...prev, strengthMovements: updated }));
                }}
                className="w-full p-2 bg-neutral-800 rounded"
              />
              <input
                type="text"
                placeholder="RPE (optional)"
                value={sm.rpe}
                onChange={e => {
                  const updated = [...formData.strengthMovements];
                  updated[idx].rpe = e.target.value;
                  setFormData(prev => ({ ...prev, strengthMovements: updated }));
                }}
                className="w-full p-2 bg-neutral-800 rounded"
                />
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-white mt-2 underline"
            onClick={() => setFormData(prev => ({ ...prev, strengthMovements: [...prev.strengthMovements, { movement: '', sets: '', reps: '', rpe: ''}] }))}
          >
            + Add Movement
          </button>
        </div>
      )}

      <textarea
        name="notes"
        value={formData.notes}
        onChange={handleChange}
        placeholder="Notes"
        className="w-full p-2 bg-neutral-800 rounded"
      />

      <button type="submit" className="bg-white text-black px-4 py-2 rounded w-full font-bold">Save WOD</button>
    </form>
  );
};

export default WODEditor;
