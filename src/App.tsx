import React from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";

import WaiverGate from "./features/auth/components/WaiverGate";
import { useAuth } from "./context/AuthContext";
import {
  canAccessTraining,
  hasPerformanceAccess,
  isAdminRole,
  isGeneralMemberRole,
  isSgptRole,
} from "./lib/roles";

const WODEditor = React.lazy(() => import("./features/wod/pages/WODEditor"));
const WODDisplay = React.lazy(() => import("./features/wod/pages/WODDisplay"));
const DipLeaderboard = React.lazy(() => import("./features/leaderboard/pages/DipLeaderboard"));
const Login = React.lazy(() => import("./features/auth/pages/Login"));
const PendingApproval = React.lazy(() => import("./features/auth/pages/PendingApproval"));
const Signup = React.lazy(() => import("./features/auth/pages/Signup"));
const Dashboard = React.lazy(() => import("./features/dashboard/pages/Dashboard"));
const SgptDashboard = React.lazy(() => import("./features/dashboard/pages/SgptDashboard"));
const Schedule = React.lazy(() => import("./features/bookings/pages/Schedule"));
const ClassRoster = React.lazy(() => import("./features/bookings/pages/ClassRoster"));
const Leaderboard = React.lazy(() => import("./features/leaderboard/pages/Leaderboard"));
const Training = React.lazy(() => import("./features/training/pages/Training"));
const TrainingCategory = React.lazy(() => import("./features/training/pages/TrainingCategory"));
const TrainingMovement = React.lazy(() => import("./features/training/pages/TrainingMovement"));
const Profile = React.lazy(() => import("./features/profile/pages/Profile"));
const Feed = React.lazy(() => import("./features/workouts/pages/Feed"));
const Workouts = React.lazy(() => import("./features/workouts/pages/Workouts"));
const WorkoutComposer = React.lazy(() => import("./features/workouts/pages/WorkoutComposer"));
const WorkoutDetail = React.lazy(() => import("./features/workouts/pages/WorkoutDetail"));
const AdminInsights = React.lazy(() => import("./features/admin/pages/AdminInsights"));
const AdminPerformance = React.lazy(() => import("./features/admin/pages/AdminPerformance"));
const AdminMemberPerformance = React.lazy(() => import("./features/admin/pages/AdminMemberPerformance"));
const AdminMetricPerformance = React.lazy(() => import("./features/admin/pages/AdminMetricPerformance"));
const AdminMetricIndex = React.lazy(() => import("./features/admin/pages/AdminMetricIndex"));
const AdminStrengthBlocks = React.lazy(() => import("./features/admin/pages/AdminStrengthBlocks"));

/** ---------- Route guards ---------- */

function LoadingScreen() {
  return (
    <div className="carbon-fiber-bg flex min-h-screen items-center justify-center text-white">
      Loading...
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  return children;
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!isAdminRole(appUser?.role))
    return <Navigate to="/dashboard" replace state={{ from: location }} />;

  return children;
}

function RequireSgpt({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!isSgptRole(appUser?.role))
    return <Navigate to={getAuthedHome(appUser)} replace state={{ from: location }} />;

  return children;
}

function RequireApproved({ children }: { children: React.ReactElement }) {
  const { user, appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (appUser?.approvalStatus === "pending") {
    return <Navigate to="/pending-approval" replace state={{ from: location }} />;
  }

  return children;
}

function RequireMember({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (appUser?.role === "banned")
    return <Navigate to="/dashboard" replace state={{ from: location }} />;
  if (!isGeneralMemberRole(appUser?.role))
    return <Navigate to={getAuthedHome(appUser)} replace state={{ from: location }} />;

  return children;
}

function RequireTrainingAccess({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (appUser?.role === "banned")
    return <Navigate to={getAuthedHome(appUser)} replace state={{ from: location }} />;
  if (!canAccessTraining(appUser?.role))
    return <Navigate to={getAuthedHome(appUser)} replace state={{ from: location }} />;

  return children;
}

function RequirePerformanceArea({ children }: { children: React.ReactElement }) {
  const { appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!hasPerformanceAccess(appUser?.role))
    return <Navigate to={getAuthedHome(appUser)} replace state={{ from: location }} />;

  return children;
}

function getAuthedHome(appUser: ReturnType<typeof useAuth>["appUser"]) {
  if (appUser?.approvalStatus === "pending") return "/pending-approval";
  if (isSgptRole(appUser?.role)) return "/sgpt/dashboard";
  return "/dashboard";
}

/** ---------- Layout ---------- */

function AdminLayout() {
  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">
      <Outlet />
    </div>
  );
}

/** ---------- App ---------- */

export default function App() {
  const { user, appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  const isAuthed = !!user;
  const isBanned = appUser?.role === "banned";

  if (isAuthed && isBanned && location.pathname !== "/dashboard") {
    return <Navigate to="/dashboard" replace state={{ from: location }} />;
  }

  return (
    <WaiverGate>
    <React.Suspense fallback={<LoadingScreen />}>
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
              {isSgptRole(appUser?.role) ? <Navigate to="/sgpt/dashboard" replace /> : <Dashboard />}
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/sgpt/dashboard"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireSgpt>
                <SgptDashboard />
              </RequireSgpt>
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

      <Route
        path="/feed"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <Feed />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/workouts"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <Workouts />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/workouts/new"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <WorkoutComposer />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/workouts/:workoutId"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireMember>
                <WorkoutDetail />
              </RequireMember>
            </RequireApproved>
          </RequireAuth>
        }
      />

      <Route
        path="/training"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireTrainingAccess>
                <Training />
              </RequireTrainingAccess>
            </RequireApproved>
          </RequireAuth>
        }
      />
      <Route
        path="/training/:category"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireTrainingAccess>
                <TrainingCategory />
              </RequireTrainingAccess>
            </RequireApproved>
          </RequireAuth>
        }
      />
      <Route
        path="/training/:category/:movementSlug"
        element={
          <RequireAuth>
            <RequireApproved>
              <RequireTrainingAccess>
                <TrainingMovement />
              </RequireTrainingAccess>
            </RequireApproved>
          </RequireAuth>
        }
      />

      {/* Performance area */}
      <Route
        element={
          <RequireAuth>
            <RequireApproved>
              <RequirePerformanceArea>
                <AdminLayout />
              </RequirePerformanceArea>
            </RequireApproved>
          </RequireAuth>
        }
      >
        <Route path="/admin/performance" element={<AdminPerformance />} />
        <Route path="/admin/performance/metrics" element={<AdminMetricIndex />} />
        <Route
          path="/admin/performance/metric/:movementSlug/:metricType"
          element={<AdminMetricPerformance />}
        />
        <Route path="/admin/performance/:userId" element={<AdminMemberPerformance />} />
      </Route>

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
        <Route path="/admin/strength-blocks" element={<AdminStrengthBlocks />} />
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
    </React.Suspense>
    </WaiverGate>
  );
}
