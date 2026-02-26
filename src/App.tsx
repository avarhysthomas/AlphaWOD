// src/App.tsx
import React from "react";
import {
  Routes,
  Route,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";

import HomeScreen from "./components/HomeScreen";
import WODEditor from "./components/WODEditor";
import WODDisplay from "./components/WODDisplay";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import AdminTemplates from "./pages/AdminTemplates";
import Schedule from "./pages/Schedule";
import ClassRoster from "./pages/ClassRoster";

import { Dumbbell, NotebookPen, CalendarDays } from "lucide-react";
import { useAuth } from "./context/AuthContext";

/** ---------- Route guards ---------- */

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  return children;
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;
  if (appUser?.role !== "admin")
    return <Navigate to="/schedule" replace state={{ from: location }} />;

  return children;
}

function RequireMember({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;
  if (appUser?.role !== "user" && appUser?.role !== "admin")
    return <Navigate to="/" replace state={{ from: location }} />;

  return children;
}

/** ---------- Layout (admin bottom nav) ---------- */

function AdminLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden">
      <div className="flex-1 pb-16">
        <Outlet />
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-neutral-900 text-white flex justify-around items-center h-16 border-t border-neutral-700">
        <NavLink
          to="/schedule"
          className={({ isActive }) =>
            `text-sm flex flex-col items-center ${
              isActive ? "text-white font-bold" : "text-gray-400"
            }`
          }
        >
          <CalendarDays className="h-6 w-6" />
          <span className="text-xs">Schedule</span>
        </NavLink>

        <NavLink
          to="/display"
          className={({ isActive }) =>
            `text-sm flex flex-col items-center ${
              isActive ? "text-white font-bold" : "text-gray-400"
            }`
          }
        >
          <Dumbbell className="h-6 w-6" />
          <span className="text-xs">Display</span>
        </NavLink>

        <NavLink
          to="/editor"
          className={({ isActive }) =>
            `text-sm flex flex-col items-center ${
              isActive ? "text-white font-bold" : "text-gray-400"
            }`
          }
        >
          <NotebookPen className="h-6 w-6" />
          <span className="text-xs">Editor</span>
        </NavLink>
      </nav>
    </div>
  );
}

/** ---------- App ---------- */

export default function App() {
  const { user, loading } = useAuth();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;

  const isAuthed = !!user;

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/"
        element={isAuthed ? <Navigate to="/schedule" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={isAuthed ? <Navigate to="/schedule" replace /> : <Signup />}
      />

      {/* Member route: schedule only (admin + user) */}
      <Route
        path="/schedule"
        element={
          <RequireAuth>
            <RequireMember>
              <Schedule />
            </RequireMember>
          </RequireAuth>
        }
      />

      {/* Admin-only area (with bottom nav) */}
      <Route
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          </RequireAuth>
        }
      >
        {/* If you still want HomeScreen, keep it; otherwise you can delete this */}
        <Route path="/home" element={<HomeScreen />} />

        {/* Admin pages */}
        <Route path="/display" element={<WODDisplay />} />
        <Route path="/editor" element={<WODEditor />} />
        <Route path="/templates" element={<AdminTemplates />} />
        <Route path="/admin/classes/:classId" element={<ClassRoster />} />
      </Route>

      {/* Catch-all */}
      <Route
        path="*"
        element={<Navigate to={isAuthed ? "/schedule" : "/"} replace />}
      />
    </Routes>
  );
}