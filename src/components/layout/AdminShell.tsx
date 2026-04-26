import { Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isAdminRole } from "../../lib/roles";
import UserTopNav from "./UserTopNav";

export default function AdminShell() {
  const { appUser } = useAuth();
  const isAdmin = isAdminRole(appUser?.role);

  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white">
      {isAdmin ? <UserTopNav /> : null}

      <div className="p-6">
        <Outlet />
      </div>
    </div>
  );
}
