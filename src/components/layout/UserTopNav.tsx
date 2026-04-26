import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  User,
  Trophy,
  Flame,
  Dumbbell,
  MonitorPlay,
  SquarePen,
  BarChart3,
  Activity,
  Newspaper,
  ClipboardPen,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { isAdminRole, isSgptRole } from "../../lib/roles";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  adminOnly?: boolean;
};

const baseNavItems: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/feed", label: "Feed", icon: Newspaper },
  { to: "/workouts", label: "Training", icon: ClipboardPen },
  { to: "/training", label: "Performance", icon: Dumbbell },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/leaderboard", label: "Board of Fame", icon: Trophy },
  { to: "/board-of-shame", label: "Board of Shame", icon: Flame, danger: true },
];

const adminNavItems: NavItem[] = [
  { to: "/admin/insights", label: "Insights", icon: BarChart3, adminOnly: true },
  { to: "/admin/performance", label: "Admin Performance", icon: Activity, adminOnly: true },
  { to: "/display", label: "Display", icon: MonitorPlay, adminOnly: true },
  { to: "/editor", label: "Editor", icon: SquarePen, adminOnly: true },
];

const sgptNavItems: NavItem[] = [
  { to: "/sgpt/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/training", label: "Performance", icon: Dumbbell },
  { to: "/admin/performance", label: "Dashboard", icon: Activity, adminOnly: true },
];

export default function UserTopNav() {
  const { appUser } = useAuth();
  const isAdmin = isAdminRole(appUser?.role);
  const isSgpt = isSgptRole(appUser?.role);

  const navItems = isSgpt
    ? sgptNavItems
    : [
        ...baseNavItems,
        ...(isAdmin ? adminNavItems : []),
      ];

  return (
    <div
      className="sticky top-0 z-30 border-b border-neutral-900/80 bg-black/80 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
