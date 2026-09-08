/* eslint-disable @typescript-eslint/no-var-requires, max-len */

const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PAYG_CLASS_ID,
  buildLocalPaygClassDocument,
  buildLocalPaygEnvironment,
  dotenvOverlayPaths,
  installLocalPaygDotenvOverlay,
  loadApprovedPaygRelease,
  recoverLocalPaygDotenvOverlay,
  renderLocalPaygDotenv,
} = require("../scripts/localStripePaygJourney");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

test("PAYG browser journey uses approved finals and isolated secrets", () => {
  const release = loadApprovedPaygRelease(REPOSITORY_ROOT);
  let secretIndex = 0;
  const environment = buildLocalPaygEnvironment(
    release,
    () => `local-secret-${++secretIndex}-${"x".repeat(32)}`
  );

  assert.equal(environment.PAYG_AVAILABILITY_ENABLED, "true");
  assert.equal(environment.PAYG_LEGAL_APPROVED, "true");
  assert.equal(environment.PAYG_PII_RETENTION_APPROVED, "true");
  assert.equal(environment.PAYG_ORDER_PII_RETENTION_DAYS, "90");
  assert.equal(environment.PAYG_WAIVER_PII_RETENTION_DAYS, "2190");
  assert.equal(
    environment.PAYG_CANCELLATION_TOKEN_KEY_ID,
    "cancel-local-browser-v1"
  );
  assert.equal(environment.PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID, "");
  assert.equal(environment.PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL, "");
  assert.match(
    environment.PAYG_WAIVER_VERSION,
    /^ZAF-PAYG-WAIVER-(?!.*DRAFT)/
  );
  assert.match(
    environment.PAYG_TERMS_VERSION,
    /^ZAF-PAYG-TERMS-(?!.*DRAFT)/
  );
  assert.match(
    environment.PAYG_PRIVACY_NOTICE_VERSION,
    /^ZAF-PAYG-PRIVACY-NOTICE-(?!.*DRAFT)/
  );
  assert.equal(
    environment.PAYG_FROM_EMAIL.endsWith("@example.invalid>"),
    true
  );
  assert.equal(
    environment.PAYG_REPLY_TO_EMAIL.endsWith("@example.invalid"),
    true
  );
  assert.equal(secretIndex, 3);
  assert.notEqual(
    environment.PAYG_CANCELLATION_TOKEN_SECRET,
    environment.PAYG_DUPLICATE_LOCK_SECRET
  );
});

test("PAYG browser class is future-dated and emulator-only", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const seeded = buildLocalPaygClassDocument(now);

  assert.equal(seeded.classId, PAYG_CLASS_ID);
  assert.equal(Date.parse(seeded.startTime), now + 48 * 60 * 60 * 1000);
  assert.equal(
    Date.parse(seeded.endTime),
    Date.parse(seeded.startTime) + 60 * 60 * 1000
  );
  assert.equal(seeded.body.fields.status.stringValue, "scheduled");
  assert.equal(seeded.body.fields.paygEligible.booleanValue, true);
  assert.equal(seeded.body.fields.capacity.integerValue, "12");
  assert.match(seeded.body.fields.location.stringValue, /Local emulator/);
});

test("PAYG dotenv overlay allowlists rotation metadata, excludes secrets, and restores bytes", (t) => {
  const original = [
    "PAYG_LEGAL_APPROVED=false",
    "PAYG_WAIVER_VERSION=",
    "UNCHANGED=value",
    "",
  ].join("\n");
  const environment = {
    PAYG_LEGAL_APPROVED: "true",
    PAYG_WAIVER_VERSION: "ZAF-PAYG-WAIVER-2026-09-01-01",
    PAYG_TERMS_VERSION: "ZAF-PAYG-TERMS-2026-09-01-01",
    PAYG_CANCELLATION_TOKEN_KEY_ID: "cancel-current",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID: "cancel-previous",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL:
      "2026-09-02T12:00:00.000Z",
    PAYG_CANCELLATION_TOKEN_SECRET: "must-never-reach-dotenv",
    UNREVIEWED_PAYG_PARAMETER: "must-not-reach-dotenv",
  };
  const rendered = renderLocalPaygDotenv(original, environment);
  assert.match(rendered, /^PAYG_LEGAL_APPROVED=true$/m);
  assert.match(
    rendered,
    /^PAYG_TERMS_VERSION=ZAF-PAYG-TERMS-2026-09-01-01$/m
  );
  assert.doesNotMatch(rendered, /must-never-reach-dotenv/);
  assert.doesNotMatch(rendered, /UNREVIEWED_PAYG_PARAMETER/);
  assert.match(rendered, /^PAYG_CANCELLATION_TOKEN_KEY_ID=cancel-current$/m);
  assert.match(
    rendered,
    /^PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID=cancel-previous$/m
  );
  assert.match(
    rendered,
    /^PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL=2026-09-02T12:00:00.000Z$/m
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-test-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  fs.writeFileSync(dotenvPath, original);
  const restore = installLocalPaygDotenvOverlay(dotenvPath, environment);
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), rendered);
  restore();
  restore();
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
  const paths = dotenvOverlayPaths(dotenvPath);
  assert.equal(fs.existsSync(paths.lockPath), false);
  assert.equal(fs.existsSync(paths.journalPath), false);
});

