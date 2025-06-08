import React from 'react';
import { useLocation } from 'react-router-dom';
import { Routes, Route, NavLink } from 'react-router-dom';
import HomeScreen from './components/HomeScreen';
import WODEditor from './components/WODEditor';
import WODDisplay from './components/WODDisplay';
import PastWODs from './components/PastWODs';
import { Dumbbell, Timer, CalendarDays, Flame, NotebookPen } from 'lucide-react';

const App = () => {
  const location = useLocation();
  const hideNav = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <div className="flex-1">
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/display" element={<WODDisplay />} />
        <Route path="/editor" element={<WODEditor />} />
        <Route path="/past" element={<PastWODs />} />
    </Routes>
      </div>

      {!hideNav && (
  <nav className="fixed bottom-0 left-0 right-0 bg-neutral-900 text-white flex justify-around items-center h-16 border-t border-neutral-700">
    <NavLink
      to="/display"
      className={({ isActive }) =>
        `text-sm flex flex-col items-center ${isActive ? 'text-white font-bold' : 'text-gray-400'}`
      }
    >
      <Dumbbell className="h-6 w-6" />
      <span className="text-xs">Display</span>
    </NavLink>
    <NavLink
      to="/editor"
      className={({ isActive }) =>
        `text-sm flex flex-col items-center ${isActive ? 'text-white font-bold' : 'text-gray-400'}`
      }
    >
      <NotebookPen className="h-6 w-6" />
      <span className="text-xs">Editor</span>
    </NavLink>
    <NavLink
      to="/past"
      className={({ isActive }) =>
        `text-sm flex flex-col items-center ${isActive ? 'text-white font-bold' : 'text-gray-400'}`
      }
    >
      <CalendarDays className="h-6 w-6" />
      <span className="text-xs">Past</span>
    </NavLink>
  </nav>
)}

    </div>
  );
};

export default App;
