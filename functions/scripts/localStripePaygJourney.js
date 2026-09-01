/* eslint-disable max-len, require-jsdoc */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PAYG_SCOPE = "adult_payg_class";
const PAYG_CLASS_ID = "payg_browser_test_class";
const REQUIRED_PAYG_DOCUMENTS = Object.freeze([
  ["paygWaiver", "PAYG_WAIVER"],
  ["paygTerms", "PAYG_TERMS"],
  ["paygPrivacyNotice", "PAYG_PRIVACY_NOTICE"],
]);
const PAYG_DOTENV_OVERLAY_NAMES = new Set([
  "PAYG_AVAILABILITY_ENABLED",
  "PAYG_LEGAL_APPROVED",
  "PAYG_PII_REDACTION_IMPLEMENTED",
  "PAYG_PII_RETENTION_APPROVED",
  "PAYG_PII_RETENTION_POLICY_VERSION",
  "PAYG_ORDER_PII_RETENTION_DAYS",
  "PAYG_WAIVER_PII_RETENTION_DAYS",
  "PAYG_CANCELLATION_TOKEN_KEY_ID",
  "PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID",
  "PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL",
  "PAYG_DUPLICATE_LOCK_KEY_ID",
  "PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID",
  "PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL",
  "PAYG_FROM_EMAIL",
  "PAYG_REPLY_TO_EMAIL",
  ...REQUIRED_PAYG_DOCUMENTS.flatMap(([, prefix]) => [
    prefix + "_VERSION",
    prefix + "_PUBLIC_URL",
    prefix + "_SHA256",
  ]),
]);
const PAYG_DOTENV_JOURNAL_VERSION = 1;
const NO_FOLLOW = fs.constants.O_NOFOLLOW || 0;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireApprovedDocument(productDirectory, key, document) {
  if (!document || document.approvedForPublication !== true ||
    document.runtimeEligible !== true ||
    typeof document.filename !== "string" ||
    path.basename(document.filename) !== document.filename ||
    document.version.includes("DRAFT") ||
    !/^[a-f0-9]{64}$/.test(document.sha256 || "") ||
    !Number.isSafeInteger(document.bytes) || document.bytes <= 0 ||
    document.publicUrl !== `/legal/products/${document.filename}`) {
    throw new Error(`${key} is not an approved immutable PAYG document.`);
  }
  const sourcePath = path.join(productDirectory, document.filename);
  const source = fs.readFileSync(sourcePath);
  if (source.length !== document.bytes || sha256(source) !== document.sha256) {
    throw new Error(`${key} no longer matches its approved bytes.`);
  }
  return Object.freeze({
    version: document.version,
    publicUrl: document.publicUrl,
    sha256: document.sha256,
  });
}

function loadApprovedPaygRelease(repositoryRoot) {
  const productDirectory = path.join(repositoryRoot, "public/legal/products");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(productDirectory, "manifest.json"),
    "utf8"
  ));
  const decisions = manifest.ownerDecisions || {};
  if (decisions.paygTermsApproved !== true ||
    decisions.paygWaiverApproved !== true ||
    decisions.paygPrivacyNoticeApproved !== true ||
    decisions.paygRedactionImplementationAccepted !== true ||
    decisions.paygOrderPiiRetentionDays !== 90 ||
    decisions.paygWaiverPiiRetentionDays !== 2190 ||
    decisions.paygRetentionPolicyVersion !==
      "ZAF-PAYG-PII-RETENTION-2026-08-31-01") {
    throw new Error("The approved PAYG release is incomplete or stale.");
  }
  const documents = {};
  for (const [key] of REQUIRED_PAYG_DOCUMENTS) {
    documents[key] = requireApprovedDocument(
      productDirectory,
      key,
      manifest.documents?.[key]
    );
  }
  return Object.freeze({
    documents: Object.freeze(documents),
    retention: Object.freeze({
      policyVersion: decisions.paygRetentionPolicyVersion,
      orderDays: decisions.paygOrderPiiRetentionDays,
      waiverDays: decisions.paygWaiverPiiRetentionDays,
    }),
  });
}

function localSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function buildLocalPaygEnvironment(release, secret = localSecret) {
  const environment = {
    PAYG_AVAILABILITY_ENABLED: "true",
    PAYG_LEGAL_APPROVED: "true",
    PAYG_PII_REDACTION_IMPLEMENTED: "true",
    PAYG_PII_RETENTION_APPROVED: "true",
    PAYG_PII_RETENTION_POLICY_VERSION: release.retention.policyVersion,
    PAYG_ORDER_PII_RETENTION_DAYS: String(release.retention.orderDays),
    PAYG_WAIVER_PII_RETENTION_DAYS: String(release.retention.waiverDays),
    PAYG_CANCELLATION_TOKEN_KEY_ID: "cancel-local-browser-v1",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID: "",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL: "",
    PAYG_CANCELLATION_TOKEN_SECRET: secret(),
    PAYG_CHECKOUT_RATE_LIMIT_SECRET: secret(),
    PAYG_DUPLICATE_LOCK_KEY_ID: "lock-local-browser-v1",
    PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID: "",
    PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL: "",
    PAYG_DUPLICATE_LOCK_SECRET: secret(),
    PAYG_FROM_EMAIL: "Zero Alpha Fitness Local Test <payg-local@example.invalid>",
    PAYG_REPLY_TO_EMAIL: "payg-local@example.invalid",
  };
  for (const [key, prefix] of REQUIRED_PAYG_DOCUMENTS) {
    const document = release.documents[key];
    environment[`${prefix}_VERSION`] = document.version;
    environment[`${prefix}_PUBLIC_URL`] = document.publicUrl;
    environment[`${prefix}_SHA256`] = document.sha256;
  }
  return Object.freeze(environment);
}

function renderLocalPaygDotenv(original, environment) {
  const overrides = new Map();
  for (const [name, value] of Object.entries(environment)) {
    if (!PAYG_DOTENV_OVERLAY_NAMES.has(name)) continue;
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new Error("The local PAYG value for " + name + " is not dotenv-safe.");
    }
    overrides.set(name, value);
  }
  const seen = new Set();
  const lines = original.split(/\r?\n/).map((line) => {
    const name = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!name || !overrides.has(name)) return line;
    seen.add(name);
    return `${name}=${overrides.get(name)}`;
  });
  const missing = [...overrides].filter(([name]) => !seen.has(name));
  if (missing.length) {
    while (lines.at(-1) === "") lines.pop();
    lines.push(
      "",
      "# Temporary local PAYG browser-journey parameters; restored on shutdown.",
      ...missing.map(([name, value]) => `${name}=${value}`),
      ""
    );
  }
  return lines.join("\n");
}

function dotenvOverlayPaths(dotenvPath) {
  const absolutePath = path.resolve(dotenvPath);
  return Object.freeze({
    dotenvPath: absolutePath,
    journalPath: absolutePath + ".payg-browser-recovery.json",
    lockPath: absolutePath + ".payg-browser.lock",
  });
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readRegularFile(filePath, label) {
  const pathStat = lstatIfPresent(filePath);
  if (!pathStat) throw new Error(label + " is missing.");
  if (pathStat.isSymbolicLink()) {
    throw new Error(label + " must be a regular file, not a symbolic link.");
  }
  if (!pathStat.isFile()) throw new Error(label + " must be a regular file.");
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | NO_FOLLOW
  );
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile() || descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino) {
      throw new Error(label + " changed while it was being opened.");
    }
    return Object.freeze({
      contents: fs.readFileSync(descriptor),
      mode: descriptorStat.mode & 0o777,
      dev: descriptorStat.dev,
      ino: descriptorStat.ino,
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function sameFileState(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.contents.equals(right.contents);
}

function durableTemporaryFile(targetPath, contents, mode) {
  const temporaryPath = targetPath + "." + process.pid + "-" +
    crypto.randomBytes(12).toString("hex") + ".tmp";
  const descriptor = fs.openSync(
    temporaryPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | NO_FOLLOW,
    0o600
  );
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fchmodSync(descriptor, mode & 0o777);
    fs.fsyncSync(descriptor);
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } finally {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original I/O error.
      }
    }
    throw error;
  }
  fs.closeSync(descriptor);
  return temporaryPath;
}

function casMismatch(label, retainedPath = null) {
  const suffix = retainedPath ?
    " The displaced file was retained at " + retainedPath + "." : "";
  const error = new Error(
    label + " changed during the PAYG conditional file operation; " +
    "refusing to overwrite it." + suffix
  );
  error.code = "PAYG_CAS_MISMATCH";
  return error;
}