test("PAYG dotenv overlay holds an exclusive owner lock", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-lock-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  fs.writeFileSync(dotenvPath, "PAYG_LEGAL_APPROVED=false\n");

  const restore = installLocalPaygDotenvOverlay(dotenvPath, {
    PAYG_LEGAL_APPROVED: "true",
  });
  assert.throws(
    () => installLocalPaygDotenvOverlay(dotenvPath, {
      PAYG_LEGAL_APPROVED: "true",
    }),
    /owns the dotenv overlay/
  );
  restore();
  assert.equal(
    fs.readFileSync(dotenvPath, "utf8"),
    "PAYG_LEGAL_APPROVED=false\n"
  );
});

test("PAYG dotenv overlay recovers a journal left by an abruptly exited owner", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-crash-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = [
    "PAYG_AVAILABILITY_ENABLED=false",
    "PAYG_LEGAL_APPROVED=false",
    "PAYG_WAIVER_VERSION=",
    "PAYG_TERMS_VERSION=",
    "PAYG_PII_RETENTION_APPROVED=false",
    "",
  ].join("\n");
  fs.writeFileSync(dotenvPath, original);
  const helperPath = require.resolve("../scripts/localStripePaygJourney");
  const childScript =
    "const helper = require(" + JSON.stringify(helperPath) + ");\n" +
    "helper.installLocalPaygDotenvOverlay(" +
      JSON.stringify(dotenvPath) +
      ", {PAYG_LEGAL_APPROVED: \"true\"});\n";
  const child = spawnSync(process.execPath, ["-e", childScript], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(
    fs.readFileSync(dotenvPath, "utf8"),
    /^PAYG_LEGAL_APPROVED=true$/m
  );

  const restore = installLocalPaygDotenvOverlay(dotenvPath, {
    PAYG_TERMS_VERSION: "ZAF-PAYG-TERMS-RECOVERY-TEST",
  });
  const recoveredOverlay = fs.readFileSync(dotenvPath, "utf8");
  assert.match(recoveredOverlay, /^PAYG_LEGAL_APPROVED=false$/m);
  assert.match(
    recoveredOverlay,
    /^PAYG_TERMS_VERSION=ZAF-PAYG-TERMS-RECOVERY-TEST$/m
  );
  restore();
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
});

test("a later non-PAYG runner recovers an abruptly abandoned overlay", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-next-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_AVAILABILITY_ENABLED=false\nPAYG_LEGAL_APPROVED=false\n";
  fs.writeFileSync(dotenvPath, original);
  const helperPath = require.resolve("../scripts/localStripePaygJourney");
  const childScript =
    "const helper = require(" + JSON.stringify(helperPath) + ");\n" +
    "helper.installLocalPaygDotenvOverlay(" +
      JSON.stringify(dotenvPath) +
      ", {PAYG_AVAILABILITY_ENABLED: \"true\", " +
      "PAYG_LEGAL_APPROVED: \"true\"});\n";
  const child = spawnSync(process.execPath, ["-e", childScript], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(recoverLocalPaygDotenvOverlay(dotenvPath), true);
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
  assert.equal(recoverLocalPaygDotenvOverlay(dotenvPath), false);
});

