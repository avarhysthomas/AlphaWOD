/* eslint-disable max-len */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DRAFT_DIRECTORY,
  readManifest,
  verifyProductLegalDrafts,
} = require("./verifyProductLegalDrafts");

test("the product legal review set is exact, draft-only and runtime-ineligible", () => {
  const verified = verifyProductLegalDrafts();
  assert.deepEqual(verified.map(({key}) => key), [
    "adultConditioningAddendum",
    "paygTerms",
    "paygWaiver",
    "paygPrivacyNotice",
    "paygPrivacyRetentionDecision",
  ]);
});

test("the frozen PAYG privacy draft remains unapproved and source-bound", () => {
  const manifest = readManifest();
  const entry = manifest.documents.paygPrivacyNotice;
  assert.equal(entry.approvedForPublication, false);
  assert.equal(entry.runtimeEligible, false);
  assert.equal(manifest.ownerDecisions.paygPrivacyNoticeApproved, false);
  assert.equal(
    manifest.paygPrivacyNoticeDraftBasis.generalPrivacyNotice.version,
    "ZAF-PRIVACY-2026-08-25-02"
  );
  assert.equal(
    manifest.paygPrivacyNoticeDraftBasis.approvedRetentionEvidence.version,
    "ZAF-PAYG-PII-RETENTION-2026-08-31-01"
  );
});

test("draft verification rejects an approval flip or byte drift", (t) => {
  const approved = readManifest();
  approved.approvedForPublication = true;
  assert.throws(() => verifyProductLegalDrafts({
    manifest: approved,
    verifyRuntimeBoundary: false,
  }), /draft-only/i);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zaf-legal-drafts-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const filename of fs.readdirSync(DRAFT_DIRECTORY)) {
    fs.copyFileSync(path.join(DRAFT_DIRECTORY, filename), path.join(directory, filename));
  }
  const manifest = readManifest(path.join(directory, "manifest.json"));
  fs.appendFileSync(
    path.join(directory, manifest.documents.paygTerms.filename),
    "tampered\n"
  );
  assert.throws(() => verifyProductLegalDrafts({
    directory,
    manifest,
    verifyRuntimeBoundary: false,
  }), /canonical UTF-8|frozen review manifest/i);
});