function beginConditionalFileTransaction(
  filePath,
  expectedState,
  operation,
  replacementContents = null,
  replacementMode = null
) {
  const parentDirectory = path.dirname(filePath);
  const transactionDirectory = fs.mkdtempSync(path.join(
    parentDirectory,
    "." + path.basename(filePath) + ".payg-cas-"
  ));
  fs.chmodSync(transactionDirectory, 0o700);
  const capturedPath = path.join(transactionDirectory, "captured");
  const recordPath = path.join(transactionDirectory, "record.json");
  const replacementPath = path.join(transactionDirectory, "replacement");
  const record = Buffer.from(JSON.stringify({
    version: 1,
    targetPath: path.resolve(filePath),
    operation,
    expectedSha256: sha256(expectedState.contents),
    expectedMode: expectedState.mode,
  }) + "\n", "utf8");
  try {
    writeNewDurableFile(recordPath, record, 0o600);
    if (operation === "replace") {
      writeNewDurableFile(
        replacementPath,
        replacementContents,
        replacementMode
      );
    }
    fsyncDirectory(parentDirectory);
    // Move first, validate second. rename() atomically captures whichever path
    // entry actually won the race, rather than overwriting it after a stale
    // read. The replacement is later linked with no-overwrite semantics.
    fs.renameSync(filePath, capturedPath);
    fsyncDirectory(transactionDirectory);
    fsyncDirectory(parentDirectory);
  } catch (error) {
    try {
      fs.rmSync(transactionDirectory, {recursive: true, force: false});
      fsyncDirectory(parentDirectory);
    } catch {
      // Preserve the capture error.
    }
    throw error;
  }
  return Object.freeze({
    parentDirectory,
    transactionDirectory,
    capturedPath,
    recordPath,
    replacementPath,
  });
}

function finishConditionalFileTransaction(transaction) {
  fs.rmSync(transaction.transactionDirectory, {recursive: true, force: false});
  fsyncDirectory(transaction.parentDirectory);
}

function discardCapturedFile(transaction) {
  fs.unlinkSync(transaction.capturedPath);
  fsyncDirectory(transaction.transactionDirectory);
  finishConditionalFileTransaction(transaction);
}

function restoreCapturedFileNoReplace(transaction, filePath, label) {
  try {
    fs.linkSync(transaction.capturedPath, filePath);
    fsyncDirectory(transaction.parentDirectory);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw casMismatch(label, transaction.capturedPath);
    }
    throw error;
  }
  discardCapturedFile(transaction);
}

function validConditionalTransactionRecord(value, filePath) {
  return value?.version === 1 && value.targetPath === path.resolve(filePath) &&
    (value.operation === "replace" || value.operation === "remove") &&
    /^[a-f0-9]{64}$/.test(value.expectedSha256 || "") &&
    Number.isInteger(value.expectedMode) && value.expectedMode >= 0 &&
    value.expectedMode <= 0o777;
}

function recoverConditionalFileTransactions(filePath, label) {
  const parentDirectory = path.dirname(filePath);
  const prefix = "." + path.basename(filePath) + ".payg-cas-";
  const entries = fs.readdirSync(parentDirectory, {withFileTypes: true})
    .filter((entry) => entry.name.startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const transactionDirectory = path.join(parentDirectory, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(
        label + " has an invalid conditional transaction path: " +
        transactionDirectory
      );
    }
    const transaction = Object.freeze({
      parentDirectory,
      transactionDirectory,
      capturedPath: path.join(transactionDirectory, "captured"),
      recordPath: path.join(transactionDirectory, "record.json"),
      replacementPath: path.join(transactionDirectory, "replacement"),
    });
    const capturedPresent = lstatIfPresent(transaction.capturedPath) !== null;
    const targetPresent = lstatIfPresent(filePath) !== null;
    const recordPresent = lstatIfPresent(transaction.recordPath) !== null;
    let record = null;
    if (recordPresent) {
      record = parseJsonFile(
        transaction.recordPath,
        label + " conditional transaction record"
      ).value;
      if (!validConditionalTransactionRecord(record, filePath)) {
        throw new Error(
          label + " has an invalid conditional transaction record at " +
          transaction.recordPath
        );
      }
    }
    if (capturedPresent && !targetPresent) {
      // Roll back the interrupted operation. Linking with no-replace semantics
      // makes this safe if another recovery or editor recreates the name.
      restoreCapturedFileNoReplace(transaction, filePath, label);
      continue;
    }
    if (capturedPresent) {
      if (!record) throw casMismatch(label, transaction.capturedPath);
      const captured = readRegularFile(transaction.capturedPath, label);
      if (sha256(captured.contents) !== record.expectedSha256 ||
        captured.mode !== record.expectedMode) {
        throw casMismatch(label, transaction.capturedPath);
      }
      // The canonical name now belongs to the completed replacement or to a
      // concurrent editor. In either case only the exact captured old state is
      // safe to discard.
      discardCapturedFile(transaction);
      continue;
    }
    if (!targetPresent && record?.operation !== "remove") {
      throw new Error(
        label + " has an incomplete conditional replacement at " +
        transactionDirectory
      );
    }
    // No captured state remains: the move never began, or the removal reached
    // its durable end before the prior process stopped.
    finishConditionalFileTransaction(transaction);
  }
}

