import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";
import type {
  CreateWorkoutSessionInput,
  FeedComment,
  FeedPost,
  FeedReactionUser,
  WorkoutMovementEntry,
  WorkoutMovementEntryMetric,
  WorkoutScoreType,
  WorkoutSection,
  WorkoutSession,
  WorkoutStats,
  WorkoutType,
} from "../types";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asFeedReactionUsers(value: unknown): FeedReactionUser[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const raw = entry as Record<string, unknown>;
      const userId = asString(raw.userId);
      const name = asString(raw.name);

      if (!userId || !name) return null;

      return {
        userId,
        name,
        photoURL: asOptionalString(raw.photoURL),
      };
    })
    .filter(Boolean) as FeedReactionUser[];
}

function asFeedComments(value: unknown): FeedComment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const raw = entry as Record<string, unknown>;
      const id = asString(raw.id);
      const userId = asString(raw.userId);
      const userName = asString(raw.userName);
      const message = asString(raw.message);

      if (!id || !userId || !userName || !message) return null;

      return {
        id,
        userId,
        userName,
        userPhotoURL: asOptionalString(raw.userPhotoURL),
        message,
        createdAtMs: timestampToMillis(raw.createdAt),
      };
    })
    .filter(Boolean) as FeedComment[];
}

function asMovementEntries(value: unknown): WorkoutMovementEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const movementName =
        "movementName" in entry && typeof entry.movementName === "string"
          ? entry.movementName.trim()
          : "movement" in entry && typeof entry.movement === "string"
          ? entry.movement.trim()
          : "";
      const movementId =
        "movementId" in entry && typeof entry.movementId === "string"
          ? entry.movementId.trim()
          : undefined;
      const isCustom =
        "isCustom" in entry && typeof entry.isCustom === "boolean"
          ? entry.isCustom
          : !movementId;
      const metric =
        "metric" in entry && typeof entry.metric === "string"
          ? (entry.metric as WorkoutMovementEntryMetric)
          : "reps";
      const value =
        "value" in entry && typeof entry.value === "string"
          ? entry.value.trim()
          : "";
      const loadKg =
        "loadKg" in entry && typeof entry.loadKg === "string"
          ? entry.loadKg.trim()
          : undefined;
      const reps =
        "reps" in entry && typeof entry.reps === "string"
          ? entry.reps.trim()
          : undefined;
      const sets =
        "sets" in entry && typeof entry.sets === "string"
          ? entry.sets.trim()
          : undefined;

      const hasStrengthData = Boolean(loadKg || reps || sets);

      if (!movementName || (!value && !hasStrengthData)) return null;

      return { movementId, movementName, isCustom, metric, value, loadKg, reps, sets };
    })
    .filter(Boolean) as WorkoutMovementEntry[];
}

function asSections(value: unknown): WorkoutSection[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((section) => {
      if (!section || typeof section !== "object") return null;

      const kind =
        "kind" in section && typeof section.kind === "string"
          ? section.kind
          : "notes";
      const text =
        "text" in section && typeof section.text === "string"
          ? section.text.trim()
          : "";

      if (!text) return null;

      return {
        kind: kind as WorkoutSection["kind"],
        text,
      };
    })
    .filter(Boolean) as WorkoutSection[];
}

function asStats(value: unknown): WorkoutStats {
  if (!value || typeof value !== "object") return {};

  const raw = value as Record<string, unknown>;

  return {
    score: asOptionalString(raw.score),
    scoreType: asOptionalString(raw.scoreType) as WorkoutScoreType | undefined,
    loadKg: asOptionalString(raw.loadKg),
    reps: asOptionalString(raw.reps),
    distanceM: asOptionalString(raw.distanceM),
    calories: asOptionalString(raw.calories),
    avgHeartRate: asOptionalString(raw.avgHeartRate),
    area: asOptionalString(raw.area),
    totalRounds: asOptionalString(raw.totalRounds),
  };
}

function timestampToMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  return null;
}

function formatWorkoutType(type: WorkoutType) {
  switch (type) {
    case "run":
      return "Cardio";
    case "strength":
      return "Strength";
    case "amrap":
      return "AMRAP";
    case "emom":
      return "EMOM";
    case "engine":
      return "Engine";
    case "class":
      return "Class";
    case "hybrid":
      return "Hybrid";
    default:
      return "Workout";
  }
}

