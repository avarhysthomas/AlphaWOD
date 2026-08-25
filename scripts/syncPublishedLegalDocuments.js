/* eslint-disable no-console */

const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const PUBLICATION_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "public",
  "legal",
  "memberships"
);
const REGISTRY_FILES = [
  path.join(REPOSITORY_ROOT, "functions", "src", "membershipPlans.ts"),
  path.join(REPOSITORY_ROOT, "src", "lib", "membershipPlans.ts"),
];

const PUBLICATION_MANIFEST = [
  {
    key: "membershipTerms",
    title: "Membership Terms",
    version: "ZAF-TERMS-2026-08-25-03",
    effectiveDate: "2026-08-25",
    approvedBytes: 21865,
    approvedSha256: "e9bb03df7489cce2267e23317b3ba67ed133c709ec1957b92f25fde386a67e61",
  },
  {
    key: "cancellationPolicy",
    title: "Cancellation, Refund and Cooling-off Policy",
    version: "ZAF-CANCEL-2026-08-23-01",
    effectiveDate: "2026-08-23",
    approvedBytes: 9255,
    approvedSha256: "80030b930615839db1b5116e5cf9b4231acb4c3036df6ab9909642bc02efd413",
  },
  {
    key: "privacyNotice",
    title: "Privacy Notice",
    version: "ZAF-PRIVACY-2026-08-25-02",
    effectiveDate: "2026-08-25",
    approvedBytes: 15236,
    approvedSha256: "0394ac927118b4490958cacff93c241f0ede617dd251758b33d464c72142a6fe",
  },
  {
    key: "adultWaiver",
    title: "Adult Participant Waiver and Risk Acknowledgement",
    version: "ZAF-ADULT-WAIVER-2026-08-23-01",
    effectiveDate: "2026-08-23",
    approvedBytes: 7144,
    approvedSha256: "84a520cbd72ac416183788c000c6e869dd1fd2bb0461abd60088cc36b355635f",
  },
  {
    key: "guardianAddendum",
    title: "Parent/Guardian Consent and Youth Membership Addendum",
    version: "ZAF-GUARDIAN-2026-08-25-03",
    effectiveDate: "2026-08-25",
    approvedBytes: 10978,
    approvedSha256: "5d11170208579af3ddb729b3561e61aadd81cc133c66a7a66cb0f7d6ed39ba5d",
  },
];

const CONTENT_TYPE = "text/plain; charset=utf-8";
const HASH_COVERS = "UTF-8 bytes of content";
// Each manifest entry freezes the approved version, effective date, bytes and
// digest. Runtime checkout remains separately controlled by the Functions and
// frontend environment purchase gates.
const PUBLICATION_APPROVED = true;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readPublicationDocuments(
  publicationDirectory = PUBLICATION_DIRECTORY,
  publicationManifest = PUBLICATION_MANIFEST
) {
  return publicationManifest.map((manifestEntry) => {
    const filename = `${manifestEntry.version}.txt`;
    const filePath = path.join(publicationDirectory, filename);
    const bytes = fs.readFileSync(filePath);
    const content = bytes.toString("utf8");

    if (!Buffer.from(content, "utf8").equals(bytes)) {
      throw new Error(`${filename} is not valid canonical UTF-8 text.`);
    }
    if (content.charCodeAt(0) === 0xFEFF) {
      throw new Error(`${filename} must not contain a UTF-8 byte-order mark.`);
    }
    if (!content.endsWith("\n")) {
      throw new Error(`${filename} must end with exactly one LF newline.`);
    }
    if (content.endsWith("\n\n")) {
      throw new Error(`${filename} must end with exactly one LF newline.`);
    }
    if (content.includes("\r")) {
      throw new Error(`${filename} must use LF line endings.`);
    }
    if (
      /\b(?:DRAFT|PENDING)\b|NOT APPROVED FOR PUBLICATION|REVIEW APPENDIX|MUST NOT BE PUBLISHED/i
        .test(content)
    ) {
      throw new Error(`${filename} contains a non-final publication marker.`);
    }

    const digest = sha256(bytes);
    if (bytes.length !== manifestEntry.approvedBytes ||
      digest !== manifestEntry.approvedSha256) {
      throw new Error(
        `${filename} does not match the explicitly approved immutable bytes.`
      );
    }

    return {
      key: manifestEntry.key,
      title: manifestEntry.title,
      version: manifestEntry.version,
      effectiveDate: manifestEntry.effectiveDate,
      publicUrl: `/legal/memberships/${filename}`,
      contentType: CONTENT_TYPE,
      hashCovers: HASH_COVERS,
      sha256: digest,
      content,
    };
  });
}

