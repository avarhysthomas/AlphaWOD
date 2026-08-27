const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PUBLICATION_APPROVED,
  PUBLICATION_MANIFEST,
  readPublicationDocuments,
  renderDocumentRegistry,
  synchronizeRegistrySource,
} = require("./syncPublishedLegalDocuments");

function withPublicationDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zaf-published-legal-"));
  try {
    const publicationManifest = PUBLICATION_MANIFEST.map(({
      key,
      title,
      version,
      effectiveDate,
    }) => {
      const content = `${version}\n\nApproved customer text for ${key}.\n`;
      fs.writeFileSync(
        path.join(directory, `${version}.txt`),
        content,
        "utf8"
      );
      return {
        key,
        title,
        version,
        effectiveDate,
        approvedBytes: Buffer.byteLength(content, "utf8"),
        approvedSha256: createHash("sha256")
          .update(content, "utf8")
          .digest("hex"),
      };
    });
    run(directory, publicationManifest);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

test("publication manifest fixes the mixed immutable document bundle", () => {
  assert.deepEqual(
    PUBLICATION_MANIFEST.map(({key, version, effectiveDate}) => [
      key,
      version,
      effectiveDate,
    ]),
    [
      ["membershipTerms", "ZAF-TERMS-2026-08-27-01", "2026-08-27"],
      ["cancellationPolicy", "ZAF-CANCEL-2026-08-23-01", "2026-08-23"],
      ["privacyNotice", "ZAF-PRIVACY-2026-08-25-02", "2026-08-25"],
      ["adultWaiver", "ZAF-ADULT-WAIVER-2026-08-23-01", "2026-08-23"],
      ["guardianAddendum", "ZAF-GUARDIAN-2026-08-27-01", "2026-08-27"],
    ]
  );
});

test("registry rendering freezes bytes, digests, and per-entry effective dates", () => {
  withPublicationDirectory((directory, publicationManifest) => {
    const documents = readPublicationDocuments(directory, publicationManifest);
    const registry = renderDocumentRegistry(documents);

    assert.equal(documents.length, 5);
    for (const [index, document] of documents.entries()) {
      assert.match(document.sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        document.effectiveDate,
        publicationManifest[index].effectiveDate
      );
      assert.equal(
        document.publicUrl,
        `/legal/memberships/${document.version}.txt`
      );
      assert.ok(registry.includes(JSON.stringify(document.content)));
      assert.ok(registry.includes(JSON.stringify(document.sha256)));
      assert.ok(registry.includes(JSON.stringify(document.effectiveDate)));
    }
  });
});

test("registry synchronization applies the explicit owner approval state", () => {
  withPublicationDirectory((directory, publicationManifest) => {
    const registry = renderDocumentRegistry(
      readPublicationDocuments(directory, publicationManifest)
    );
    const original = [
      "export const CHECKOUT_DOCUMENTS = {",
      "  placeholder: {},",
      "} as const;",
      "",
      "export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = false;",
      "",
    ].join("\n");
    const synchronized = synchronizeRegistrySource(original, registry);

    assert.ok(synchronized.includes(registry));
    assert.equal(PUBLICATION_APPROVED, true);
    assert.match(
      synchronized,
      /CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = true;/
    );
    assert.doesNotMatch(synchronized, /placeholder/);
  });
});

test("publication source rejects draft markers and non-canonical line endings", () => {
  withPublicationDirectory((directory, publicationManifest) => {
    const filename = `${PUBLICATION_MANIFEST[0].version}.txt`;
    const filePath = path.join(directory, filename);

    fs.writeFileSync(
      filePath,
      "Depending on the circumstances, the final terms apply.\n",
      "utf8"
    );
    const dependingContent =
      "Depending on the circumstances, the final terms apply.\n";
    const dependingManifest = publicationManifest.map((entry) =>
      entry.version === PUBLICATION_MANIFEST[0].version ? {
        ...entry,
        approvedBytes: Buffer.byteLength(dependingContent, "utf8"),
        approvedSha256: createHash("sha256")
          .update(dependingContent, "utf8")
          .digest("hex"),
      } : entry
    );
    assert.doesNotThrow(() =>
      readPublicationDocuments(directory, dependingManifest)
    );

    fs.writeFileSync(filePath, "DRAFT customer text.\n", "utf8");
    assert.throws(
      () => readPublicationDocuments(directory, publicationManifest),
      /non-final publication marker/
    );

    fs.writeFileSync(
      filePath,
      "The supplier audit listed in the review appendix must be completed.\n",
      "utf8"
    );
    assert.throws(
      () => readPublicationDocuments(directory, publicationManifest),
      /non-final publication marker/
    );

    fs.writeFileSync(filePath, "Approved customer text.\r\n", "utf8");
    assert.throws(
      () => readPublicationDocuments(directory, publicationManifest),
      /LF line endings/
    );
  });
});

test("publication source rejects changed bytes under an approved immutable ID", () => {
  withPublicationDirectory((directory, publicationManifest) => {
    const filename = `${PUBLICATION_MANIFEST[0].version}.txt`;
    fs.writeFileSync(
      path.join(directory, filename),
      "Changed customer text under the same immutable identifier.\n",
      "utf8"
    );

    assert.throws(
      () => readPublicationDocuments(directory, publicationManifest),
      /does not match the explicitly approved immutable bytes/
    );
  });
});
