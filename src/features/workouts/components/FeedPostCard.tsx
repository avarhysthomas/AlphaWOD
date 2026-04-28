import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareText, ShieldCheck, SquareArrowOutUpRight, Timer } from "lucide-react";
import UserAvatar from "../../../components/ui/UserAvatar";
import { addFeedComment, toggleFeedReaction } from "../services/workouts";
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

function formatCommentDate(createdAtMs: number | null) {
  if (!createdAtMs) return "Just now";

  const value = new Date(createdAtMs);
  if (Number.isNaN(value.getTime())) return "Just now";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

type FeedPostCardProps = {
  post: FeedPost;
  currentUser?: {
    userId: string;
    name: string;
    photoURL?: string;
  };
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

function buildSaluteLine(post: FeedPost) {
  const names = post.reactionUsers.map((entry) => entry.name).filter(Boolean);
  const knownCount = names.length;
  const extraCount = Math.max(post.reactionCount - knownCount, 0);

  if (!knownCount && !extraCount) return "";
  if (!knownCount) return `${post.reactionCount} members saluted this workout`;
  if (knownCount === 1 && !extraCount) return `${names[0]} saluted this workout`;
  if (knownCount === 2 && !extraCount) {
    return `${names[0]} and ${names[1]} saluted this workout`;
  }

  const visibleNames = names.slice(0, 3);
  const remainingCount =
    extraCount + Math.max(knownCount - visibleNames.length, 0);

  return remainingCount > 0
    ? `${visibleNames.join(", ")} and ${remainingCount} other${remainingCount === 1 ? "" : "s"} saluted this workout`
    : `${visibleNames.join(", ")} saluted this workout`;
}

export default function FeedPostCard({
  post,
  currentUser,
}: FeedPostCardProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [isCommenting, setIsCommenting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const hasReacted = currentUser
    ? post.reactionUserIds.includes(currentUser.userId)
    : false;
  const postLink = buildPostLink(post);
  const saluteLine = buildSaluteLine(post);

  async function handleReaction() {
    if (!currentUser || isToggling) return;

    try {
      setIsToggling(true);
      await toggleFeedReaction(post.id, currentUser);
    } catch (error) {
      console.error("Could not toggle feed reaction", error);
    } finally {
      setIsToggling(false);
    }
  }

  async function handleCommentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUser || isCommenting || !commentDraft.trim()) return;

    try {
      setIsCommenting(true);
      await addFeedComment({
        postId: post.id,
        userId: currentUser.userId,
        userName: currentUser.name,
        userPhotoURL: currentUser.photoURL,
        message: commentDraft,
      });
      setCommentDraft("");
      setShowComments(true);
    } catch (error) {
      console.error("Could not add feed comment", error);
    } finally {
      setIsCommenting(false);
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
            disabled={!currentUser || isToggling}
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

          <button
            type="button"
            onClick={() => setShowComments((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-[13px] font-semibold text-white/62 transition hover:border-white/16 hover:text-white"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            {post.commentCount} comments
          </button>

          {post.kind !== "performance" ? (
            <Link
              to={postLink}
              className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-[13px] font-semibold text-white/62 transition hover:border-white/16 hover:text-white"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
              View workout
            </Link>
          ) : null}
        </div>

        {saluteLine ? (
          <p className="mt-3 text-sm text-white/54">{saluteLine}</p>
        ) : null}

        {showComments ? (
          <div className="mt-4 rounded-[22px] border border-white/6 bg-white/[0.03] p-3.5 sm:p-4">
            {post.comments.length ? (
              <div className="space-y-3">
                {post.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex items-start gap-3 rounded-[18px] border border-white/6 bg-black/15 p-3"
                  >
                    <UserAvatar
                      name={comment.userName}
                      photoURL={comment.userPhotoURL}
                      size={34}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/44">
                        <span className="font-semibold text-white/82">
                          {comment.userName}
                        </span>
                        <span>{formatCommentDate(comment.createdAtMs)}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-white/68">
                        {comment.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/42">
                No comments yet. Start the conversation.
              </p>
            )}

            <form className="mt-4 flex flex-col gap-3" onSubmit={handleCommentSubmit}>
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment..."
                rows={3}
                maxLength={280}
                disabled={!currentUser || isCommenting}
                className="w-full rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-amber-300/40"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-white/38">
                  {commentDraft.trim().length}/280
                </span>
                <button
                  type="submit"
                  disabled={!currentUser || isCommenting || !commentDraft.trim()}
                  className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-400/12 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCommenting ? "Posting..." : "Post comment"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}
