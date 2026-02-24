import React from 'react';
import { useLocation, Routes, Route, NavLink } from 'react-router-dom';
import HomeScreen from './components/HomeScreen';
import WODEditor from './components/WODEditor';
import WODDisplay from './components/WODDisplay';
import AlphaFITHub from './components/AlphaFITHub';
import Login from './pages/Login';
import Signup from './pages/Signup';
import UserSplash from './pages/UserSplash';
import UserLogWorkout from './pages/UserLogWorkout';

import { Dumbbell, NotebookPen} from 'lucide-react';
import { useAuth } from './context/AuthContext';

const App = () => {
  const location = useLocation();
  const hideNav = location.pathname === '/';
  const { role, loading } = useAuth();

  if (loading) return <div className="text-white text-center mt-20">Loading...</div>;

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Admin Routes */}
          {role === 'admin' && (
            <>
              <Route path="/home" element={<HomeScreen />} />
              <Route path="/display" element={<WODDisplay />} />
              <Route path="/editor" element={<WODEditor />} />
            </>
          )}

          {/* User Routes */}
          {role === 'user' && (
            <>
             <Route path="/home" element={<UserSplash />} />
              <Route path="/show" element={<AlphaFITHub />} />
              <Route path="/log" element={<UserLogWorkout />} />

            </>
          )}
        </Routes>
      </div>

      {/* Bottom Navigation (only for Admin) */}
      {role === 'admin' && !hideNav && (
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
        </nav>
      )}
    </div>
  );
};

export default App;
