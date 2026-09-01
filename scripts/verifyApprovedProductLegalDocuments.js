/* eslint-disable no-console */

const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertRuntimeRemainsClosed,
  readManifest: readDraftManifest,
  verifyProductLegalDrafts,
} = require("./verifyProductLegalDrafts");
const {
  PUBLICATION_MANIFEST,
  checkRegistrySync,
} = require("./syncPublishedLegalDocuments");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const PUBLICATION_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "public",
  "legal",
  "products"
);
const MANIFEST_PATH = path.join(PUBLICATION_DIRECTORY, "manifest.json");
const EXPECTED_DOCUMENT_KEYS = [
  "adultConditioningAddendum",
  "paygTerms",
  "paygWaiver",
];
const DECISION_ID_BY_DOCUMENT_KEY = Object.freeze({
  adultConditioningAddendum: "adult-conditioning-product-terms",
  paygTerms: "payg-product-terms",
  paygWaiver: "payg-waiver",
});
const PRIVACY_RUNTIME_EVIDENCE_PATH = path.join(
  REPOSITORY_ROOT,
  "ops",
  "release",
  "evidence",
  "payg-privacy-runtime-binding-readiness-2026-09-01.json"
);
const PAYG_PRIVACY_ENV_KEYS = Object.freeze([
  "PAYG_PRIVACY_NOTICE_VERSION",
  "PAYG_PRIVACY_NOTICE_PUBLIC_URL",
  "PAYG_PRIVACY_NOTICE_SHA256",
]);
const REQUIRED_COPY = {
  adultConditioningAddendum: [
    /£30 per month/,
    /maximum of two eligible Conditioning classes/,
    /Europe\/London Monday-to-Sunday week/,
    /Monday at 06:00/,
    /Tuesday at 18:00/,
    /Thursday at 18:00/,
    /Friday at 05:30/,
    /limited Zero Alpha App access/,
  ],
  paygTerms: [
    /price is £7\./,
    /cannot be transferred or rescheduled/,
    /regulation 28\(1\)\(h\)/,
    /at least 24 hours/,
    /less than 24 hours/,
    /mobile number is optional/i,
    /after 30 days/,
    /90 days after the scheduled class end/,
    /2,190 days after the scheduled class end/,
    /payg_specific_date_cancellation_v1/,
    /ZAF-PAYG-CANCELLATION-STATEMENT-2026-09-01-01/,
  ],
  paygWaiver: [
    /aged 18 or over/,
    /reasonable care and skill/,
    /death or personal injury caused by negligence/,
    /2,190 days after the scheduled class end/,
  ],
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCanonicalFinalDocument(directory, key, entry, draftEntry) {
  if (!entry || typeof entry !== "object" || !draftEntry) {
    throw new Error(`Approved product document ${key} is missing.`);
  }
  const expectedRuntimeEligibility = key === "adultConditioningAddendum";
  if (entry.approvedForPublication !== true ||
    entry.runtimeEligible !== expectedRuntimeEligibility) {
    throw new Error(
      `Approved product document ${key} has the wrong runtime eligibility.`
    );
  }
  if (entry.sourceDraftVersion !== draftEntry.version ||
    entry.sourceDraftBytes !== draftEntry.bytes ||
    entry.sourceDraftSha256 !== draftEntry.sha256) {
    throw new Error(`Approved product document ${key} lost its source-draft lineage.`);
  }
  if (/(?:^|[-_.])(?:DRAFT|PENDING|REVIEW|CANDIDATE)(?:[-_.]|$)/i
    .test(entry.version) ||
    entry.filename !== `${entry.version}.txt` ||
    path.basename(entry.filename) !== entry.filename ||
    entry.publicUrl !== `/legal/products/${entry.filename}`) {
    throw new Error(`Approved product document ${key} lacks an immutable final URL.`);
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`Approved product document ${key} has invalid byte evidence.`);
  }

  const bytes = fs.readFileSync(path.join(directory, entry.filename));
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes) ||
    content.charCodeAt(0) === 0xFEFF || content.includes("\r") ||
    !content.endsWith("\n") || content.endsWith("\n\n")) {
    throw new Error(`Approved product document ${key} is not canonical UTF-8 text.`);
  }
  if (/\b(?:DRAFT|PENDING)\b|NOT APPROVED FOR PUBLICATION|LEGAL REVIEW NOTES|LEGAL CONFIRMATION REQUIRED|No owner or legal approval/i
    .test(content) || !content.includes(entry.version)) {
    throw new Error(`Approved product document ${key} contains non-final copy.`);
  }
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(
      `Approved product document ${key} does not match its immutable evidence.`
    );
  }
  for (const pattern of REQUIRED_COPY[key] ?? []) {
    if (!pattern.test(content)) {
      throw new Error(`Approved product document ${key} is missing copy: ${pattern}.`);
    }
  }
  return {key, version: entry.version, bytes: entry.bytes, sha256: entry.sha256};
}

