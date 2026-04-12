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
import PendingApproval from "./features/auth/pages/PendingApproval";
import Signup from "./features/auth/pages/Signup";
import Dashboard from "./features/dashboard/pages/Dashboard";
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
import AdminMetricPerformance from "./features/admin/pages/AdminMetricPerformance";
import AdminMetricIndex from "./features/admin/pages/AdminMetricIndex";

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
    return <Navigate to="/dashboard" replace state={{ from: location }} />;

  return children;
}

function RequireApproved({ children }: { children: React.ReactElement }) {
  const { user, appUser, loading } = useAuth();
  const location = useLocation();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (appUser?.approvalStatus === "pending") {
    return <Navigate to="/pending-approval" replace state={{ from: location }} />;
  }

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

function getAuthedHome(appUser: ReturnType<typeof useAuth>["appUser"]) {
  if (appUser?.approvalStatus === "pending") return "/pending-approval";
  return "/dashboard";
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
  const { user, appUser, loading } = useAuth();

  if (loading)
    return <div className="text-white text-center mt-20">Loading...</div>;

  const isAuthed = !!user;

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/"
        element={isAuthed ? <Navigate to={getAuthedHome(appUser)} replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={isAuthed ? <Navigate to={getAuthedHome(appUser)} replace /> : <Signup />}
      />
      <Route
        path="/pending-approval"
        element={
          <RequireAuth>
            {appUser?.approvalStatus === "pending" ? (
              <PendingApproval />
            ) : (
              <Navigate to={getAuthedHome(appUser)} replace />
            )}
          </RequireAuth>
        }
      />

      {/* Member routes */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <Dashboard />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/schedule"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <Schedule />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/leaderboard"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <Leaderboard />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/board-of-shame"
        element={
          <RequireAuth>
            <RequireApproved>
              <DipLeaderboard />
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/profile"
        element={
          <RequireAuth>
            <RequireApproved>
              <Profile />
            </RequireApproved>
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
            <RequireApproved>
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            </RequireApproved>
          </RequireAuth>
        }
      >
        <Route path="/admin/insights" element={<AdminInsights />} />
        <Route path="/admin/performance" element={<AdminPerformance />} />
        <Route path="/admin/performance/metrics" element={<AdminMetricIndex />} />
        <Route
          path="/admin/performance/metric/:movementSlug/:metricType"
          element={<AdminMetricPerformance />}
        />
        <Route path="/admin/performance/:userId" element={<AdminMemberPerformance />} />
        <Route path="/display" element={<WODDisplay />} />
        <Route path="/editor" element={<WODEditor />} />
        <Route path="/admin/classes/:classId" element={<ClassRoster />} />
      </Route>

      {/* Catch-all */}
      <Route
        path="*"
        element={<Navigate to={isAuthed ? getAuthedHome(appUser) : "/"} replace />}
      />
    </Routes>
  );
}
