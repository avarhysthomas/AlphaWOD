import { Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isAdminRole } from "../../lib/roles";
import AppBottomNav from "./AppBottomNav";

export default function AdminShell() {
  const { appUser } = useAuth();
  const isAdmin = isAdminRole(appUser?.role);

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">
      <div className="p-5 pb-36 sm:p-6 sm:pb-36">
        <Outlet />
      </div>
      {isAdmin ? <AppBottomNav /> : null}
    </div>
  );
}