function buildPreviewStat(input: {
  type: WorkoutType;
  durationMin?: string;
  stats: WorkoutStats;
  movementEntries?: WorkoutMovementEntry[];
}) {
  const { durationMin, stats, type, movementEntries } = input;

  if (stats.score?.trim()) return stats.score.trim();
  if (type === "run" && stats.distanceM?.trim() && durationMin?.trim()) {
    return `${stats.distanceM.trim()} m in ${durationMin.trim()} min`;
  }
  if (type === "amrap" && stats.totalRounds?.trim()) {
    return `${stats.totalRounds.trim()} rounds`;
  }
  if (type === "emom" && durationMin?.trim()) {
    return `${durationMin.trim()} min EMOM`;
  }
  if (type === "strength" && movementEntries?.length) {
    const firstStructured = movementEntries.find(
      (entry) => entry.loadKg || entry.reps || entry.sets
    );
    if (firstStructured) {
      const parts = [
        firstStructured.loadKg ? `${firstStructured.loadKg} kg` : "",
        firstStructured.reps ? `${firstStructured.reps} reps` : "",
        firstStructured.sets ? `${firstStructured.sets} sets` : "",
      ].filter(Boolean);

      if (parts.length) return parts.join(" • ");
    }

    return `${movementEntries.length} movements`;
  }
  if (stats.loadKg?.trim()) return `${stats.loadKg.trim()} kg`;
  if (stats.distanceM?.trim()) return `${stats.distanceM.trim()} m`;
  if (stats.reps?.trim()) return `${stats.reps.trim()} reps`;
  if (durationMin?.trim()) return `${durationMin.trim()} min`;
  if (stats.calories?.trim()) return `${stats.calories.trim()} kcal`;
  if (stats.avgHeartRate?.trim()) return `${stats.avgHeartRate.trim()} bpm avg`;

  return "Logged session";
}

function buildSummary(input: {
  title: string;
  type: WorkoutType;
  stats: WorkoutStats;
  durationMin?: string;
}) {
  const previewStat = buildPreviewStat({
    type: input.type,
    durationMin: input.durationMin,
    stats: input.stats,
  });

  return `Completed ${input.title || formatWorkoutType(input.type)} · ${previewStat}`;
}

function toWorkoutSession(
  id: string,
  data: Record<string, unknown>
): WorkoutSession {
  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName) || "Member",
    userPhotoURL: asOptionalString(data.userPhotoURL),
    title: asString(data.title),
    type: (asString(data.type) || "hybrid") as WorkoutType,
    source: (asString(data.source) || "manual") as WorkoutSession["source"],
    sessionDate: asString(data.sessionDate),
    startTime: asOptionalString(data.startTime),
    durationMin: asOptionalString(data.durationMin),
    notes: asString(data.notes),
    visibility: (asString(data.visibility) || "private") as WorkoutSession["visibility"],
    stats: asStats(data.stats),
    sections: asSections(data.sections),
    movementEntries: asMovementEntries(data.movementEntries),
    linkedClassId: asOptionalString(data.linkedClassId),
    linkedClassTitle: asOptionalString(data.linkedClassTitle),
    selfieURL: asOptionalString(data.selfieURL),
    createdAtMs: timestampToMillis(data.createdAt),
    updatedAtMs: timestampToMillis(data.updatedAt),
  };
}