function replaceRegularFileCas(
  filePath,
  expectedState,
  replacementContents,
  replacementMode,
  label
) {
  recoverConditionalFileTransactions(filePath, label);
  const before = readRegularFile(filePath, label);
  if (!sameFileState(before, expectedState)) {
    throw casMismatch(label);
  }
  const transaction = beginConditionalFileTransaction(
    filePath,
    expectedState,
    "replace",
    replacementContents,
    replacementMode
  );
  let capturedState;
  try {
    capturedState = readRegularFile(transaction.capturedPath, label);
  } catch (error) {
    restoreCapturedFileNoReplace(transaction, filePath, label);
    throw error;
  }
  if (!sameFileState(capturedState, expectedState)) {
    restoreCapturedFileNoReplace(transaction, filePath, label);
    throw casMismatch(label);
  }
  try {
    fs.linkSync(transaction.replacementPath, filePath);
    fsyncDirectory(transaction.parentDirectory);
  } catch (error) {
    if (error.code === "EEXIST") {
      // A concurrent editor won the vacant-name race. Preserve its file and
      // discard only the exact state that this operation had captured.
      discardCapturedFile(transaction);
      throw casMismatch(label);
    }
    restoreCapturedFileNoReplace(transaction, filePath, label);
    throw error;
  }
  discardCapturedFile(transaction);
}

function removeRegularFileCas(filePath, expectedState, label) {
  recoverConditionalFileTransactions(filePath, label);
  const before = readRegularFile(filePath, label);
  if (!sameFileState(before, expectedState)) throw casMismatch(label);
  const transaction = beginConditionalFileTransaction(
    filePath,
    expectedState,
    "remove"
  );
  let capturedState;
  try {
    capturedState = readRegularFile(transaction.capturedPath, label);
  } catch (error) {
    restoreCapturedFileNoReplace(transaction, filePath, label);
    throw error;
  }
  if (!sameFileState(capturedState, expectedState)) {
    restoreCapturedFileNoReplace(transaction, filePath, label);
    throw casMismatch(label);
  }
  discardCapturedFile(transaction);
}

function writeNewDurableFile(filePath, contents, mode) {
  const temporaryPath = durableTemporaryFile(filePath, contents, mode);
  try {
    fs.linkSync(temporaryPath, filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
      fsyncDirectory(path.dirname(filePath));
    } catch {
      // Preserve the link/durability error.
    }
    throw error;
  }
  fs.unlinkSync(temporaryPath);
  fsyncDirectory(path.dirname(filePath));
}

