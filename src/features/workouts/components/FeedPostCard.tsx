import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ShieldCheck, SquareArrowOutUpRight, Upload } from "lucide-react";
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

function formatRelativeTime(createdAtMs: number | null, sessionDate: string) {
  const value = createdAtMs ? new Date(createdAtMs) : new Date(`${sessionDate}T12:00:00`);
  if (Number.isNaN(value.getTime())) return formatDateLabel(sessionDate);

  const diffMs = Date.now() - value.getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateLabel(sessionDate);
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

function postTag(post: FeedPost) {
  if (post.kind === "performance") return "PR";
  if (/milestone|streak|tier|badge|first/i.test(`${post.workoutTitle} ${post.summary} ${post.notesPreview ?? ""}`)) {
    return "Milestone";
  }
  return "Session";
}

function performanceValueParts(post: FeedPost) {
  const source = post.performanceValue || post.previewStat;
  const match = source.match(/^([0-9:.]+(?:\.\d+)?)\s*([a-zA-Z%]+)?/);
  if (!match) return null;
  return {
    value: match[1],
    unit: post.performanceUnit || match[2] || "",
  };
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
  const tag = postTag(post);
  const performanceParts = post.kind === "performance" ? performanceValueParts(post) : null;

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
    <article className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
      <div className="p-5">
        <div className="grid grid-cols-[48px_1fr_auto] gap-3.5">
          <UserAvatar
            name={post.actorName}
            photoURL={post.actorPhotoURL}
            size={48}
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="truncate text-base font-bold text-white">{post.actorName}</span>
              {currentUser?.userId === post.actorId ? (
                <span className="text-sm font-medium text-white/32">· you</span>
              ) : null}
            </div>
            <div className="mt-1 text-sm font-medium text-white/36">
              {formatRelativeTime(post.createdAtMs, post.sessionDate)}
            </div>
          </div>

          <span className="h-fit rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/58">
            {tag}
          </span>
        </div>

        {post.kind === "performance" ? (
          <div className="mt-6">
            <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-white/34">
              {post.workoutTitle}
              {post.performanceMetricType ? ` · ${post.performanceMetricType}` : ""}
            </div>
            {performanceParts ? (
              <div className="mt-3 flex items-end gap-3">
                <div className="font-mono text-[4.4rem] font-bold leading-none text-white">
                  {performanceParts.value}
                </div>
                {performanceParts.unit ? (
                  <div className="pb-3 text-sm font-bold uppercase tracking-[0.12em] text-white/46">
                    {performanceParts.unit}
                  </div>
                ) : null}
                <div className="pb-3 font-mono text-sm text-emerald-300">
                  ▲ {post.previewStat}
                </div>
              </div>
            ) : (
              <h3 className="mt-3 text-3xl font-bold tracking-[-0.05em] text-white">{post.previewStat}</h3>
            )}
            {post.notesPreview || post.summary ? (
              <p className="mt-4 text-base leading-7 text-white/66">
                {post.notesPreview || post.summary}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-6">
            <h3 className="font-heading text-3xl uppercase leading-none text-white">
              {post.workoutTitle}
            </h3>

            <p className="mt-2 font-mono text-sm text-white/40">
              {formatWorkoutType(post.workoutType)}
              {post.durationMin ? ` · ${post.durationMin} min` : ""}
              {post.previewStat ? ` · ${post.previewStat}` : ""}
            </p>

            <p className="mt-5 text-base leading-7 text-white/68">{post.summary}</p>

            {post.notesPreview ? (
              <p className="mt-4 text-sm leading-6 text-white/50">
                {post.notesPreview}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={handleReaction}
            disabled={!currentUser || isToggling}
            className={[
              "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold transition",
              hasReacted
                ? "bg-white/[0.10] text-white"
                : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08] hover:text-white",
            ].join(" ")}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {post.reactionCount}
          </button>

          <button
            type="button"
            onClick={() => setShowComments((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold text-white/46 transition hover:bg-white/[0.06] hover:text-white"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {post.commentCount}
          </button>

          {post.kind !== "performance" ? (
            <Link
              to={postLink}
              className="ml-auto inline-flex items-center gap-2 rounded-full p-2 text-white/38 transition hover:bg-white/[0.06] hover:text-white"
              aria-label="View workout"
            >
              <SquareArrowOutUpRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              to={postLink}
              className="ml-auto inline-flex items-center gap-2 rounded-full p-2 text-white/38 transition hover:bg-white/[0.06] hover:text-white"
              aria-label="View performance"
            >
              <Upload className="h-4 w-4" />
            </Link>
          )}
      </div>

        {saluteLine ? (
        <p className="px-5 pb-4 text-sm text-white/42">{saluteLine}</p>
        ) : null}

        {showComments ? (
        <div className="border-t border-white/10 bg-black/16 p-4">
            {post.comments.length ? (
              <div className="space-y-3">
                {post.comments.map((comment) => (
                  <div
                    key={comment.id}
                  className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] p-3"
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
                className="w-full rounded-[18px] border border-white/10 bg-[#211e1b] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-white/22"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-white/38">
                  {commentDraft.trim().length}/280
                </span>
                <button
                  type="submit"
                  disabled={!currentUser || isCommenting || !commentDraft.trim()}
                  className="inline-flex items-center rounded-full bg-[#f2eee8] px-4 py-2 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCommenting ? "Posting..." : "Post comment"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
    </article>
  );
}
