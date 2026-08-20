const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  isUtf8PlainText,
  verifyPublishedLegalDocuments,
} = require("./verifyPublishedLegalDocuments");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finalDocument(key, content = `Final published copy for ${key}.\n`) {
  const version = `ZAF-${key.toUpperCase()}-2026-09-01-01`;
  return {
    key,
    title: `Final ${key}`,
    version,
    effectiveDate: "2026-09-01",
    publicUrl: `/legal/memberships/${version}.txt`,
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: sha256(content),
    content,
  };
}

function fakeResponse({
  body,
  status = 200,
  contentType = "text/plain; charset=utf-8",
}) {
  const bytes = Uint8Array.from(Buffer.from(body, "utf8"));
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async arrayBuffer() {
      return bytes.buffer;
    },
  };
}

function verificationInput(overrides = {}) {
  const documents = {
    membershipTerms: finalDocument("membershipTerms"),
    privacyNotice: finalDocument("privacyNotice"),
  };
  return {
    origin: "https://alpha-wod.vercel.app",
    documents,
    documentsApproved: true,
    validatePublicationModel() {},
    ...overrides,
  };
}

test("fetches every final URL and verifies exact canonical bytes and SHA-256", async () => {
  const calls = [];
  let modelValidations = 0;
  const input = verificationInput({
    validatePublicationModel() {
      modelValidations += 1;
    },
  });
  input.fetchImpl = async (url, options) => {
    calls.push({url, options});
    const document = Object.values(input.documents)
      .find(({publicUrl}) => url.endsWith(publicUrl));
    return fakeResponse({body: document.content});
  };

  const result = await verifyPublishedLegalDocuments(input);

  assert.equal(modelValidations, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({url}) => url), [
    "https://alpha-wod.vercel.app/legal/memberships/" +
      "ZAF-MEMBERSHIPTERMS-2026-09-01-01.txt",
    "https://alpha-wod.vercel.app/legal/memberships/" +
      "ZAF-PRIVACYNOTICE-2026-09-01-01.txt",
  ]);
  for (const {options} of calls) {
    assert.deepEqual(options, {
      method: "GET",
      redirect: "error",
      headers: {accept: "text/plain"},
    });
  }
  assert.deepEqual(result.map(({key, sha256: digest}) => ({key, digest})), [
    {
      key: "membershipTerms",
      digest: input.documents.membershipTerms.sha256,
    },
    {
      key: "privacyNotice",
      digest: input.documents.privacyNotice.sha256,
    },
  ]);
});

test("accepts ordinary Depending text but rejects standalone finality markers", async () => {
  const depending = finalDocument(
    "privacyNotice",
    "Depending on the circumstances, a person may have additional rights.\n"
  );
  await assert.doesNotReject(
    verifyPublishedLegalDocuments(verificationInput({
      documents: {privacyNotice: depending},
      fetchImpl: async () => fakeResponse({body: depending.content}),
    }))
  );

  for (const marker of ["DRAFT", "PENDING"]) {
    const marked = finalDocument(
      "privacyNotice",
      `${marker} legal publication text.\n`
    );
    await assert.rejects(
      verifyPublishedLegalDocuments(verificationInput({
        documents: {privacyNotice: marked},
        fetchImpl: async () => fakeResponse({body: marked.content}),
      })),
      /not a final publication registry entry/i
    );
  }
});

test("refuses closed, draft and canonically invalid registries before fetching", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    throw new Error("network must not be reached");
  };

  await assert.rejects(
    verifyPublishedLegalDocuments(verificationInput({
      documentsApproved: false,
      fetchImpl,
    })),
    /approved_for_publication must be true/i
  );

  const draft = finalDocument("membershipTerms");
  draft.version = "ZAF-TERMS-DRAFT-2026-09-01-01";
  draft.publicUrl = `/legal/memberships/${draft.version}.txt`;
  await assert.rejects(
    verifyPublishedLegalDocuments(verificationInput({
      documents: {membershipTerms: draft},
      fetchImpl,
    })),
    /not a final publication registry entry/i
  );

  await assert.rejects(
    verifyPublishedLegalDocuments(verificationInput({
      validatePublicationModel() {
        throw new Error("canonical publication model is invalid");
      },
      fetchImpl,
    })),
    /canonical publication model is invalid/i
  );
  assert.equal(fetches, 0);
});

test("requires a bare HTTPS origin and immutable HTTPS document URLs", async () => {
  const noNetwork = async () => {
    throw new Error("network must not be reached");
  };
  for (const origin of [
    "http://alpha-wod.vercel.app",
    "https://alpha-wod.vercel.app/path",
    "https://alpha-wod.vercel.app?release=latest",
  ]) {
    await assert.rejects(
      verifyPublishedLegalDocuments(verificationInput({origin, fetchImpl: noNetwork})),
      /bare HTTPS origin/i
    );
  }

  for (const publicUrl of [
    "http://alpha-wod.vercel.app/legal/terms.txt",
    "/legal/memberships/current.txt",
    "/legal/memberships/ZAF-MEMBERSHIPTERMS-2026-09-01-01.txt?latest=1",
    "//example.com/ZAF-MEMBERSHIPTERMS-2026-09-01-01.txt",
  ]) {
    const document = finalDocument("membershipTerms");
    document.publicUrl = publicUrl;
    await assert.rejects(
      verifyPublishedLegalDocuments(verificationInput({
        documents: {membershipTerms: document},
        fetchImpl: noNetwork,
      })),
      /HTTPS|immutable/i
    );
  }
});

test("requires HTTP 200 and an explicit UTF-8 text/plain response", async () => {
  const document = finalDocument("membershipTerms");
  for (const response of [
    fakeResponse({body: document.content, status: 404}),
    fakeResponse({body: document.content, contentType: "text/html; charset=utf-8"}),
    fakeResponse({body: document.content, contentType: "text/plain"}),
  ]) {
    await assert.rejects(
      verifyPublishedLegalDocuments(verificationInput({
        documents: {membershipTerms: document},
        fetchImpl: async () => response,
      })),
      /HTTP 404|text\/plain with charset=utf-8/i
    );
  }

  assert.equal(isUtf8PlainText("text/plain; charset=UTF-8"), true);
  assert.equal(isUtf8PlainText("text/plain; charset=\"utf-8\""), true);
  assert.equal(isUtf8PlainText("text/plain"), false);
});

test("rejects deployed byte drift and a digest that is not canonical", async () => {
  const document = finalDocument("membershipTerms");
  await assert.rejects(
    verifyPublishedLegalDocuments(verificationInput({
      documents: {membershipTerms: document},
      fetchImpl: async () => fakeResponse({body: `${document.content}changed\n`}),
    })),
    /bytes do not match/i
  );

  const wrongDigest = {...document, sha256: "0".repeat(64)};
  await assert.rejects(
    verifyPublishedLegalDocuments(verificationInput({
      documents: {membershipTerms: wrongDigest},
      fetchImpl: async () => fakeResponse({body: wrongDigest.content}),
    })),
    /SHA-256 does not match/i
  );
});