function exactApprovalDocuments(value, expected) {
  const exactKeys = ["bytes", "decision", "sha256", "version"];
  if (!Array.isArray(value) || value.length !== expected.length ||
    value.some((item) => !item || typeof item !== "object" ||
      JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(exactKeys))) {
    return false;
  }
  const normalize = (items) => items.map(({decision, version, bytes, sha256: digest}) => ({
    decision,
    version,
    bytes,
    sha256: digest,
  }));
  return JSON.stringify(normalize(value)) === JSON.stringify(normalize(expected));
}

function assertOwnerApprovalEvidence(
  manifest,
  repositoryRoot = REPOSITORY_ROOT,
  draftManifest = readDraftManifest()
) {
  const evidencePath = path.resolve(repositoryRoot, manifest.approvalEvidence || "");
  const evidenceRoot = `${path.join(repositoryRoot, "ops", "release", "evidence")}${path.sep}`;
  if (!evidencePath.startsWith(evidenceRoot) || !fs.existsSync(evidencePath)) {
    throw new Error("Product legal approval evidence path is invalid.");
  }
  const evidence = readJson(evidencePath);
  const expectedReview = EXPECTED_DOCUMENT_KEYS.map((key) => {
    const entry = draftManifest.documents[key];
    return {
      decision: DECISION_ID_BY_DOCUMENT_KEY[key],
      version: entry.version,
      bytes: entry.bytes,
      sha256: entry.sha256,
    };
  });
  const expectedFinal = EXPECTED_DOCUMENT_KEYS.map((key) => {
    const entry = manifest.documents[key];
    return {
      decision: DECISION_ID_BY_DOCUMENT_KEY[key],
      version: entry.version,
      bytes: entry.bytes,
      sha256: entry.sha256,
    };
  });
  if (evidence.schemaVersion !== 1 || evidence.approved !== true ||
    evidence.decisionId !==
      "conditioning-and-payg-product-terms-owner-approval" ||
    evidence.approvedByRole !== "business-owner" ||
    evidence.customerPiiRecorded !== false ||
    evidence.runtimePublicationComplete !== false ||
    evidence.deploymentAuthorized !== false ||
    evidence.productionPurchaseGatesRemainClosed !== true ||
    !exactApprovalDocuments(evidence.approvedReviewDocuments, expectedReview) ||
    !exactApprovalDocuments(
      evidence.approvedFinalPublicationCandidates,
      expectedFinal
    )) {
    throw new Error("Product legal owner-approval evidence is stale or unsafe.");
  }
}