function toFeedPost(id: string, data: Record<string, unknown>): FeedPost {
  return {
    id,
    kind: (asString(data.kind) || "workout") as FeedPost["kind"],
    workoutSessionId: asOptionalString(data.workoutSessionId),
    actorId: asString(data.actorId),
    actorName: asString(data.actorName) || "Member",
    actorPhotoURL: asOptionalString(data.actorPhotoURL),
    workoutTitle: asString(data.workoutTitle),
    workoutType: (asString(data.workoutType) || "hybrid") as WorkoutType,
    sessionDate: asString(data.sessionDate),
    startTime: asOptionalString(data.startTime),
    durationMin: asOptionalString(data.durationMin),
    summary: asString(data.summary),
    previewStat: asString(data.previewStat),
    notesPreview: asOptionalString(data.notesPreview),
    reactionCount:
      typeof data.reactionCount === "number" ? data.reactionCount : 0,
    reactionUserIds: asStringArray(data.reactionUserIds),
    reactionUsers: asFeedReactionUsers(data.reactionUsers),
    commentCount: typeof data.commentCount === "number" ? data.commentCount : 0,
    comments: asFeedComments(data.comments),
    linkedClassTitle: asOptionalString(data.linkedClassTitle),
    performanceCategory: asOptionalString(data.performanceCategory),
    performanceMovementSlug: asOptionalString(data.performanceMovementSlug),
    performanceMetricType: asOptionalString(data.performanceMetricType),
    performanceValue: asOptionalString(data.performanceValue),
    performanceUnit: asOptionalString(data.performanceUnit),
    createdAtMs: timestampToMillis(data.createdAt),
  };
}

async function hydrateReactionUsers(post: FeedPost): Promise<FeedPost> {
  if (!post.reactionUserIds.length) return post;

  const knownUsers = new Map(
    post.reactionUsers.map((entry) => [entry.userId, entry] as const)
  );
  const missingIds = post.reactionUserIds.filter((userId) => !knownUsers.has(userId));

  if (!missingIds.length) return post;

  try {
    const missingUsers = await Promise.all(
      missingIds.map(async (userId) => {
        const snapshot = await getDoc(doc(db, "users", userId));
        const data = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : null;

        return {
          userId,
          name: asString(data?.name) || "Member",
          photoURL: asOptionalString(data?.photoURL),
        };
      })
    );

    for (const user of missingUsers) {
      knownUsers.set(user.userId, user);
    }

    return {
      ...post,
      reactionUsers: post.reactionUserIds
        .map((userId) => knownUsers.get(userId))
        .filter(Boolean) as FeedReactionUser[],
    };
  } catch (error) {
    console.error("Could not hydrate reaction users", error);
    return post;
  }
}

const FEED_POST_LIMIT = 40;
const MEMBER_WORKOUT_LIMIT = 60;

export function listenToFeed(callback: (posts: FeedPost[]) => void) {
  const postsRef = query(
    collection(db, "feedPosts"),
    orderBy("createdAt", "desc"),
    limit(FEED_POST_LIMIT)
  );

  return onSnapshot(postsRef, (snapshot) => {
    void (async () => {
      const posts = await Promise.all(
        snapshot.docs.map((item) =>
          hydrateReactionUsers(
            toFeedPost(item.id, item.data() as Record<string, unknown>)
          )
        )
      );

      callback(posts);
    })();
  });
}

export function listenToMemberWorkouts(
  userId: string,
  callback: (workouts: WorkoutSession[]) => void
) {
  const workoutsRef = collection(db, "workoutSessions");
  const indexedQuery = query(
    workoutsRef,
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(MEMBER_WORKOUT_LIMIT)
  );
  const fallbackQuery = query(workoutsRef, where("userId", "==", userId));

  let fallbackUnsubscribe: (() => void) | null = null;

  const sortWorkouts = (workouts: WorkoutSession[]) =>
    workouts.sort((left, right) => {
      const leftStamp = left.createdAtMs ?? Date.parse(left.sessionDate) ?? 0;
      const rightStamp = right.createdAtMs ?? Date.parse(right.sessionDate) ?? 0;
      return rightStamp - leftStamp;
    });

  const primaryUnsubscribe = onSnapshot(
    indexedQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((item) =>
          toWorkoutSession(item.id, item.data() as Record<string, unknown>)
        )
      );
    },
    (error) => {
      if (error.code !== "failed-precondition" || fallbackUnsubscribe) {
        console.error("Could not subscribe to member workouts", error);
        return;
      }

      console.warn(
        "Falling back to a non-indexed workout query. Add the suggested Firestore index for best performance.",
        error
      );

      fallbackUnsubscribe = onSnapshot(
        fallbackQuery,
        (snapshot) => {
          const workouts = sortWorkouts(
            snapshot.docs.map((item) =>
              toWorkoutSession(item.id, item.data() as Record<string, unknown>)
            )
          ).slice(0, MEMBER_WORKOUT_LIMIT);

          callback(workouts);
        },
        (fallbackError) => {
          console.error("Could not subscribe to member workouts", fallbackError);
        }
      );
    }
  );

  return () => {
    primaryUnsubscribe();
    fallbackUnsubscribe?.();
  };
}

