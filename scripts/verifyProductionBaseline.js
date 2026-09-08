#!/usr/bin/env node
"use strict";

// Read-only, offline verification of the recovered 8 September production baseline.
// Later intentional application changes will report drift from this frozen baseline.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root,
  "ops/production-baseline/2026-09-08/manifest.json"), "utf8"));
const errors = [];
let checked = 0;
function check(relative, expected) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Unsafe manifest path");
  if (!fs.existsSync(absolute)) { errors.push(`Missing: ${relative}`); return; }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  if (actual !== expected) errors.push(`Changed: ${relative}`);
  checked++;
}
for (const [file, hash] of Object.entries(manifest.baselineFiles)) check(file, hash);
for (const revision of Object.values(manifest.firebase.sourceRevisions)) {
  for (const [file, hash] of Object.entries(revision.files)) check(`${revision.directory}/${file}`, hash);
}
for (const rule of manifest.firebase.rules) check(rule.path, rule.sha256);
for (const fn of manifest.firebase.functions) {
  if (!manifest.firebase.sourceRevisions[fn.sourceRevision]) errors.push(`Unknown source for ${fn.name}`);
  if (fn.state !== "ACTIVE") errors.push(`Non-active captured function: ${fn.name}`);
}
if (new Set(manifest.firebase.functions.map((f) => f.name)).size !== 47) errors.push("Expected 47 unique captured functions");
const legacy = manifest.firebase.functions.find((f) => f.name === "createMembershipCheckoutSession");
if (legacy.publicInvokerBinding || legacy.invokerIamDisabled || legacy.runtimeFlags.MEMBERSHIP_PURCHASE_ENABLED !== "false") {
  errors.push("Legacy checkout's captured closed boundary is inconsistent");
}
if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`${errors.length} differences from the captured production baseline.`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} file checks, 47 function mappings and the captured legacy checkout boundary.`);
  console.log("Offline baseline verification only; no live services were contacted or changed.");
}
