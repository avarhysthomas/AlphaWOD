import React from "react";
import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  User,
  Trophy,
  Flame,
  Dumbbell,
  MonitorPlay,
  SquarePen,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  adminOnly?: boolean;
};

const baseNavItems: NavItem[] = [
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/training", label: "Training", icon: Dumbbell },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/leaderboard", label: "Board of Fame", icon: Trophy },
  { to: "/board-of-shame", label: "Board of Shame", icon: Flame, danger: true },
];

const adminNavItems: NavItem[] = [
  { to: "/display", label: "Display", icon: MonitorPlay, adminOnly: true },
  { to: "/editor", label: "Editor", icon: SquarePen, adminOnly: true },
];

export default function UserTopNav() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const navItems = [
    ...baseNavItems,
    ...(isAdmin ? adminNavItems : []),
  ];

  return (
    <div className="sticky top-0 z-30 border-b border-neutral-900/80 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(({ to, label, icon: Icon, danger, adminOnly }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
                isActive
                  ? danger
                    ? "border-red-500/25 bg-red-500/12 text-red-100"
                    : adminOnly
                    ? "border-amber-500/25 bg-amber-500/12 text-amber-100"
                    : "border-white/15 bg-white/[0.08] text-white"
                  : danger
                  ? "border-red-500/15 bg-red-500/[0.05] text-red-100/75 hover:bg-red-500/[0.08]"
                  : adminOnly
                  ? "border-amber-500/15 bg-amber-500/[0.05] text-amber-100/75 hover:bg-amber-500/[0.08] hover:text-amber-50"
                  : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white",
              ].join(" ")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}