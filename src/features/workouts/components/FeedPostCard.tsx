import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareText, ShieldCheck, Timer } from "lucide-react";
import UserAvatar from "../../../components/ui/UserAvatar";
import { toggleFeedReaction } from "../services/workouts";
import type { FeedPost } from "../types";

function formatDateLabel(sessionDate: string) {
  if (!sessionDate) return "Just logged";

  const value = new Date(`${sessionDate}T12:00:00`);
  if (Number.isNaN(value.getTime())) return sessionDate;

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(value);
}

type FeedPostCardProps = {
  post: FeedPost;
  currentUserId?: string;
};

function formatWorkoutType(type: FeedPost["workoutType"]) {
  return type === "run" ? "Cardio" : type.toUpperCase();
}

function buildPostLink(post: FeedPost) {
  if (
    post.kind === "performance" &&
    post.performanceCategory &&
    post.performanceMovementSlug
  ) {
    return `/training/${post.performanceCategory}/${post.performanceMovementSlug}`;
  }

  return post.workoutSessionId ? `/workouts/${post.workoutSessionId}` : "/feed";
}

export default function FeedPostCard({
  post,
  currentUserId,
}: FeedPostCardProps) {
  const [isToggling, setIsToggling] = useState(false);
  const hasReacted = currentUserId
    ? post.reactionUserIds.includes(currentUserId)
    : false;
  const postLink = buildPostLink(post);

  async function handleReaction() {
    if (!currentUserId || isToggling) return;

    try {
      setIsToggling(true);
      await toggleFeedReaction(post.id, currentUserId);
    } catch (error) {
      console.error("Could not toggle feed reaction", error);
    } finally {
      setIsToggling(false);
    }
  }

  return (
    <article className="relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(10,10,12,0.98))] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.28)] sm:p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.045),transparent_20%),radial-gradient(circle_at_85%_18%,rgba(245,158,11,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_26%)] opacity-90" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

      <div className="relative">
        <div className="flex items-start gap-3.5">
          <UserAvatar
            name={post.actorName}
            photoURL={post.actorPhotoURL}
            size={44}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/50">
              <span className="font-semibold text-white/86">{post.actorName}</span>
              <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/44">
                {post.kind === "performance" ? "Performance" : formatWorkoutType(post.workoutType)}
              </span>
              <span>{formatDateLabel(post.sessionDate)}</span>
            </div>

            <h3 className="mt-2.5 text-[28px] font-semibold tracking-[-0.04em] text-white">
              {post.workoutTitle}
            </h3>

            <p className="mt-2 text-sm leading-6 text-white/62">{post.summary}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-amber-400/12 bg-amber-400/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                {post.previewStat}
              </span>
              {post.durationMin ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-black/20 px-3 py-1.5 text-[12px] text-white/54">
                  <Timer className="h-3.5 w-3.5" />
                  {post.durationMin} min
                </span>
              ) : null}
            </div>

            {post.notesPreview ? (
              <p className="mt-3.5 text-sm leading-6 text-white/50">
                {post.notesPreview}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-white/6 pt-3.5">
          <button
            type="button"
            onClick={handleReaction}
            disabled={!currentUserId || isToggling}
            className={[
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition",
              hasReacted
                ? "border-orange-400/24 bg-orange-400/10 text-orange-100"
                : "border-white/8 bg-white/[0.03] text-white/62 hover:border-white/16 hover:text-white",
            ].join(" ")}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {post.reactionCount} salutes
          </button>

          {post.kind !== "performance" ? (
            <Link
              to={postLink}
              className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-[13px] font-semibold text-white/62 transition hover:border-white/16 hover:text-white"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              View workout
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
