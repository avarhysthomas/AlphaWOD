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
import { getAlphaWodAccessGateRoute, hasAlphaWodAccess } from "./context/authUser";
import {
  canAccessTraining,
  hasPerformanceAccess,
  isAdminRole,
  isGeneralMemberRole,
  isSgptRole,
} from "./lib/roles";
import { hasAppCapability, isLimitedAppUser, type AppCapability } from "./lib/appAccess";

const WODEditor = React.lazy(() => import("./features/wod/pages/WODEditor"));
const WODDisplay = React.lazy(() => import("./features/wod/pages/WODDisplay"));
const DipLeaderboard = React.lazy(() => import("./features/leaderboard/pages/DipLeaderboard"));
const Login = React.lazy(() => import("./features/auth/pages/Login"));
const PendingApproval = React.lazy(() => import("./features/auth/pages/PendingApproval"));
const AccessRestricted = React.lazy(() => import("./features/auth/pages/AccessRestricted"));
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
const AdminInsights = React.lazy(() => import("./features/admin/pages/AdminInsights"));
const AdminPerformance = React.lazy(() => import("./features/admin/pages/AdminPerformance"));
const AdminMemberPerformance = React.lazy(() => import("./features/admin/pages/AdminMemberPerformance"));
const AdminMetricPerformance = React.lazy(() => import("./features/admin/pages/AdminMetricPerformance"));
const AdminMetricIndex = React.lazy(() => import("./features/admin/pages/AdminMetricIndex"));
const AdminStrengthBlocks = React.lazy(() => import("./features/admin/pages/AdminStrengthBlocks"));
const AdminMemberships = React.lazy(() => import("./features/admin/pages/AdminMemberships"));
const Memberships = React.lazy(() => import("./features/memberships/pages/Memberships"));
const MembershipCheckout = React.lazy(() => import("./features/memberships/pages/MembershipCheckout"));
const MembershipSuccess = React.lazy(() => import("./features/memberships/pages/MembershipSuccess"));
const MembershipManage = React.lazy(() => import("./features/memberships/pages/MembershipManage"));
const FeatureNotIncluded = React.lazy(() => import("./features/auth/pages/FeatureNotIncluded"));
const PayAsYouGo = React.lazy(() => import("./features/payg/pages/PayAsYouGo"));
const PayAsYouGoSuccess = React.lazy(() => import("./features/payg/pages/PayAsYouGoSuccess"));
const PayAsYouGoCancellation = React.lazy(() => import("./features/payg/pages/PayAsYouGoCancellation"));

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

function RequireAlphaWodAccess({ children }: { children: React.ReactElement }) {
  const { user, appUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  const gateRoute = getAlphaWodAccessGateRoute(appUser);
  if (gateRoute) {
    return <Navigate to={gateRoute} replace state={{ from: location }} />;
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

function RequireCapability({
  capability,
  featureName,
  children,
}: {
  capability: AppCapability;
  featureName: string;
  children: React.ReactElement;
}) {
  const { appUser, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (isLimitedAppUser(appUser) && !hasAppCapability(appUser, capability)) {
    return <FeatureNotIncluded featureName={featureName} />;
  }
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
  const gateRoute = getAlphaWodAccessGateRoute(appUser);
  if (gateRoute) return gateRoute;
  if (isSgptRole(appUser?.role)) return "/sgpt/dashboard";
  if (isLimitedAppUser(appUser)) return "/schedule";
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
  const waiverBypass = location.pathname.startsWith("/memberships") ||
    location.pathname.startsWith("/pay-as-you-go") ||
    location.pathname === "/account/membership" ||
    location.pathname === "/admin/memberships";
  return (
    <WaiverGate bypass={waiverBypass}>
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
            {appUser?.approvalStatus === "approved" ? (
              <Navigate to={getAuthedHome(appUser)} replace />
            ) : (
              <PendingApproval />
            )}
          </RequireAuth>
        }
      />
      <Route
        path="/access-restricted"
        element={
          <RequireAuth>
            {appUser?.approvalStatus !== "approved" ? (
              <Navigate to="/pending-approval" replace />
            ) : hasAlphaWodAccess(appUser) ? (
              <Navigate to={getAuthedHome(appUser)} replace />
            ) : (
              <AccessRestricted />
            )}
          </RequireAuth>
        }
      />

      {/* Public membership purchase.
          These routes stay outside the AlphaWOD access gates on purpose: the
          catalogue must be readable while signed out, and a member on a plan
          that does not include app access still has to reach their billing. */}
      <Route path="/memberships" element={<Memberships />} />
      <Route path="/memberships/checkout/:planKey" element={<MembershipCheckout />} />
      {/* Reachable signed out: the buyer lands here straight from Stripe,
          before they have an account, and claims the purchase from here. */}
      <Route path="/memberships/success" element={<MembershipSuccess />} />
      <Route path="/pay-as-you-go" element={<PayAsYouGo />} />
      <Route path="/pay-as-you-go/success" element={<PayAsYouGoSuccess />} />
      <Route path="/pay-as-you-go/cancel" element={<PayAsYouGoCancellation />} />
      <Route
        path="/account/membership"
        element={
          <RequireAuth>
            <MembershipManage />
          </RequireAuth>
        }
      />

      {/* Member routes */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="dashboard" featureName="Dashboard and WOD">
                {isSgptRole(appUser?.role) ? <Navigate to="/sgpt/dashboard" replace /> : <Dashboard />}
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/sgpt/dashboard"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireSgpt>
                <SgptDashboard />
              </RequireSgpt>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/schedule"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireMember>
                <Schedule />
              </RequireMember>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/leaderboard"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="leaderboards" featureName="Leaderboards">
                <RequireMember>
                  <Leaderboard />
                </RequireMember>
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/board-of-shame"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="leaderboards" featureName="Leaderboards">
                <DipLeaderboard />
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/profile"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <Profile />
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      <Route
        path="/training"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="training" featureName="Training and performance tracking">
                <RequireTrainingAccess>
                  <Training />
                </RequireTrainingAccess>
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />
      <Route
        path="/training/:category"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="training" featureName="Training and performance tracking">
                <RequireTrainingAccess>
                  <TrainingCategory />
                </RequireTrainingAccess>
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />
      <Route
        path="/training/:category/:movementSlug"
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequireCapability capability="training" featureName="Training and performance tracking">
                <RequireTrainingAccess>
                  <TrainingMovement />
                </RequireTrainingAccess>
              </RequireCapability>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      />

      {/* Performance area */}
      <Route
        element={
          <RequireAuth>
            <RequireAlphaWodAccess>
              <RequirePerformanceArea>
                <AdminLayout />
              </RequirePerformanceArea>
            </RequireAlphaWodAccess>
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
            <RequireAlphaWodAccess>
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            </RequireAlphaWodAccess>
          </RequireAuth>
        }
      >
        <Route path="/admin/insights" element={<AdminInsights />} />
        <Route path="/admin/strength-blocks" element={<AdminStrengthBlocks />} />
        <Route path="/admin/memberships" element={<AdminMemberships />} />
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