function renderDocumentRegistry(documents) {
  const lines = ["export const CHECKOUT_DOCUMENTS = {"];
  for (const document of documents) {
    lines.push(
      `  ${document.key}: {`,
      `    key: ${JSON.stringify(document.key)},`,
      `    title: ${JSON.stringify(document.title)},`,
      `    version: ${JSON.stringify(document.version)},`,
      `    effectiveDate: ${JSON.stringify(document.effectiveDate)},`,
      `    publicUrl: ${JSON.stringify(document.publicUrl)},`,
      `    contentType: ${JSON.stringify(document.contentType)},`,
      `    hashCovers: ${JSON.stringify(document.hashCovers)},`,
      `    sha256: ${JSON.stringify(document.sha256)},`,
      `    content: ${JSON.stringify(document.content)},`,
      "  },"
    );
  }
  lines.push("} as const;");
  return lines.join("\n");
}

function synchronizeRegistrySource(source, renderedRegistry) {
  const declarationStart = source.indexOf("export const CHECKOUT_DOCUMENTS = {");
  if (declarationStart === -1) {
    throw new Error("CHECKOUT_DOCUMENTS declaration was not found.");
  }
  const declarationEndMarker = "\n} as const;";
  const declarationEnd = source.indexOf(declarationEndMarker, declarationStart);
  if (declarationEnd === -1) {
    throw new Error("CHECKOUT_DOCUMENTS declaration end was not found.");
  }
  const afterDeclaration = declarationEnd + declarationEndMarker.length;
  const withRegistry = source.slice(0, declarationStart) + renderedRegistry +
    source.slice(afterDeclaration);

  const gatePattern =
    /export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = (?:true|false);/;
  if (!gatePattern.test(withRegistry)) {
    throw new Error(
      "CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION declaration was not found."
    );
  }
  return withRegistry.replace(
    gatePattern,
    `export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = ${PUBLICATION_APPROVED};`
  );
}

function expectedRegistrySources({
  publicationDirectory = PUBLICATION_DIRECTORY,
  registryFiles = REGISTRY_FILES,
} = {}) {
  const documents = readPublicationDocuments(publicationDirectory);
  const renderedRegistry = renderDocumentRegistry(documents);
  return registryFiles.map((filePath) => {
    const currentSource = fs.readFileSync(filePath, "utf8");
    return {
      filePath,
      currentSource,
      expectedSource: synchronizeRegistrySource(currentSource, renderedRegistry),
    };
  });
}

function checkRegistrySync(options) {
  const drifted = expectedRegistrySources(options)
    .filter(({currentSource, expectedSource}) => currentSource !== expectedSource)
    .map(({filePath}) => path.relative(REPOSITORY_ROOT, filePath));
  if (drifted.length > 0) {
    throw new Error(
      `Published legal registry is out of sync: ${drifted.join(", ")}. ` +
      "Run npm run sync:published-legal."
    );
  }
  return PUBLICATION_MANIFEST.map(({key, version}) => ({key, version}));
}

function writeRegistrySync(options) {
  const changed = [];
  for (const {filePath, currentSource, expectedSource} of
    expectedRegistrySources(options)) {
    if (currentSource === expectedSource) continue;
    fs.writeFileSync(filePath, expectedSource, "utf8");
    changed.push(path.relative(REPOSITORY_ROOT, filePath));
  }
  return changed;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--check") {
    const checked = checkRegistrySync();
    console.log(`Published legal registry is synchronized (${checked.length} documents).`);
    return;
  }
  if (mode === "--write") {
    const changed = writeRegistrySync();
    console.log(changed.length > 0 ?
      `Synchronized published legal registry: ${changed.join(", ")}` :
      "Published legal registry was already synchronized.");
    return;
  }
  throw new Error("Usage: node scripts/syncPublishedLegalDocuments.js [--check|--write]");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Published legal registry synchronization failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PUBLICATION_APPROVED,
  PUBLICATION_MANIFEST,
  checkRegistrySync,
  expectedRegistrySources,
  readPublicationDocuments,
  renderDocumentRegistry,
  sha256,
  synchronizeRegistrySource,
  writeRegistrySync,
};
