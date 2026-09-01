const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PUBLICATION_DIRECTORY,
  assertOwnerApprovalEvidence,
  verifyApprovedProductLegalDocuments,
} = require("./verifyApprovedProductLegalDocuments");

test("approved product documents preserve exact immutable evidence and closed gates", () => {
  const verified = verifyApprovedProductLegalDocuments();
  assert.deepEqual(verified.map(({key}) => key), [
    "adultConditioningAddendum",
    "paygTerms",
    "paygWaiver",
  ]);
});

test("approved product verification rejects byte drift and runtime eligibility", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zaf-product-legal-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const filename of fs.readdirSync(PUBLICATION_DIRECTORY)) {
    fs.copyFileSync(
      path.join(PUBLICATION_DIRECTORY, filename),
      path.join(directory, filename)
    );
  }
  const manifest = JSON.parse(fs.readFileSync(
    path.join(directory, "manifest.json"),
    "utf8"
  ));
  fs.appendFileSync(
    path.join(directory, manifest.documents.paygTerms.filename),
    "tampered\n"
  );
  assert.throws(() => verifyApprovedProductLegalDocuments({
    directory,
    manifest,
    verifyRuntimeBoundary: false,
  }), /canonical UTF-8|immutable evidence/i);

  manifest.runtimeEligible = true;
  assert.throws(() => verifyApprovedProductLegalDocuments({
    manifest,
    verifyRuntimeBoundary: false,
  }), /closed boundary/i);
});

test("owner approval must exactly bind each reviewed draft decision and digest", (t) => {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "zaf-product-approval-")
  );
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const evidenceDirectory = path.join(repositoryRoot, "ops", "release", "evidence");
  fs.mkdirSync(evidenceDirectory, {recursive: true});

  const manifest = JSON.parse(fs.readFileSync(
    path.join(PUBLICATION_DIRECTORY, "manifest.json"),
    "utf8"
  ));
  const draftManifest = JSON.parse(fs.readFileSync(
    path.resolve(
      PUBLICATION_DIRECTORY,
      "..",
      "product-drafts",
      "manifest.json"
    ),
    "utf8"
  ));
  const sourceEvidence = JSON.parse(fs.readFileSync(
    path.resolve(
      PUBLICATION_DIRECTORY,
      "..",
      "..",
      "..",
      manifest.approvalEvidence
    ),
    "utf8"
  ));
  const evidencePath = path.join(repositoryRoot, manifest.approvalEvidence);

  for (const mutate of [
    (evidence) => {
      evidence.approvedReviewDocuments[0].decision = "wrong-decision";
    },
    (evidence) => {
      evidence.approvedReviewDocuments[1].sha256 = "0".repeat(64);
    },
  ]) {
    const evidence = structuredClone(sourceEvidence);
    mutate(evidence);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.throws(
      () => assertOwnerApprovalEvidence(manifest, repositoryRoot, draftManifest),
      /stale or unsafe/i
    );
  }
});
