import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { hasPerformanceAccess, isSgptRole } from "../../lib/roles";

export default function PerformanceAccessOnly({ children }: any) {
  const { appUser, loading } = useAuth();

  if (loading) return null;
  if (!hasPerformanceAccess(appUser?.role)) {
    return <Navigate to={isSgptRole(appUser?.role) ? "/sgpt/dashboard" : "/dashboard"} replace />;
  }

  return children;
}
