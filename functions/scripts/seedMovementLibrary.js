#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function slugify(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function boolArg(value, fallback = false) {
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadPresetFile(presetPath) {
  const absolutePath = path.resolve(process.cwd(), presetPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.movements)) {
    throw new Error("Preset file must contain a top-level `movements` array.");
  }

  return {
    absolutePath,
    preset: parsed,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const presetPath =
    args.preset || "./src/seed-data/movement-library/alphafit-core.json";
  const collectionName = args.collection || "movementLibrary";
  const replace = boolArg(args.replace, false);
  const gymKeyOverride = args.gym;
  const projectId = args.project;

  const {absolutePath, preset} = loadPresetFile(presetPath);

  if (!admin.apps.length) {
    admin.initializeApp(projectId ? {projectId} : undefined);
  }

  const db = admin.firestore();
  const batchSize = 400;
  let operationCount = 0;
  let batch = db.batch();
  let totalWrites = 0;

  async function commitBatch() {
    if (operationCount === 0) return;
    await batch.commit();
    totalWrites += operationCount;
    batch = db.batch();
    operationCount = 0;
  }

  if (replace) {
    const existingSnapshot = await db.collection(collectionName).get();

    for (const docSnap of existingSnapshot.docs) {
      batch.delete(docSnap.ref);
      operationCount += 1;

      if (operationCount >= batchSize) {
        await commitBatch();
      }
    }
  }

  for (const item of preset.movements) {
    if (!item || typeof item !== "object") continue;

    const slug = slugify(item.slug || item.name);
    if (!slug) {
      throw new Error("Every movement needs a `name` or `slug`.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const gymKey = gymKeyOverride || preset.gymKey || null;
    const docRef = db.collection(collectionName).doc(slug);

    batch.set(
      docRef,
      {
        slug,
        gymKey,
        sourcePreset: preset.source || null,
        name: String(item.name || "").trim(),
        category: String(item.category || "other").trim(),
        measurementTypes: normalizeStringArray(item.measurementTypes),
        aliases: normalizeStringArray(item.aliases),
        equipment: normalizeStringArray(item.equipment),
        tags: normalizeStringArray(item.tags),
        isActive: item.isActive !== false,
        sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 999,
        createdAt: now,
        updatedAt: now,
      },
      {merge: true}
    );

    operationCount += 1;

    if (operationCount >= batchSize) {
      await commitBatch();
    }
  }

  await commitBatch();

  console.log(`Seeded ${preset.movements.length} movements into \`${collectionName}\`.`);
  console.log(`Preset: ${absolutePath}`);
  console.log(`Gym key: ${gymKeyOverride || preset.gymKey || "none"}`);
  console.log(`Total writes committed: ${totalWrites}`);
}

main().catch((error) => {
  console.error("Failed to seed movement library.");
  console.error(error);
  process.exit(1);
});