test("PAYG dotenv restore is compare-and-swap and remains retryable after failed I/O", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-cas-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_LEGAL_APPROVED=false\nUNCHANGED=value\n";
  fs.writeFileSync(dotenvPath, original, {mode: 0o640});
  const restore = installLocalPaygDotenvOverlay(dotenvPath, {
    PAYG_LEGAL_APPROVED: "true",
  });
  const overlay = fs.readFileSync(dotenvPath);
  const paths = dotenvOverlayPaths(dotenvPath);
  assert.equal(fs.statSync(paths.journalPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.lockPath).mode & 0o777, 0o600);

  const concurrentEdit = Buffer.from(
    "PAYG_LEGAL_APPROVED=true\nUNCHANGED=operator-edit\n"
  );
  fs.writeFileSync(dotenvPath, concurrentEdit);
  assert.throws(restore, /changed after the PAYG overlay was installed/);
  assert.deepEqual(fs.readFileSync(dotenvPath), concurrentEdit);
  assert.equal(fs.existsSync(paths.journalPath), true);
  assert.equal(fs.existsSync(paths.lockPath), true);

  fs.writeFileSync(dotenvPath, overlay);
  restore();
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
  assert.equal(fs.statSync(dotenvPath).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(paths.journalPath), false);
  assert.equal(fs.existsSync(paths.lockPath), false);
});

test("PAYG restore cannot overwrite an editor that wins the final path race", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-race-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_LEGAL_APPROVED=false\nUNCHANGED=baseline\n";
  const operatorEdit = "PAYG_LEGAL_APPROVED=true\nUNCHANGED=operator-race\n";
  fs.writeFileSync(dotenvPath, original);
  const restore = installLocalPaygDotenvOverlay(dotenvPath, {
    PAYG_LEGAL_APPROVED: "true",
  });
  const overlay = fs.readFileSync(dotenvPath);
  const paths = dotenvOverlayPaths(dotenvPath);
  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, destination) => {
    if (!injected && source === dotenvPath &&
      path.basename(destination) === "captured") {
      injected = true;
      fs.writeFileSync(dotenvPath, operatorEdit);
    }
    return originalRename(source, destination);
  };
  try {
    assert.throws(restore, /conditional file operation/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), operatorEdit);
  assert.equal(fs.existsSync(paths.journalPath), true);
  assert.equal(fs.existsSync(paths.lockPath), true);

  fs.writeFileSync(dotenvPath, overlay);
  restore();
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
  assert.equal(
    fs.readdirSync(directory).some((name) => name.includes(".payg-cas-")),
    false
  );
});

test("stale-lock reclaim cannot unlink a concurrently replaced owner", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-lock-race-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_LEGAL_APPROVED=false\n";
  fs.writeFileSync(dotenvPath, original);
  const helperPath = require.resolve("../scripts/localStripePaygJourney");
  const childScript =
    "const helper = require(" + JSON.stringify(helperPath) + ");\n" +
    "helper.installLocalPaygDotenvOverlay(" +
      JSON.stringify(dotenvPath) +
      ", {PAYG_LEGAL_APPROVED: \"true\"});\n";
  const child = spawnSync(process.execPath, ["-e", childScript], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  const paths = dotenvOverlayPaths(dotenvPath);
  const replacementLock = JSON.stringify({
    version: 1,
    pid: process.pid,
    token: "b".repeat(32),
    createdAt: new Date().toISOString(),
  }) + "\n";
  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, destination) => {
    if (!injected && source === paths.lockPath &&
      path.basename(destination) === "captured") {
      injected = true;
      fs.writeFileSync(paths.lockPath, replacementLock);
    }
    return originalRename(source, destination);
  };
  try {
    assert.throws(
      () => recoverLocalPaygDotenvOverlay(dotenvPath),
      /owns the dotenv overlay/
    );
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(paths.lockPath, "utf8"), replacementLock);
  assert.equal(fs.existsSync(paths.journalPath), true);

  fs.unlinkSync(paths.lockPath);
  assert.equal(recoverLocalPaygDotenvOverlay(dotenvPath), true);
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
});

