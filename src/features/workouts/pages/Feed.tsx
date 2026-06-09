import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Bell } from "lucide-react";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";
import FeedPostCard from "../components/FeedPostCard";
import { listenToFeed } from "../services/workouts";
import type { FeedPost } from "../types";

type FeedFilter = "all" | "prs" | "sessions";

function isPrPost(post: FeedPost) {
  return post.kind === "performance" || /(^|\b)(pr|pb|personal best)(\b|$)/i.test(`${post.workoutTitle} ${post.summary} ${post.previewStat}`);
}

function feedDateGroup(post: FeedPost) {
  const source = post.createdAtMs ? new Date(post.createdAtMs) : new Date(`${post.sessionDate}T12:00:00`);
  if (Number.isNaN(source.getTime())) return "Recent";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const postDay = new Date(source.getFullYear(), source.getMonth(), source.getDate()).getTime();
  const diffDays = Math.round((today - postDay) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(source);
}

export default function Feed() {
  const { user, appUser } = useAuth();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const currentUser = user
    ? {
        userId: user.uid,
        name: appUser?.name || user.displayName || "Member",
        photoURL: user.photoURL || undefined,
      }
    : undefined;

  useEffect(() => {
    const unsubscribe = listenToFeed(setPosts);
    return () => unsubscribe();
  }, []);

  const filteredPosts = useMemo(() => {
    if (filter === "prs") return posts.filter(isPrPost);
    if (filter === "sessions") return posts.filter((post) => (post.kind ?? "workout") === "workout");
    return posts;
  }, [filter, posts]);

  const groupedPosts = useMemo(() => {
    const groups: Array<{ label: string; posts: FeedPost[] }> = [];
    filteredPosts.forEach((post) => {
      const label = feedDateGroup(post);
      const group = groups.find((entry) => entry.label === label);
      if (group) {
        group.posts.push(post);
      } else {
        groups.push({ label, posts: [post] });
      }
    });
    return groups;
  }, [filteredPosts]);

  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "A";
  const navItems = getUserNavItems(appUser?.role);
  const filters: Array<{ id: FeedFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "prs", label: "PRs" },
    { id: "sessions", label: "Sessions" },
  ];

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />

      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-5 w-5" />
            </button>
            <Link
              to="/profile"
              aria-label="Profile"
              className="grid h-12 w-12 overflow-hidden rounded-full border border-[#8b725b]/60 bg-[#765f4b] text-sm font-bold uppercase text-[#f8efe5]"
            >
              {profilePhotoURL ? (
                <img
                  src={profilePhotoURL}
                  alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">{firstName.slice(0, 1)}</span>
              )}
            </Link>
          </div>
        </header>

        <section className="mt-12">
          <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-white/34">
            Zero Alpha Community
          </p>
          <h1 className="mt-4 font-heading text-[4.6rem] uppercase leading-none text-white sm:text-[6rem]">
            Feed
          </h1>

          <div className="mt-7 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filters.map((option) => {
              const isActive = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={[
                    "shrink-0 rounded-full border px-5 py-3 text-sm font-extrabold transition",
                    isActive
                      ? "border-[#f2eee8] bg-[#f2eee8] text-black"
                      : "border-white/10 bg-[#151311] text-white/54 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-7 grid gap-8">
          {groupedPosts.length ? (
            groupedPosts.map((group) => (
              <div key={group.label}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                    {group.label}
                  </span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <div className="grid gap-4">
                  {group.posts.map((post) => (
                    <FeedPostCard
                      key={post.id}
                      post={post}
                      currentUser={currentUser}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-[#151311] px-6 py-10 text-center">
              <div className="text-lg font-semibold text-white">
                No posts here yet.
              </div>
              <p className="mt-3 text-sm leading-7 text-white/58">
                Share a workout or post a PR to get the feed moving.
              </p>
            </div>
          )}
        </section>
      </main>

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
    </div>
  );
}
