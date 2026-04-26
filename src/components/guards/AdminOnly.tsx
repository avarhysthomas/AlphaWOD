import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isAdminRole, isSgptRole } from "../../lib/roles";

export default function AdminOnly({ children }: any) {
  const { appUser, loading } = useAuth();
  const isAdmin = isAdminRole(appUser?.role);

  if (loading) return null;
  if (!isAdmin) {
    return <Navigate to={isSgptRole(appUser?.role) ? "/sgpt/dashboard" : "/schedule"} replace />;
  }

  return children;
}
