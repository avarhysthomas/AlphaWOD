// src/App.tsx
import React from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";

import WODEditor from "./features/wod/pages/WODEditor";
import WODDisplay from "./features/wod/pages/WODDisplay";
import DipLeaderboard from "./features/leaderboard/pages/DipLeaderboard";
import Login from "./features/auth/pages/Login";
import Signup from "./features/auth/pages/Signup";
import Schedule from "./features/bookings/pages/Schedule";
import ClassRoster from "./features/bookings/pages/ClassRoster";
import Leaderboard from "./features/leaderboard/pages/Leaderboard";
import Training from "./features/training/pages/Training";
import TrainingCategory from "./features/training/pages/TrainingCategory";
import TrainingMovement from "./features/training/pages/TrainingMovement";
import Profile from "./features/profile/pages/Profile";
import { useAuth } from "./context/AuthContext";

import AdminInsights from "./features/admin/pages/AdminInsights";
import AdminPerformance from "./features/admin/pages/AdminPerformance";
import AdminMemberPerformance from "./features/admin/pages/AdminMemberPerformance";

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

/** ---------- Layout ---------- */

function AdminLayout() {
  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Outlet />
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

      {/* Member routes */}
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

      <Route
        path="/leaderboard"
        element={
          <RequireAuth>
            <RequireMember>
              <Leaderboard />
            </RequireMember>
          </RequireAuth>
        }
      />

      <Route
        path="/board-of-shame"
        element={
          <RequireAuth>
            <DipLeaderboard />
          </RequireAuth>
        }
      />

      <Route
        path="/profile"
        element={
          <RequireAuth>
            <Profile />
          </RequireAuth>
        }
      />

      <Route path="/training" element={<Training />} />
      <Route path="/training/:category" element={<TrainingCategory />} />
      <Route
        path="/training/:category/:movementSlug"
        element={<TrainingMovement />}
      />

      {/* Admin-only area */}
      <Route
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          </RequireAuth>
        }
      >
        <Route path="/admin/insights" element={<AdminInsights />} />
        <Route path="/admin/performance" element={<AdminPerformance />} />
        <Route path="/admin/performance/:userId" element={<AdminMemberPerformance />} />
        <Route path="/display" element={<WODDisplay />} />
        <Route path="/editor" element={<WODEditor />} />
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