export function listenToWorkoutSession(
  workoutId: string,
  callback: (workout: WorkoutSession | null) => void
) {
  return onSnapshot(doc(db, "workoutSessions", workoutId), (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    callback(
      toWorkoutSession(
        snapshot.id,
        snapshot.data() as Record<string, unknown>
      )
    );
  });
}

export function listenToFeedPost(
  postId: string,
  callback: (post: FeedPost | null) => void
) {
  return onSnapshot(doc(db, "feedPosts", postId), (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    void (async () => {
      callback(
        await hydrateReactionUsers(
          toFeedPost(snapshot.id, snapshot.data() as Record<string, unknown>)
        )
      );
    })();
  });
}

export async function createWorkoutSession(input: CreateWorkoutSessionInput) {
  const workoutRef = doc(collection(db, "workoutSessions"));
  const batch = writeBatch(db);

  const cleanSections = input.sections
    .map((section) => ({
      kind: section.kind,
      text: section.text.trim(),
    }))
    .filter((section) => section.text);

  const cleanStats = Object.fromEntries(
    Object.entries(input.stats).filter(([, value]) => typeof value === "string" && value.trim())
  );
  const cleanMovementEntries = (input.movementEntries ?? [])
    .map((entry) => ({
      movementId: entry.movementId?.trim() || null,
      movementName: entry.movementName.trim(),
      isCustom: entry.isCustom ?? !entry.movementId,
      metric: entry.metric,
      value: entry.value.trim(),
      loadKg: entry.loadKg?.trim() || null,
      reps: entry.reps?.trim() || null,
      sets: entry.sets?.trim() || null,
    }))
    .filter(
      (entry) =>
        entry.movementName &&
        (entry.value || entry.loadKg || entry.reps || entry.sets)
    );

  const workoutPayload = {
    userId: input.userId,
    userName: input.userName.trim() || "Member",
    userPhotoURL: input.userPhotoURL?.trim() || null,
    title: input.title.trim(),
    type: input.type,
    source: input.source ?? "manual",
    sessionDate: input.sessionDate,
    startTime: input.startTime?.trim() || null,
    durationMin: input.durationMin?.trim() || null,
    notes: input.notes.trim(),
    visibility: input.visibility,
    stats: cleanStats,
    sections: cleanSections,
    movementEntries: cleanMovementEntries,
    linkedClassId: input.linkedClassId?.trim() || null,
    linkedClassTitle: input.linkedClassTitle?.trim() || null,
    selfieURL: input.selfieURL?.trim() || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  batch.set(workoutRef, workoutPayload);

  if (input.visibility === "members") {
    batch.set(doc(db, "feedPosts", workoutRef.id), {
      kind: "workout",
      workoutSessionId: workoutRef.id,
      actorId: input.userId,
      actorName: input.userName.trim() || "Member",
      actorPhotoURL: input.userPhotoURL?.trim() || null,
      workoutTitle: input.title.trim(),
      workoutType: input.type,
      sessionDate: input.sessionDate,
      startTime: input.startTime?.trim() || null,
      durationMin: input.durationMin?.trim() || null,
      summary: buildSummary({
        title: input.title.trim(),
        type: input.type,
        stats: input.stats,
        durationMin: input.durationMin,
      }),
      previewStat: buildPreviewStat({
        type: input.type,
        durationMin: input.durationMin,
        stats: input.stats,
        movementEntries: input.movementEntries,
      }),
      notesPreview: input.notes.trim().slice(0, 180) || null,
      reactionCount: 0,
      reactionUserIds: [],
      reactionUsers: [],
      commentCount: 0,
      comments: [],
      linkedClassTitle: input.linkedClassTitle?.trim() || null,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();

  return workoutRef.id;
}

export async function createPerformanceFeedPost(input: {
  actorId: string;
  actorName: string;
  actorPhotoURL?: string;
  category: string;
  movementSlug: string;
  movementName: string;
  metricType: string;
  value: string;
  unit?: string;
  date: string;
  notes?: string;
}) {
  const postRef = doc(collection(db, "feedPosts"));

  const cleanValue = input.value.trim();
  const cleanUnit = input.unit?.trim() || "";
  const previewStat = cleanUnit ? `${cleanValue} ${cleanUnit}` : cleanValue;

  await writeBatch(db)
    .set(postRef, {
      kind: "performance",
      actorId: input.actorId,
      actorName: input.actorName.trim() || "Member",
      actorPhotoURL: input.actorPhotoURL?.trim() || null,
      workoutTitle: input.movementName.trim(),
      workoutType: "strength",
      sessionDate: input.date,
      summary: `Logged ${input.movementName.trim()} · ${input.metricType.trim()}`,
      previewStat,
      notesPreview: input.notes?.trim().slice(0, 180) || null,
      reactionCount: 0,
      reactionUserIds: [],
      reactionUsers: [],
      commentCount: 0,
      comments: [],
      performanceCategory: input.category.trim(),
      performanceMovementSlug: input.movementSlug.trim(),
      performanceMetricType: input.metricType.trim(),
      performanceValue: cleanValue,
      performanceUnit: cleanUnit || null,
      createdAt: serverTimestamp(),
    })
    .commit();

  return postRef.id;
}

export async function toggleFeedReaction(
  postId: string,
  actor: { userId: string; name: string; photoURL?: string }
) {
  const postRef = doc(db, "feedPosts", postId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(postRef);

    if (!snapshot.exists()) {
      throw new Error("Feed post no longer exists.");
    }

    const data = snapshot.data() as Record<string, unknown>;
    const currentIds = asStringArray(data.reactionUserIds);
    const currentUsers = asFeedReactionUsers(data.reactionUsers);
    const hasReacted = currentIds.includes(actor.userId);
    const nextIds = hasReacted
      ? currentIds.filter((id) => id !== actor.userId)
      : [...currentIds, actor.userId];
    const nextUsers = hasReacted
      ? currentUsers.filter((entry) => entry.userId !== actor.userId)
      : [
          ...currentUsers.filter((entry) => entry.userId !== actor.userId),
          {
            userId: actor.userId,
            name: actor.name.trim() || "Member",
            photoURL: actor.photoURL?.trim() || null,
          },
        ];

    transaction.update(postRef, {
      reactionUserIds: nextIds,
      reactionUsers: nextUsers,
      reactionCount: nextIds.length,
    });
  });
}

export async function addFeedComment(input: {
  postId: string;
  userId: string;
  userName: string;
  userPhotoURL?: string;
  message: string;
}) {
  const postRef = doc(db, "feedPosts", input.postId);
  const cleanMessage = input.message.trim();

  if (!cleanMessage) {
    throw new Error("Comment message is required.");
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(postRef);

    if (!snapshot.exists()) {
      throw new Error("Feed post no longer exists.");
    }

    const data = snapshot.data() as Record<string, unknown>;
    const currentComments = asFeedComments(data.comments);
    const nextComments = [
      ...currentComments,
      {
        id: `${input.userId}-${Date.now()}`,
        userId: input.userId,
        userName: input.userName.trim() || "Member",
        userPhotoURL: input.userPhotoURL?.trim() || null,
        message: cleanMessage,
        createdAt: Timestamp.now(),
      },
    ];

    transaction.update(postRef, {
      comments: nextComments,
      commentCount: nextComments.length,
    });
  });
}

export async function getWorkoutSession(workoutId: string) {
  const snapshot = await getDoc(doc(db, "workoutSessions", workoutId));

  if (!snapshot.exists()) return null;

  return toWorkoutSession(
    snapshot.id,
    snapshot.data() as Record<string, unknown>
  );
}

export async function deleteWorkoutSession(workoutId: string) {
  const batch = writeBatch(db);

  batch.delete(doc(db, "workoutSessions", workoutId));
  batch.delete(doc(db, "feedPosts", workoutId));

  await batch.commit();
}
