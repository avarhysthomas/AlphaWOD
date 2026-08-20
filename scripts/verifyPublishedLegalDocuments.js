/* eslint-disable no-console */

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireHttpsOrigin(rawOrigin) {
  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("APP_PUBLIC_ORIGIN must be a valid absolute HTTPS origin.");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) {
    throw new Error("APP_PUBLIC_ORIGIN must be a bare HTTPS origin.");
  }
  return origin;
}

function isUtf8PlainText(contentType) {
  if (typeof contentType !== "string") return false;
  const [mediaType, ...parameters] = contentType.toLowerCase()
    .split(";")
    .map((value) => value.trim());
  const charset = parameters
    .map((parameter) => parameter.split("=").map((value) => value.trim()))
    .find(([name]) => name === "charset")?.[1]
    ?.replace(/^"|"$/g, "");
  return mediaType === "text/plain" && charset === "utf-8";
}

function assertFinalDocumentRegistry({
  documents,
  documentsApproved,
  validatePublicationModel,
}) {
  if (documentsApproved !== true) {
    throw new Error(
      "CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION must be true before deployed legal documents are verified."
    );
  }
  if (typeof validatePublicationModel !== "function") {
    throw new Error("The canonical checkout publication validator is required.");
  }

  // Reuse the checkout's complete company, evidence-set, content-budget, digest,
  // effective-date and immutable-URL validation before touching the network.
  validatePublicationModel();

  const entries = Object.entries(documents ?? {});
  if (entries.length === 0) {
    throw new Error("CHECKOUT_DOCUMENTS must contain at least one final document.");
  }
  for (const [key, document] of entries) {
    if (!document || typeof document !== "object" ||
      /DRAFT|PENDING/i.test(JSON.stringify(document))) {
      throw new Error(`Checkout document ${key} is not a final publication registry entry.`);
    }
  }
  return entries;
}

function resolveImmutableDocumentUrl(origin, key, document) {
  const rawUrl = typeof document.publicUrl === "string" ? document.publicUrl : "";
  const isRootRelative = rawUrl.startsWith("/") && !rawUrl.startsWith("//");
  const isAbsoluteHttps = /^https:\/\//i.test(rawUrl);
  if (!isRootRelative && !isAbsoluteHttps) {
    throw new Error(`Checkout document ${key} must use HTTPS or a root-relative URL.`);
  }

  let url;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    throw new Error(`Checkout document ${key} has an invalid public URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || !url.pathname.includes(document.version)) {
    throw new Error(`Checkout document ${key} does not use an immutable HTTPS URL.`);
  }
  return url;
}

async function verifyPublishedLegalDocuments({
  origin: rawOrigin,
  documents,
  documentsApproved,
  validatePublicationModel,
  fetchImpl = globalThis.fetch,
}) {
  const entries = assertFinalDocumentRegistry({
    documents,
    documentsApproved,
    validatePublicationModel,
  });
  const origin = requireHttpsOrigin(rawOrigin);
  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch implementation is required.");
  }

  const seenUrls = new Set();
  const verified = [];
  for (const [key, document] of entries) {
    const url = resolveImmutableDocumentUrl(origin, key, document);
    if (seenUrls.has(url.href)) {
      throw new Error(`Checkout document ${key} reuses another document's public URL.`);
    }
    seenUrls.add(url.href);

    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "GET",
        redirect: "error",
        headers: {accept: "text/plain"},
      });
    } catch (error) {
      throw new Error(
        `Checkout document ${key} could not be fetched from its final URL: ${error.message}`
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `Checkout document ${key} returned HTTP ${response.status}; expected 200.`
      );
    }
    const contentType = response.headers?.get?.("content-type");
    if (!isUtf8PlainText(contentType)) {
      throw new Error(
        `Checkout document ${key} must return text/plain with charset=utf-8.`
      );
    }

    const deployedBytes = Buffer.from(await response.arrayBuffer());
    const canonicalBytes = Buffer.from(document.content, "utf8");
    try {
      assert.deepEqual(deployedBytes, canonicalBytes);
    } catch {
      throw new Error(
        `Checkout document ${key} bytes do not match the canonical registry content.`
      );
    }
    const deployedDigest = sha256(deployedBytes);
    if (deployedDigest !== document.sha256) {
      throw new Error(
        `Checkout document ${key} SHA-256 does not match the canonical registry digest.`
      );
    }
    verified.push({
      key,
      url: url.href,
      bytes: deployedBytes.length,
      sha256: deployedDigest,
    });
  }
  return verified;
}

async function main() {
  const {
    CHECKOUT_DOCUMENTS,
    CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  } = require("../functions/lib/membershipPlans");
  const {__testing: membershipTesting} = require("../functions/lib/membership");
  const verified = await verifyPublishedLegalDocuments({
    origin: process.env.APP_PUBLIC_ORIGIN?.trim(),
    documents: CHECKOUT_DOCUMENTS,
    documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    validatePublicationModel: () =>
      membershipTesting.assertCheckoutDocumentModel(true),
  });

  console.log("Published checkout legal documents verified (read-only):");
  for (const document of verified) {
    console.log(
      `- ${document.key}: ${document.bytes} bytes, sha256 ${document.sha256}, ${document.url}`
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Published legal-document verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertFinalDocumentRegistry,
  isUtf8PlainText,
  requireHttpsOrigin,
  resolveImmutableDocumentUrl,
  verifyPublishedLegalDocuments,
};