function readDotenv(filePath) {
  return Object.fromEntries(fs.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

function assertPrivacyRuntimeEngineeringReadiness(
  manifest,
  draftManifest,
  repositoryRoot = REPOSITORY_ROOT
) {
  const privacyDraft = draftManifest.documents?.paygPrivacyNotice;
  if (!privacyDraft || privacyDraft.approvedForPublication !== false ||
    privacyDraft.runtimeEligible !== false ||
    manifest.ownerDecisions?.paygPrivacyNoticeApproved !== false) {
    throw new Error(
      "PAYG Privacy Notice approval state must remain explicit and fail closed."
    );
  }
  const evidencePath = path.join(
    repositoryRoot,
    path.relative(REPOSITORY_ROOT, PRIVACY_RUNTIME_EVIDENCE_PATH)
  );
  const evidence = readJson(evidencePath);
  const expectedDraft = {
    version: privacyDraft.version,
    path: `public/legal/product-drafts/${privacyDraft.filename}`,
    bytes: privacyDraft.bytes,
    sha256: privacyDraft.sha256,
  };
  const expectedControls = [
    "required-runtime-parameters",
    "public-schedule-privacy-notice-projection",
    "pre-pii-privacy-notice-link",
    "no-privacy-consent-checkbox",
    "server-validated-presented-version",
    "durable-presented-notice-evidence",
    "missing-or-stale-notice-fails-closed",
  ];
  if (evidence.schemaVersion !== 1 ||
    evidence.evidenceType !==
      "payg-privacy-notice-runtime-binding-engineering-readiness" ||
    evidence.engineeringReady !== true || evidence.launchReady !== false ||
    evidence.privacyNoticeApproved !== false ||
    evidence.productionPurchaseGatesRemainClosed !== true ||
    JSON.stringify(evidence.draft) !== JSON.stringify(expectedDraft) ||
    JSON.stringify(evidence.requiredEnvironmentParameters) !==
      JSON.stringify(PAYG_PRIVACY_ENV_KEYS) ||
    JSON.stringify(evidence.verifiedControls) !==
      JSON.stringify(expectedControls)) {
    throw new Error("PAYG Privacy Notice runtime-binding evidence is stale.");
  }

  const sourceChecks = [
    ["functions/src/payg.ts", [
      'defineString("PAYG_PRIVACY_NOTICE_VERSION"',
      '"PAYG_PRIVACY_NOTICE_PUBLIC_URL"',
      'defineString("PAYG_PRIVACY_NOTICE_SHA256"',
      "privacyNoticeVersionPresented",
      "privacyNotice: readLegalDocument(",
    ]],
    ["src/features/payg/services/payg.ts", [
      "privacyNotice: PaygLegalDocument",
      "privacyNoticeVersionPresented: string",
      "checkoutSchemaVersion: 2",
    ]],
    ["src/features/payg/pages/PayAsYouGo.tsx", [
      "legalRelease.privacyNotice.publicUrl",
      "PAYG Privacy Notice",
      "This notice is information, not consent to marketing.",
    ]],
    ["functions/scripts/verifyProductionConfig.js", PAYG_PRIVACY_ENV_KEYS],
  ];
  for (const [relativePath, requiredCopy] of sourceChecks) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    for (const copy of requiredCopy) {
      if (!source.includes(copy)) {
        throw new Error(`PAYG Privacy Notice runtime binding is missing: ${copy}.`);
      }
    }
  }
}

function assertRuntimeBindings(manifest, repositoryRoot = REPOSITORY_ROOT) {
  const conditioning = manifest.documents.adultConditioningAddendum;
  const registryEntry = PUBLICATION_MANIFEST.find(
    ({key}) => key === "adultConditioningAddendum"
  );
  if (registryEntry?.version !== conditioning.version ||
    registryEntry.approvedBytes !== conditioning.bytes ||
    registryEntry.approvedSha256 !== conditioning.sha256 ||
    registryEntry.publicUrl !== conditioning.publicUrl) {
    throw new Error("Conditioning publication registry binding is stale.");
  }
  checkRegistrySync();

  const production = readDotenv(path.join(
    repositoryRoot,
    "functions",
    ".env.production.example"
  ));
  const terms = manifest.documents.paygTerms;
  const waiver = manifest.documents.paygWaiver;
  const expected = {
    PAYG_AVAILABILITY_ENABLED: "false",
    PAYG_LEGAL_APPROVED: "false",
    PAYG_TERMS_VERSION: terms.version,
    PAYG_TERMS_PUBLIC_URL: terms.publicUrl,
    PAYG_TERMS_SHA256: terms.sha256,
    PAYG_WAIVER_VERSION: waiver.version,
    PAYG_WAIVER_PUBLIC_URL: waiver.publicUrl,
    PAYG_WAIVER_SHA256: waiver.sha256,
    PAYG_PRIVACY_NOTICE_VERSION: "",
    PAYG_PRIVACY_NOTICE_PUBLIC_URL: "",
    PAYG_PRIVACY_NOTICE_SHA256: "",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (production[name] !== value) {
      throw new Error(`Closed production product binding is stale: ${name}.`);
    }
  }
}

function verifyApprovedProductLegalDocuments({
  directory = PUBLICATION_DIRECTORY,
  manifest = readJson(path.join(directory, "manifest.json")),
  repositoryRoot = REPOSITORY_ROOT,
  verifyRuntimeBoundary = true,
} = {}) {
  verifyProductLegalDrafts({repositoryRoot, verifyRuntimeBoundary: false});
  const draftManifest = readDraftManifest();
  if (manifest.schemaVersion !== 1 ||
    manifest.status !== "APPROVED_FOR_PUBLICATION_RUNTIME_CLOSED" ||
    manifest.approvedForPublication !== true ||
    manifest.runtimeEligible !== false ||
    manifest.effectiveDate !== "2026-09-01" ||
    manifest.sourceReviewManifest !== "public/legal/product-drafts/manifest.json" ||
    manifest.productionPurchaseGatesRemainClosed !== true) {
    throw new Error("Approved product legal manifest does not preserve the closed boundary.");
  }
  const keys = Object.keys(manifest.documents ?? {});
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_DOCUMENT_KEYS)) {
    throw new Error("Approved product legal manifest has a stale document set.");
  }
  const expectedFiles = new Set(keys.map((key) => manifest.documents[key].filename));
  const actualFiles = fs.readdirSync(directory)
    .filter((filename) => filename.endsWith(".txt"));
  if (actualFiles.length !== expectedFiles.size ||
    actualFiles.some((filename) => !expectedFiles.has(filename))) {
    throw new Error("Approved product legal directory has an unmanifested text file.");
  }
  const verified = keys.map((key) => assertCanonicalFinalDocument(
    directory,
    key,
    manifest.documents[key],
    draftManifest.documents[key]
  ));
  const acceptance = manifest.paygCancellationAcceptance;
  if (acceptance?.statementId !== "payg_specific_date_cancellation_v1" ||
    acceptance.copyVersion !==
      "ZAF-PAYG-CANCELLATION-STATEMENT-2026-09-01-01" ||
    acceptance.approved !== true ||
    acceptance.boundDocumentVersion !== manifest.documents.paygTerms.version ||
    typeof acceptance.statement !== "string" ||
    acceptance.statement.length < 200 ||
    !fs.readFileSync(
      path.join(directory, manifest.documents.paygTerms.filename),
      "utf8"
    ).includes(`“${acceptance.statement}”`) ||
    !fs.readFileSync(
      path.join(repositoryRoot, "src/features/payg/legal.ts"),
      "utf8"
    ).includes(`statement: ${JSON.stringify(acceptance.statement)}`)) {
    throw new Error("Approved PAYG cancellation statement evidence is incomplete.");
  }
  const decisions = manifest.ownerDecisions;
  if (decisions?.conditioningCommercialTermsApproved !== true ||
    decisions.paygSpecificDateLeisureExceptionConfirmed !== true ||
    decisions.paygTermsApproved !== true || decisions.paygWaiverApproved !== true ||
    decisions.paygPrivacyNoticeApproved !== false ||
    decisions.paygOrderPiiRetentionDays !== 90 ||
    decisions.paygWaiverPiiRetentionDays !== 2190 ||
    decisions.paygEmailPiiRetentionDays !== 90 ||
    decisions.paygRetentionPolicyVersion !==
      "ZAF-PAYG-PII-RETENTION-2026-08-31-01" ||
    decisions.paygRedactionImplementationAccepted !== true) {
    throw new Error("Approved product owner decisions are incomplete.");
  }
  if (!Array.isArray(manifest.runtimeBlockers) || manifest.runtimeBlockers.length !== 2 ||
    !manifest.runtimeBlockers.some((blocker) => /PAYG Privacy Notice/.test(blocker))) {
    throw new Error("Product legal runtime blockers are incomplete.");
  }
  assertOwnerApprovalEvidence(manifest, repositoryRoot, draftManifest);
  assertPrivacyRuntimeEngineeringReadiness(
    manifest,
    draftManifest,
    repositoryRoot
  );
  assertRuntimeBindings(manifest, repositoryRoot);
  if (verifyRuntimeBoundary) assertRuntimeRemainsClosed(repositoryRoot);
  return verified;
}

function main() {
  const verified = verifyApprovedProductLegalDocuments();
  console.log("Approved product legal publication candidates verified:");
  for (const document of verified) {
    console.log(
      `- ${document.key}: ${document.version}, ${document.bytes} bytes, ` +
      `sha256 ${document.sha256}`
    );
  }
  console.log("- Runtime eligibility: false; all product purchase gates remain closed");
  console.log(
    "- PAYG Privacy Notice runtime binding: engineered and fail-closed; " +
    "final owner approval/publication remains required"
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Approved product legal verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_DOCUMENT_KEYS,
  MANIFEST_PATH,
  PAYG_PRIVACY_ENV_KEYS,
  PRIVACY_RUNTIME_EVIDENCE_PATH,
  PUBLICATION_DIRECTORY,
  assertOwnerApprovalEvidence,
  assertPrivacyRuntimeEngineeringReadiness,
  verifyApprovedProductLegalDocuments,
};
