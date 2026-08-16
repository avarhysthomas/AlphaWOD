#!/usr/bin/env node

/**
 * One-time backfill: mirrors role/approvalStatus from each users/{uid} doc
 * into Firebase Auth custom claims. After this, security rules and callable
 * functions authorise from the ID token instead of reading Firestore.
 *
 * Usage (needs Firebase Admin credentials):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *     node scripts/backfillClaims.js --project alphawod-d1f2f
 *
 * Add --dry-run to preview without writing.
 */

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.project || process.env.GCLOUD_PROJECT;
  const dryRun = args["dry-run"] === "true";

  admin.initializeApp(projectId ? {projectId} : undefined);
  const db = admin.firestore();

  const snap = await db.collection("users").get();
  console.log(`Found ${snap.size} user docs${dryRun ? " (dry run)" : ""}`);

  let ok = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    // Missing approvalStatus has always meant "allowed" in this app.
    const claims = {
      role: data.role || "user",
      approvalStatus: data.approvalStatus || "approved",
    };

    try {
      if (!dryRun) {
        await admin.auth().setCustomUserClaims(doc.id, claims);
      }
      ok += 1;
      console.log(`ok      ${doc.id}  ${claims.role}/${claims.approvalStatus}`);
    } catch (err) {
      skipped += 1;
      console.warn(`skipped ${doc.id}  ${err.message}`);
    }
  }

  console.log(`Done. ${ok} updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
