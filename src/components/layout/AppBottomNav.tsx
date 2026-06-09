import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getUserNavItems } from "./UserTopNav";

export default function AppBottomNav() {
  const { appUser } = useAuth();
  const navItems = getUserNavItems(appUser?.role);

  return (
    <nav
      className="fixed inset-x-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
      style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      aria-label="Primary"
    >
      <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(({ to, label, icon: NavIcon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                "flex min-w-[56px] shrink-0 flex-col items-center gap-0.5 rounded-[14px] px-1.5 py-1 text-[10px] font-extrabold leading-tight transition",
                isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
              ].join(" ")
            }
          >
            <NavIcon className="h-[18px] w-[18px] text-black" />
            <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
