/* eslint-disable no-console */

const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const DRAFT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "public",
  "legal",
  "product-drafts"
);
const MANIFEST_PATH = path.join(DRAFT_DIRECTORY, "manifest.json");
const EXPECTED_DOCUMENT_KEYS = [
  "adultConditioningAddendum",
  "paygTerms",
  "paygWaiver",
  "paygPrivacyNotice",
  "paygPrivacyRetentionDecision",
];
const DRAFT_BANNERS = [
  "DRAFT — NOT APPROVED FOR PUBLICATION OR CUSTOMER USE",
  "DRAFT — INTERNAL DECISION RECORD — NOT A CUSTOMER PRIVACY NOTICE",
];
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
    /at least 24 hours/,
    /less than 24 hours/,
    /mobile number is optional/i,
    /regulation 28\(1\)\(h\)/,
    /payg_specific_date_cancellation_v1/,
  ],
  paygWaiver: [
    /aged 18 or over/,
    /reasonable care and skill/,
    /death or personal injury caused by negligence/,
    /retention periods.*have not been approved/is,
  ],
  paygPrivacyNotice: [
    /ZAF-PRIVACY-2026-08-25-02/,
    /ZAF-PAYG-PII-RETENTION-2026-08-31-01/,
    /full name, date of birth and email address/i,
    /mobile number is optional/i,
    /urgent operational contact about (?:that|the booked) class/i,
    /No account is required or created/i,
    /Marketing is not part of the PAYG purchase/i,
    /Contract and requested pre-contract steps/,
    /Legitimate interests/,
    /Legal obligation/,
    /Google Firebase and Google Cloud/,
    /Resend/,
    /restricted transfer/,
    /30 days after the checkout expires/,
    /90 days after the scheduled class end/,
    /2,190 days after the scheduled class end/,
    /RIGHT TO OBJECT/,
    /Information Commissioner's Office \(ICO\)/,
  ],
  paygPrivacyRetentionDecision: [
    /PAYG_PII_RETENTION_APPROVED must remain false/,
    /mobile number.*optional/is,
    /PAYG_ORDER_PII_RETENTION_DAYS/,
    /PAYG_WAIVER_PII_RETENTION_DAYS/,
    /APPROVED PERIOD: NOT DECIDED/,
    /delet(?:e|ion) or irreversible(?:ly)? anonymis(?:e|ation)/,
  ],
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function assertFrozenBasisFile(repositoryRoot, label, entry, expected) {
  if (!entry || typeof entry !== "object" ||
    entry.version !== expected.version || entry.path !== expected.path ||
    entry.bytes !== expected.bytes || entry.sha256 !== expected.sha256) {
    throw new Error(`${label} lineage is stale.`);
  }
  const absolutePath = path.resolve(repositoryRoot, entry.path);
  const rootPrefix = `${path.resolve(repositoryRoot)}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix) || !fs.existsSync(absolutePath)) {
    throw new Error(`${label} lineage path is invalid.`);
  }
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`${label} lineage bytes have drifted.`);
  }
  return bytes;
}

function assertPaygPrivacyNoticeDraftBasis(manifest, repositoryRoot) {
  const basis = manifest.paygPrivacyNoticeDraftBasis;
  const privacyBytes = assertFrozenBasisFile(
    repositoryRoot,
    "General Privacy Notice",
    basis?.generalPrivacyNotice,
    {
      version: "ZAF-PRIVACY-2026-08-25-02",
      path: "public/legal/memberships/ZAF-PRIVACY-2026-08-25-02.txt",
      bytes: 15236,
      sha256: "0394ac927118b4490958cacff93c241f0ede617dd251758b33d464c72142a6fe",
    }
  );
  if (!privacyBytes.toString("utf8").includes(
    "ZERO ALPHA FITNESS LTD, a company registered in England and Wales"
  )) {
    throw new Error("General Privacy Notice controller lineage is incomplete.");
  }

  const retentionBytes = assertFrozenBasisFile(
    repositoryRoot,
    "Approved PAYG retention evidence",
    basis?.approvedRetentionEvidence,
    {
      version: "ZAF-PAYG-PII-RETENTION-2026-08-31-01",
      path: "ops/release/evidence/payg-retention-owner-approval-2026-08-31.json",
      bytes: 1674,
      sha256: "856c5233d1f66f153349615b55fc922bd9d6da8541a476e793bce6f2be2d6b16",
    }
  );
  const retention = JSON.parse(retentionBytes.toString("utf8"));
  if (retention.approved !== true ||
    retention.policyVersion !== basis.approvedRetentionEvidence.version ||
    retention.policy?.abandonedUnpaidIntent?.retentionDays !== 30 ||
    retention.policy?.paidOrderAfterClassEnd?.retentionDays !== 90 ||
    retention.policy?.waiverIdentityAfterClassEnd?.retentionDays !== 2190 ||
    retention.customerFacingDocumentsApproved !== false ||
    retention.productionGatesRemainClosed !== true) {
    throw new Error("Approved PAYG retention evidence is incomplete or unsafe.");
  }
}

function assertDraftDocument(directory, key, entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Draft manifest entry ${key} is missing.`);
  }
  if (entry.approvedForPublication !== false || entry.runtimeEligible !== false) {
    throw new Error(`Draft ${key} must remain unapproved and runtime-ineligible.`);
  }
  if (!/DRAFT/.test(entry.version) || !/DRAFT/.test(entry.filename) ||
    entry.filename !== `${entry.version}.txt` ||
    path.basename(entry.filename) !== entry.filename) {
    throw new Error(`Draft ${key} must use one explicit immutable draft filename.`);
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`Draft ${key} has invalid byte or digest evidence.`);
  }

  const filePath = path.join(directory, entry.filename);
  const bytes = fs.readFileSync(filePath);
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes) || content.charCodeAt(0) === 0xFEFF ||
    content.includes("\r") || !content.endsWith("\n") || content.endsWith("\n\n")) {
    throw new Error(`Draft ${key} is not canonical UTF-8 text with one final LF.`);
  }
  if (!DRAFT_BANNERS.some((banner) => content.startsWith(`${banner}\n`)) ||
    !content.includes(entry.version) ||
    !/owner and legal review required/i.test(content) ||
    !/(?:No owner or legal approval|None has been recorded)/i.test(content)) {
    throw new Error(`Draft ${key} is not unmistakably unapproved.`);
  }
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Draft ${key} bytes do not match its frozen review manifest.`);
  }
  for (const pattern of REQUIRED_COPY[key] ?? []) {
    if (!pattern.test(content)) {
      throw new Error(`Draft ${key} is missing required review copy: ${pattern}.`);
    }
  }
  return {key, filename: entry.filename, bytes: bytes.length, sha256: entry.sha256};
}

function assertRuntimeRemainsClosed(repositoryRoot = REPOSITORY_ROOT) {
  const productionFunctions = fs.readFileSync(
    path.join(repositoryRoot, "functions", ".env.production.example"),
    "utf8"
  );
  const productionFrontend = fs.readFileSync(
    path.join(repositoryRoot, ".env.production.example"),
    "utf8"
  );
  const paygSource = fs.readFileSync(
    path.join(repositoryRoot, "functions", "src", "payg.ts"),
    "utf8"
  );
  for (const expected of [
    "ADULT_CONDITIONING_PURCHASE_ENABLED=false",
    "ADULT_CONDITIONING_LEGAL_APPROVED=false",
    "PAYG_AVAILABILITY_ENABLED=false",
    "PAYG_LEGAL_APPROVED=false",
    "PAYG_PII_REDACTION_IMPLEMENTED=true",
    "PAYG_PII_RETENTION_APPROVED=false",
  ]) {
    if (!productionFunctions.includes(expected)) {
      throw new Error(`Production example must remain closed: ${expected}.`);
    }
  }
  for (const expected of [
    "REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false",
    "REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED=false",
  ]) {
    if (!productionFrontend.includes(expected)) {
      throw new Error(`Frontend production example must remain closed: ${expected}.`);
    }
  }
  if (!/export const PAYG_PII_REDACTION_IMPLEMENTED = true;/.test(paygSource)) {
    throw new Error("The tested code-owned PAYG PII redaction marker must remain true.");
  }

  const runtimeSources = [
    productionFunctions,
    productionFrontend,
    paygSource,
    fs.readFileSync(
      path.join(repositoryRoot, "functions", "src", "membershipPlans.ts"),
      "utf8"
    ),
    fs.readFileSync(
      path.join(repositoryRoot, "src", "lib", "membershipPlans.ts"),
      "utf8"
    ),
  ];
  if (runtimeSources.some((source) =>
    /ZAF-(?:CONDITIONING|PAYG)-[^\s"']*DRAFT-\d{4}-\d{2}-\d{2}/.test(source))) {
    throw new Error("A runtime or production example references an unapproved product draft.");
  }
}

function verifyProductLegalDrafts({
  directory = DRAFT_DIRECTORY,
  manifest = readManifest(path.join(directory, "manifest.json")),
  repositoryRoot = REPOSITORY_ROOT,
  verifyRuntimeBoundary = true,
} = {}) {
  if (manifest.schemaVersion !== 1 || manifest.status !== "DRAFT_NOT_APPROVED" ||
    manifest.approvedForPublication !== false || manifest.runtimeEligible !== false) {
    throw new Error("Product legal manifest must remain explicitly draft-only.");
  }
  const keys = Object.keys(manifest.documents ?? {});
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_DOCUMENT_KEYS)) {
    throw new Error("Product legal manifest has an unexpected document set or order.");
  }
  const expectedFiles = new Set(keys.map((key) => manifest.documents[key].filename));
  const actualFiles = fs.readdirSync(directory)
    .filter((filename) => filename.endsWith(".txt"));
  if (actualFiles.length !== expectedFiles.size ||
    actualFiles.some((filename) => !expectedFiles.has(filename))) {
    throw new Error("Product draft directory contains an unmanifested text document.");
  }

  const verified = keys.map((key) =>
    assertDraftDocument(directory, key, manifest.documents[key])
  );
  assertPaygPrivacyNoticeDraftBasis(manifest, repositoryRoot);
  const acceptance = manifest.paygDraftAcceptance;
  if (acceptance?.statementId !== "payg_specific_date_cancellation_v1" ||
    acceptance.copyVersion !==
      "ZAF-PAYG-CANCELLATION-STATEMENT-DRAFT-2026-08-31-01" ||
    acceptance.approved !== false) {
    throw new Error("The PAYG specific-date cancellation statement is not frozen as a draft.");
  }
  const decisions = Object.values(manifest.ownerDecisions ?? {});
  if (!decisions.length || decisions.some((value) => value !== false && value !== null)) {
    throw new Error("Every product legal or retention decision must remain unresolved.");
  }
  if (!Array.isArray(manifest.promotionRequirements) ||
    manifest.promotionRequirements.length < 7) {
    throw new Error("Product legal promotion requirements are incomplete.");
  }
  if (verifyRuntimeBoundary) assertRuntimeRemainsClosed(repositoryRoot);
  return verified;
}

function main() {
  const verified = verifyProductLegalDrafts();
  console.log("Product legal review drafts verified as unapproved and runtime-ineligible:");
  for (const document of verified) {
    console.log(`- ${document.key}: ${document.bytes} bytes, sha256 ${document.sha256}`);
  }
  console.log("- PAYG cancellation statement: payg_specific_date_cancellation_v1 (DRAFT)");
  console.log("- Runtime and production examples: all relevant gates remain closed");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Product legal draft verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DRAFT_DIRECTORY,
  EXPECTED_DOCUMENT_KEYS,
  MANIFEST_PATH,
  assertRuntimeRemainsClosed,
  readManifest,
  sha256,
  verifyProductLegalDrafts,
};
