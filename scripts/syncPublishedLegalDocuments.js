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
    version: "ZAF-TERMS-2026-08-20-01",
    approvedBytes: 19012,
    approvedSha256: "436efc32dcf1914c94a7357cb8938e294e818dbeda50eba9600b00a16edd6c6e",
  },
  {
    key: "cancellationPolicy",
    title: "Cancellation, Refund and Cooling-off Policy",
    version: "ZAF-CANCEL-2026-08-20-01",
    approvedBytes: 8380,
    approvedSha256: "983c1e883887d5b44da3170a2df4a474c5e41e7df2a0988e3ee6606e29356402",
  },
  {
    key: "privacyNotice",
    title: "Privacy Notice",
    version: "ZAF-PRIVACY-2026-08-20-01",
    approvedBytes: 14570,
    approvedSha256: "9ada73108301c20c87a5c9982f0dac258662260da7e5c3d78431287630f41b9b",
  },
  {
    key: "adultWaiver",
    title: "Adult Participant Waiver and Risk Acknowledgement",
    version: "ZAF-ADULT-WAIVER-2026-08-20-01",
    approvedBytes: 7144,
    approvedSha256: "fff52601536b2cef1a63db3fb05f7101cee407e13eee70fab78f88c8e349ec72",
  },
  {
    key: "guardianAddendum",
    title: "Parent/Guardian Consent and Youth Membership Addendum",
    version: "ZAF-GUARDIAN-2026-08-20-01",
    approvedBytes: 9047,
    approvedSha256: "8118e51ceb7f66aa3dcf6ee658cc627d469db670e8f2a2a13110aeb4a605cdd7",
  },
];

const EFFECTIVE_DATE = "2026-08-20";
const CONTENT_TYPE = "text/plain; charset=utf-8";
const HASH_COVERS = "UTF-8 bytes of content";

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
      effectiveDate: EFFECTIVE_DATE,
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
    "export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = true;"
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
  PUBLICATION_MANIFEST,
  checkRegistrySync,
  expectedRegistrySources,
  readPublicationDocuments,
  renderDocumentRegistry,
  sha256,
  synchronizeRegistrySource,
  writeRegistrySync,
};
