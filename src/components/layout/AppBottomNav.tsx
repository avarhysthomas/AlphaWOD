import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getUserNavItems } from "./UserTopNav";

export default function AppBottomNav() {
  const { appUser } = useAuth();
  const navItems = getUserNavItems(appUser?.role);

  return (
    <nav
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-[28px] border border-white/45 bg-white/90 px-3 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:max-w-2xl"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      aria-label="Primary"
    >
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(({ to, label, icon: NavIcon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                "flex min-w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2 py-2 text-[11px] font-bold transition",
                isActive ? "bg-black/10 text-black" : "text-black hover:bg-black/5",
              ].join(" ")
            }
          >
            <NavIcon className="h-5 w-5 text-black" />
            <span className="max-w-full truncate">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