function parseJsonFile(filePath, label) {
  const state = readRegularFile(filePath, label);
  let value;
  try {
    value = JSON.parse(state.contents.toString("utf8"));
  } catch {
    throw new Error(label + " is invalid; refusing unsafe automatic recovery.");
  }
  return {state, value};
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function validLockRecord(value) {
  return value?.version === PAYG_DOTENV_JOURNAL_VERSION &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.token === "string" && /^[a-f0-9]{32}$/.test(value.token);
}

function acquireDotenvLock(lockPath) {
  const record = Object.freeze({
    version: PAYG_DOTENV_JOURNAL_VERSION,
    pid: process.pid,
    token: crypto.randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
  });
  const encoded = Buffer.from(JSON.stringify(record) + "\n", "utf8");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    recoverConditionalFileTransactions(lockPath, "PAYG dotenv lock");
    try {
      writeNewDurableFile(lockPath, encoded, 0o600);
      return record;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const {state, value} = parseJsonFile(lockPath, "PAYG dotenv lock");
    if (!validLockRecord(value)) {
      throw new Error("The PAYG dotenv lock is invalid; refusing to remove it.");
    }
    if (processIsAlive(value.pid) !== false) {
      throw new Error(
        "Another PAYG browser journey owns the dotenv overlay (pid " +
        value.pid + ")."
      );
    }
    try {
      removeRegularFileCas(lockPath, state, "PAYG dotenv lock");
    } catch (error) {
      if (error.code === "PAYG_CAS_MISMATCH" &&
        !error.message.includes("retained at")) continue;
      throw error;
    }
  }
  throw new Error("Could not acquire the PAYG dotenv overlay lock safely.");
}

function releaseDotenvLock(lockPath, owner) {
  recoverConditionalFileTransactions(lockPath, "PAYG dotenv lock");
  const {state, value} = parseJsonFile(lockPath, "PAYG dotenv lock");
  if (!validLockRecord(value) || value.pid !== owner.pid ||
    value.token !== owner.token) {
    throw new Error("The PAYG dotenv lock changed ownership; refusing to remove it.");
  }
  removeRegularFileCas(lockPath, state, "PAYG dotenv lock");
}

function decodeRecoveryJournal(value, dotenvPath) {
  if (value?.version !== PAYG_DOTENV_JOURNAL_VERSION ||
    value.dotenvPath !== dotenvPath ||
    !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777 ||
    typeof value.originalBase64 !== "string" ||
    typeof value.overlayBase64 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.originalSha256 || "") ||
    !/^[a-f0-9]{64}$/.test(value.overlaySha256 || "")) {
    throw new Error(
      "The PAYG dotenv recovery journal is invalid; refusing automatic recovery."
    );
  }
  const original = Buffer.from(value.originalBase64, "base64");
  const overlay = Buffer.from(value.overlayBase64, "base64");
  if (sha256(original) !== value.originalSha256 ||
    sha256(overlay) !== value.overlaySha256) {
    throw new Error("The PAYG dotenv recovery journal checksum is invalid.");
  }
  return Object.freeze({original, overlay, mode: value.mode});
}

function recoverLocalPaygDotenv(dotenvPath, journalPath) {
  recoverConditionalFileTransactions(
    journalPath,
    "PAYG dotenv recovery journal"
  );
  const journalStat = lstatIfPresent(journalPath);
  if (!journalStat) return false;
  if (journalStat.isSymbolicLink()) {
    throw new Error(
      "The PAYG dotenv recovery journal must not be a symbolic link."
    );
  }
  const {state: journalState, value} = parseJsonFile(
    journalPath,
    "PAYG dotenv recovery journal"
  );
  const journal = decodeRecoveryJournal(value, dotenvPath);
  const current = readRegularFile(dotenvPath, "functions/.env.local");
  if (current.contents.equals(journal.original)) {
    removeRegularFileCas(
      journalPath,
      journalState,
      "PAYG dotenv recovery journal"
    );
    return true;
  }
  if (!current.contents.equals(journal.overlay)) {
    throw new Error(
      "functions/.env.local changed after the PAYG overlay was installed; " +
      "the recovery journal was retained and no bytes were overwritten."
    );
  }
  replaceRegularFileCas(
    dotenvPath,
    current,
    journal.original,
    journal.mode,
    "functions/.env.local"
  );
  removeRegularFileCas(
    journalPath,
    journalState,
    "PAYG dotenv recovery journal"
  );
  return true;
}

function recoverLocalPaygDotenvOverlay(dotenvPath) {
  const paths = dotenvOverlayPaths(dotenvPath);
  const lockOwner = acquireDotenvLock(paths.lockPath);
  try {
    recoverConditionalFileTransactions(
      paths.dotenvPath,
      "functions/.env.local"
    );
    readRegularFile(paths.dotenvPath, "functions/.env.local");
    const recovered = recoverLocalPaygDotenv(
      paths.dotenvPath,
      paths.journalPath
    );
    releaseDotenvLock(paths.lockPath, lockOwner);
    return recovered;
  } catch (error) {
    try {
      releaseDotenvLock(paths.lockPath, lockOwner);
    } catch {
      // Preserve the recovery error. A stale owner lock remains recoverable.
    }
    throw error;
  }
}

