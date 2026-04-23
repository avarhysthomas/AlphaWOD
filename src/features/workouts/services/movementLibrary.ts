import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import type { MovementLibraryItem, WorkoutMovementEntryMetric } from "../types";

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function metricArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is WorkoutMovementEntryMetric =>
          typeof entry === "string" &&
          ["reps", "cals", "distance", "seconds", "load"].includes(entry)
      )
    : [];
}

export async function getMovementLibrary() {
  const snapshot = await getDocs(
    query(
      collection(db, "movementLibrary"),
      where("isActive", "==", true),
      orderBy("sortOrder", "asc")
    )
  );

  return snapshot.docs.map((docItem) => {
    const data = docItem.data() as Record<string, unknown>;

    return {
      id: docItem.id,
      slug: typeof data.slug === "string" ? data.slug : docItem.id,
      name: typeof data.name === "string" ? data.name : docItem.id,
      category: typeof data.category === "string" ? data.category : "other",
      measurementTypes: metricArray(data.measurementTypes),
      aliases: stringArray(data.aliases),
      equipment: stringArray(data.equipment),
      tags: stringArray(data.tags),
      isActive: data.isActive !== false,
      sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 999,
    } satisfies MovementLibraryItem;
  });
}