test("abrupt conditional replacements recover before and after the new link", async (t) => {
  const scenarios = [
    ["after capture", "before-link", 91],
    ["after replacement", "after-link", 92],
  ];
  for (const [name, crashPoint, expectedStatus] of scenarios) {
    await t.test(name, (t) => {
      const directory = fs.mkdtempSync(path.join(
        os.tmpdir(),
        "payg-cas-crash-"
      ));
      t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
      const dotenvPath = path.join(directory, ".env.local");
      const original = "PAYG_LEGAL_APPROVED=false\nUNCHANGED=baseline\n";
      fs.writeFileSync(dotenvPath, original);
      const helperPath = require.resolve("../scripts/localStripePaygJourney");
      const childScript = [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const dotenvPath = " + JSON.stringify(dotenvPath) + ";",
        "const crashPoint = " + JSON.stringify(crashPoint) + ";",
        "const originalLink = fs.linkSync;",
        "const originalUnlink = fs.unlinkSync;",
        "fs.linkSync = (source, destination) => {",
        "  if (crashPoint === 'before-link' && destination === dotenvPath) process.exit(91);",
        "  return originalLink(source, destination);",
        "};",
        "fs.unlinkSync = (target) => {",
        "  if (crashPoint === 'after-link' && path.basename(target) === 'captured' &&",
        "    path.basename(path.dirname(target)).startsWith('..env.local.payg-cas-')) process.exit(92);",
        "  return originalUnlink(target);",
        "};",
        "const helper = require(" + JSON.stringify(helperPath) + ");",
        "helper.installLocalPaygDotenvOverlay(dotenvPath, {PAYG_LEGAL_APPROVED: 'true'});",
      ].join("\n");
      const child = spawnSync(process.execPath, ["-e", childScript], {
        encoding: "utf8",
      });
      assert.equal(child.status, expectedStatus, child.stderr);
      assert.equal(
        fs.readdirSync(directory).some((entry) =>
          entry.startsWith("..env.local.payg-cas-")),
        true
      );

      assert.equal(recoverLocalPaygDotenvOverlay(dotenvPath), true);
      assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
      assert.equal(
        fs.readdirSync(directory).some((entry) => entry.includes(".payg-cas-")),
        false
      );
      const paths = dotenvOverlayPaths(dotenvPath);
      assert.equal(fs.existsSync(paths.journalPath), false);
      assert.equal(fs.existsSync(paths.lockPath), false);
      assert.deepEqual(fs.readdirSync(directory).sort(), [".env.local"]);
    });
  }
});

test("orphan recovery preserves a concurrent editor and fails closed", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-cas-edit-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_LEGAL_APPROVED=false\nUNCHANGED=baseline\n";
  const operatorEdit = "PAYG_LEGAL_APPROVED=true\nUNCHANGED=operator\n";
  const environment = {PAYG_LEGAL_APPROVED: "true"};
  fs.writeFileSync(dotenvPath, original);
  const helperPath = require.resolve("../scripts/localStripePaygJourney");
  const childScript = [
    "const fs = require('node:fs');",
    "const dotenvPath = " + JSON.stringify(dotenvPath) + ";",
    "const originalLink = fs.linkSync;",
    "fs.linkSync = (source, destination) => {",
    "  if (destination === dotenvPath) process.exit(93);",
    "  return originalLink(source, destination);",
    "};",
    "const helper = require(" + JSON.stringify(helperPath) + ");",
    "helper.installLocalPaygDotenvOverlay(dotenvPath, {PAYG_LEGAL_APPROVED: 'true'});",
  ].join("\n");
  const child = spawnSync(process.execPath, ["-e", childScript], {
    encoding: "utf8",
  });
  assert.equal(child.status, 93, child.stderr);
  assert.equal(fs.existsSync(dotenvPath), false);
  fs.writeFileSync(dotenvPath, operatorEdit);

  assert.throws(
    () => recoverLocalPaygDotenvOverlay(dotenvPath),
    /recovery journal was retained/
  );
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), operatorEdit);
  assert.equal(
    fs.readdirSync(directory).some((entry) => entry.includes(".payg-cas-")),
    false
  );
  assert.equal(
    fs.readdirSync(directory).some((entry) => entry.endsWith(".tmp")),
    false
  );
  const paths = dotenvOverlayPaths(dotenvPath);
  assert.equal(fs.existsSync(paths.journalPath), true);

  fs.writeFileSync(
    dotenvPath,
    renderLocalPaygDotenv(original, environment)
  );
  assert.equal(recoverLocalPaygDotenvOverlay(dotenvPath), true);
  assert.equal(fs.readFileSync(dotenvPath, "utf8"), original);
});

test("PAYG dotenv overlay rejects a symlink without replacing its target", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payg-dotenv-link-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const targetPath = path.join(directory, "operator.env");
  const dotenvPath = path.join(directory, ".env.local");
  const original = "PAYG_LEGAL_APPROVED=false\n";
  fs.writeFileSync(targetPath, original);
  fs.symlinkSync(targetPath, dotenvPath);

  assert.throws(
    () => installLocalPaygDotenvOverlay(dotenvPath, {
      PAYG_LEGAL_APPROVED: "true",
    }),
    /symbolic link/
  );
  assert.equal(fs.lstatSync(dotenvPath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(targetPath, "utf8"), original);
  const paths = dotenvOverlayPaths(dotenvPath);
  assert.equal(fs.existsSync(paths.lockPath), false);
  assert.equal(fs.existsSync(paths.journalPath), false);
});