function installLocalPaygDotenvOverlay(dotenvPath, environment) {
  const paths = dotenvOverlayPaths(dotenvPath);
  const lockOwner = acquireDotenvLock(paths.lockPath);
  try {
    recoverConditionalFileTransactions(
      paths.dotenvPath,
      "functions/.env.local"
    );
    // Reject a symlink before changing it as well as during every CAS read.
    readRegularFile(paths.dotenvPath, "functions/.env.local");
    recoverLocalPaygDotenv(paths.dotenvPath, paths.journalPath);
    const originalState = readRegularFile(
      paths.dotenvPath,
      "functions/.env.local"
    );
    const overlay = Buffer.from(renderLocalPaygDotenv(
      originalState.contents.toString("utf8"),
      environment
    ), "utf8");
    const journal = Buffer.from(JSON.stringify({
      version: PAYG_DOTENV_JOURNAL_VERSION,
      dotenvPath: paths.dotenvPath,
      mode: originalState.mode,
      originalBase64: originalState.contents.toString("base64"),
      overlayBase64: overlay.toString("base64"),
      originalSha256: sha256(originalState.contents),
      overlaySha256: sha256(overlay),
      ownerToken: lockOwner.token,
      createdAt: new Date().toISOString(),
    }) + "\n", "utf8");
    writeNewDurableFile(paths.journalPath, journal, 0o600);
    replaceRegularFileCas(
      paths.dotenvPath,
      originalState,
      overlay,
      originalState.mode,
      "functions/.env.local"
    );

    let restored = false;
    let lockReleased = false;
    return () => {
      if (!restored) {
        const recovered = recoverLocalPaygDotenv(
          paths.dotenvPath,
          paths.journalPath
        );
        if (!recovered) {
          const current = readRegularFile(
            paths.dotenvPath,
            "functions/.env.local"
          );
          if (!current.contents.equals(originalState.contents)) {
            throw new Error(
              "The PAYG recovery journal disappeared before " +
              "functions/.env.local was restored."
            );
          }
        }
        // Set this only after both the durable restore and journal removal.
        restored = true;
      }
      if (!lockReleased) {
        releaseDotenvLock(paths.lockPath, lockOwner);
        lockReleased = true;
      }
    };
  } catch (error) {
    try {
      recoverLocalPaygDotenv(paths.dotenvPath, paths.journalPath);
    } catch {
      // A retained journal is intentionally fail-closed for the next runner.
    }
    try {
      releaseDotenvLock(paths.lockPath, lockOwner);
    } catch {
      // A stale owner lock is safe for the next run to reclaim.
    }
    throw error;
  }
}

function buildLocalPaygClassDocument(nowMillis = Date.now()) {
  if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0) {
    throw new Error("The local PAYG class seed time is invalid.");
  }
  const startMillis = nowMillis + 48 * 60 * 60 * 1000;
  const endMillis = startMillis + 60 * 60 * 1000;
  return Object.freeze({
    classId: PAYG_CLASS_ID,
    startTime: new Date(startMillis).toISOString(),
    endTime: new Date(endMillis).toISOString(),
    body: Object.freeze({
      fields: Object.freeze({
        title: {stringValue: "PAYG Browser Test · Stripe Sandbox"},
        startTime: {timestampValue: new Date(startMillis).toISOString()},
        endTime: {timestampValue: new Date(endMillis).toISOString()},
        timezone: {stringValue: "Europe/London"},
        location: {stringValue: "Zero Alpha Fitness · Local emulator"},
        coachName: {stringValue: "Local test coach"},
        status: {stringValue: "scheduled"},
        paygEligible: {booleanValue: true},
        capacity: {integerValue: "12"},
        bookedCount: {integerValue: "0"},
        paygUnpaidHoldCount: {integerValue: "0"},
      }),
    }),
  });
}

module.exports = {
  PAYG_CLASS_ID,
  PAYG_SCOPE,
  buildLocalPaygClassDocument,
  buildLocalPaygEnvironment,
  dotenvOverlayPaths,
  installLocalPaygDotenvOverlay,
  loadApprovedPaygRelease,
  recoverLocalPaygDotenvOverlay,
  renderLocalPaygDotenv,
};
