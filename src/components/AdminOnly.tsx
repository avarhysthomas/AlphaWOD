import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminOnly({ children }: any) {
  const { appUser, loading } = useAuth();
  const isAdmin = appUser?.role === "admin";

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/schedule" replace />;

  return children;
}