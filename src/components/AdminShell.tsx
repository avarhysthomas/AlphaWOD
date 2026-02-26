import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminShell() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {isAdmin ? (
        <div className="sticky top-0 z-50 border-b border-neutral-800 bg-black/80 backdrop-blur px-6 py-4">
          <div className="max-w-5xl mx-auto flex gap-3">
            <NavLink
              to="/schedule"
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg border font-semibold ${
                  isActive
                    ? "border-white/30 text-white"
                    : "border-neutral-800 text-white/60 hover:text-white hover:bg-white/5"
                }`
              }
            >
              Schedule
            </NavLink>

            <NavLink
              to="/display"
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg border font-semibold ${
                  isActive
                    ? "border-white/30 text-white"
                    : "border-neutral-800 text-white/60 hover:text-white hover:bg-white/5"
                }`
              }
            >
              Display
            </NavLink>

            <NavLink
              to="/editor"
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg border font-semibold ${
                  isActive
                    ? "border-white/30 text-white"
                    : "border-neutral-800 text-white/60 hover:text-white hover:bg-white/5"
                }`
              }
            >
              Editor
            </NavLink>
          </div>
        </div>
      ) : null}

      <div className="p-6">
        <Outlet />
      </div>
    </div>
  );
}