/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Starts the isolated Stripe sandbox journey. It reads the existing Stripe
 * CLI profile and ephemeral listener output, but creates no secret files.
 */

const {spawn} = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");
const {
  resolveStripeTestCatalogueScope,
} = require("./stripeTestCatalogueScope");
const {
  PAYG_SCOPE,
  buildLocalPaygClassDocument,
  buildLocalPaygEnvironment,
  installLocalPaygDotenvOverlay,
  loadApprovedPaygRelease,
  recoverLocalPaygDotenvOverlay,
} = require("./localStripePaygJourney");

const PROJECT_ID = "demo-alphawod-stripe";
const APP_PORT = 3002;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const APP_ID = "1:000000000000:web:localstripetest000000";
const FUNCTIONS_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(FUNCTIONS_DIR, "..");
const WEBHOOK_EVENT_MANIFEST = require(path.join(
  REPO_ROOT,
  "ops/stripe/billing-webhook-events.json"
));

function firebaseCliMetadata(command) {
  try {
    const executable = fs.realpathSync(command);
    const packageRoot = path.resolve(path.dirname(executable), "../..");
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
    );
    const runtimeDefinitions = fs.readFileSync(
      path.join(
        packageRoot,
        "lib/deploy/functions/runtimes/supported/types.js"
      ),
      "utf8"
    );
    return {
      command,
      version: String(packageJson.version || "0.0.0"),
      supportsNode24: runtimeDefinitions.includes("nodejs24"),
    };
  } catch {
    return null;
  }
}

function compareVersionsDescending(left, right) {
  const parts = (value) => value.split(".").map((part) => Number(part) || 0);
  const leftParts = parts(left.version);
  const rightParts = parts(right.version);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return rightParts[index] - leftParts[index];
    }
  }
  return 0;
}

function resolveFirebaseCommand() {
  const binaryName = process.platform === "win32" ? "firebase.cmd" : "firebase";
  const candidates = new Set(
    String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, binaryName))
  );
  const nvmVersions = path.join(String(process.env.HOME || ""), ".nvm/versions/node");
  if (fs.existsSync(nvmVersions)) {
    for (const version of fs.readdirSync(nvmVersions)) {
      candidates.add(path.join(nvmVersions, version, "bin", binaryName));
    }
  }
  const compatible = [...candidates]
    .filter((candidate) => fs.existsSync(candidate))
    .map(firebaseCliMetadata)
    .filter((candidate) => candidate?.supportsNode24)
    .sort(compareVersionsDescending);
  if (!compatible.length) {
    throw new Error(
      "The local Stripe journey requires a Firebase CLI that supports the repository's Node 24 Functions runtime."
    );
  }
  return compatible[0].command;
}

const FIREBASE_CONFIG_PATH = path.join(REPO_ROOT, "firebase.json");
const PROCESS_SUPERVISOR_PATH = path.join(
  __dirname,
  "localStripeProcessSupervisor.js"
);
const WEBHOOK_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/stripeWebhook`;
const CALLABLE_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/createMembershipCheckoutSession`;
const REQUIRED_PORTS = new Map([
  [APP_PORT, "React app"],
  [4000, "Firebase Emulator UI"],
  [4400, "Firebase Emulator Hub"],
  [4500, "Firebase emulator logging"],
  [5001, "Functions emulator"],
  [8080, "Firestore emulator"],
  [9099, "Auth emulator"],
  [9150, "Firebase Emulator UI websocket"],
]);
const STRIPE_EVENTS = WEBHOOK_EVENT_MANIFEST.requiredEvents.join(",");
// firebase-tools must see the declared secret as present, while the delivery
// implementation must fail its trim() guard before constructing a request.
const LOCAL_DISABLED_RESEND_API_KEY = " ";
const SECRET_NAME_PATTERN = /(?:^|_)(?:SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIALS?)(?:_|$)/;
const NON_SECRET_METADATA_NAME_PATTERN = /(?:_KEY_ID|_VALID_UNTIL)$/;
const SAFE_PARENT_ENVIRONMENT = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CONFIG_HOME",
];

const children = new Set();
const processGroups = new Map();
const timers = new Set();
let stopping = false;
let shutdownPromise;
let restoreLocalPaygDotenv = () => {};
let privateRuntimeDirectory = null;
let exitCleanupHandled = false;

function safeEnvironment(additions = {}) {
  const environment = {};
  for (const name of SAFE_PARENT_ENVIRONMENT) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {...environment, ...additions};
}

const PRIVATE_RUNTIME_PREFIX = "alphawod-local-stripe-";

function createPrivateRuntimeDirectory(parentDirectory = os.tmpdir()) {
  const directory = fs.mkdtempSync(path.join(
    path.resolve(parentDirectory),
    PRIVATE_RUNTIME_PREFIX
  ));
  fs.chmodSync(directory, 0o700);
  return directory;
}

function cleanupPrivateRuntimeDirectory(directory) {
  if (!directory) return;
  const resolved = path.resolve(directory);
  if (!path.basename(resolved).startsWith(PRIVATE_RUNTIME_PREFIX)) {
    throw new Error("Refusing to clean an unrecognised local Stripe runtime path.");
  }
  fs.rmSync(resolved, {recursive: true, force: true});
}

function assertSupportedProcessPlatform(platform = process.platform) {
  if (platform === "win32") {
    throw new Error(
      "The local Stripe browser harness requires POSIX process groups " +
      "(macOS or Linux) for complete descendant teardown."
    );
  }
}

function privateChildEnvironment(runtimeDirectory, additions = {}) {
  return safeEnvironment({
    TMPDIR: runtimeDirectory,
    npm_config_cache: path.join(runtimeDirectory, "npm-cache"),
    ...additions,
  });
}

function firebaseEmulatorLaunch(firebaseCommand, runtimeDirectory, environment) {
  return Object.freeze({
    command: firebaseCommand,
    args: Object.freeze([
      "emulators:start",
      "--config", FIREBASE_CONFIG_PATH,
      "--project", PROJECT_ID,
      "--only", "auth,firestore,functions",
    ]),
    options: Object.freeze({
      cwd: runtimeDirectory,
      env: environment,
    }),
  });
}

function lineRelay(label, stream, target, inspect = () => {}) {
  let buffered = "";
  const emitCompleteLines = () => {
    while (true) {
      const delimiter = buffered.match(/\r\n|\n|\r/);
      if (!delimiter || delimiter.index === undefined) return;
      const line = buffered.slice(0, delimiter.index);
      buffered = buffered.slice(delimiter.index + delimiter[0].length);
      target.write(`[${label}] ${redactProviderSecrets(line)}\n`);
    }
  };
  stream.on("data", (chunk) => {
    buffered += String(chunk);
    inspect(buffered);
    emitCompleteLines();
  });
  stream.on("end", () => {
    inspect(buffered);
    if (buffered) target.write(`[${label}] ${redactProviderSecrets(buffered)}\n`);
    buffered = "";
  });
}

function clearTimer(timer) {
  clearTimeout(timer);
  timers.delete(timer);
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      resolve();
    }, milliseconds);
    timers.add(timer);
  });
}

function processGroupExists(
  group,
  killProcess = process.kill,
  platform = process.platform
) {
  if (!group?.pid) return false;
  if (platform === "win32") return processLeaderRunning(group.child);
  try {
    killProcess(-group.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function trackProcessGroup(
  child,
  label,
  registry = processGroups,
  groupExists = processGroupExists
) {
  if (!child?.pid) return null;
  const group = Object.freeze({pid: child.pid, child, label});
  registry.set(group.pid, group);
  child.once("close", () => {
    if (!groupExists(group)) registry.delete(group.pid);
  });
  return group;
}

function signalProcessGroup(
  group,
  signal,
  killProcess = process.kill,
  platform = process.platform
) {
  if (!group?.pid) return false;
  try {
    if (platform === "win32") {
      if (!running(group.child)) return false;
      group.child.kill(signal);
    } else {
      // Address the process group even if its original leader has exited.
      killProcess(-group.pid, signal);
    }
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    console.error(
      "Could not signal " + group.label + ": " + error.message
    );
    return false;
  }
}

async function waitForProcessGroupsOrTimeout(groups, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline &&
    groups.some((group) => processGroupExists(group))) {
    await delay(50);
  }
}

function spawnChild(label, command, args, options = {}) {
  const supervisorEnvironment = {
    ...(options.env || safeEnvironment()),
    ...(options.preventDetachedDescendants ? {
      LOCAL_STRIPE_ATTACH_TARGET_DESCENDANTS: "true",
    } : {}),
  };
  const child = spawn(process.execPath, [
    PROCESS_SUPERVISOR_PATH,
    command,
    ...args,
  ], {
    cwd: options.cwd || REPO_ROOT,
    env: supervisorEnvironment,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: process.platform !== "win32",
  });
  child.localJourneyLabel = label;
  child.supervisedTargetExited = false;
  child.supervisedTargetExitCode = null;
  child.supervisedTargetSignal = null;
  children.add(child);
  trackProcessGroup(child, label);
  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "target-error") {
      child.supervisedTargetExited = true;
      child.emit(
        "target-error",
        new Error(String(message.message || "unknown spawn error"))
      );
      return;
    }
    if (message.type === "target-exit") {
      child.supervisedTargetExited = true;
      child.supervisedTargetExitCode = message.code;
      child.supervisedTargetSignal = message.signal;
      child.emit("target-exit", message.code, message.signal);
    }
  });
  child.once("close", (code, signal) => {
    children.delete(child);
    if (!child.supervisedTargetExited) {
      child.supervisedTargetExited = true;
      child.emit(
        "target-error",
        new Error(
          `${label} supervisor exited before reporting the command result (` +
          `${signal || `code ${code}`}).`
        )
      );
    }
  });
  child.once("error", (error) => {
    if (!stopping) fail(`${label} could not start: ${error.message}`);
  });
  return child;
}

function monitorChild(child, label) {
  child.once("target-error", (error) => {
    if (!stopping) fail(`${label} could not start: ${error.message}`);
  });
  child.once("target-exit", (code, signal) => {
    if (!stopping) {
      fail(`${label} exited unexpectedly (${signal || `code ${code}`}).`);
    }
  });
  child.once("close", (code, signal) => {
    if (!stopping) {
      fail(`${label} supervisor exited unexpectedly (${signal || `code ${code}`}).`);
    }
  });
}

function processLeaderRunning(child) {
  return child?.pid && child.exitCode === null && child.signalCode === null;
}

function running(child) {
  return processLeaderRunning(child) && !child.supervisedTargetExited;
}

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    let finalCode = code;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const active = [...processGroups.values()]
      .filter((group) => processGroupExists(group));
    active.forEach((group) => signalProcessGroup(group, "SIGTERM"));
    await waitForProcessGroupsOrTimeout(active, 4000);
    const stubborn = [...processGroups.values()]
      .filter((group) => processGroupExists(group));
    stubborn.forEach((group) => signalProcessGroup(group, "SIGKILL"));
    await waitForProcessGroupsOrTimeout(stubborn, 1500);
    try {
      restoreLocalPaygDotenv();
      restoreLocalPaygDotenv = () => {};
    } catch (error) {
      finalCode = 1;
      console.error(
        "Could not safely restore functions/.env.local: " +
        redactProviderSecrets(error.message)
      );
    }
    try {
      cleanupPrivateRuntimeDirectory(privateRuntimeDirectory);
      privateRuntimeDirectory = null;
    } catch (error) {
      finalCode = 1;
      console.error(
        "Could not clean the private local Stripe runtime: " +
        redactProviderSecrets(error.message)
      );
    }
    exitCleanupHandled = true;
    process.exit(finalCode);
  })();
  return shutdownPromise;
}

function fail(message) {
  if (stopping) return;
  console.error(`Local Stripe journey stopped: ${redactProviderSecrets(message)}`);
  void shutdown(1);
}

function assertNoDiskSecrets() {
  const secretFiles = fs.readdirSync(FUNCTIONS_DIR, {withFileTypes: true})
    .filter((entry) => entry.name === ".secret.local" ||
      (entry.name.startsWith(".secret.") && !entry.name.endsWith(".example")))
    .map((entry) => entry.name);
  if (secretFiles.length) {
    throw new Error(
      `Remove local secret file(s) before running: ${secretFiles.join(", ")}. ` +
      "The journey supplies ephemeral test credentials in memory."
    );
  }

  const dotenvFiles = fs.readdirSync(FUNCTIONS_DIR, {withFileTypes: true})
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) &&
      (entry.name === ".env" || entry.name.startsWith(".env.")) &&
      !entry.name.endsWith(".example"));
  for (const entry of dotenvFiles) {
    const contents = fs.readFileSync(path.join(FUNCTIONS_DIR, entry.name), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const name = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
      if (name && SECRET_NAME_PATTERN.test(name) &&
        !NON_SECRET_METADATA_NAME_PATTERN.test(name)) {
        throw new Error(
          `${entry.name} must not define ${name}; provider secrets are memory-only. ` +
          "Remove that assignment before running."
        );
      }
    }
  }
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({host: "0.0.0.0", port, exclusive: true}, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

async function assertPortsAvailable() {
  for (const [port, label] of REQUIRED_PORTS) {
    try {
      await checkPort(port);
    } catch (error) {
      if (error.code === "EADDRINUSE") {
        throw new Error(`${label} requires fixed port ${port}, but it is already in use.`);
      }
      throw error;
    }
  }
}

async function assertAppPortAvailable() {
  try {
    await checkPort(APP_PORT);
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new Error(`React app requires fixed port ${APP_PORT}, but it is already in use.`);
    }
    throw error;
  }
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 100000) body += chunk;
      });
      response.on("end", () => resolve({status: response.statusCode || 0, body}));
    });
    request.setTimeout(1500, () => request.destroy(new Error("request timed out")));
    request.once("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function waitUntil(description, child, check, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    if (!running(child)) {
      throw new Error(`${child.localJourneyLabel} exited while waiting for ${description}.`);
    }
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  const detail = lastError?.message ? ` Last check: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

function runPreflight(runtimeEnvironment, runtimeDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(
      "Stripe catalogue preflight",
      process.execPath,
      [
        "--env-file=" + path.join(FUNCTIONS_DIR, ".env.local"),
        path.join(FUNCTIONS_DIR, "scripts/verifyStripeTestConfig.js"),
      ],
      {cwd: runtimeDirectory, env: runtimeEnvironment}
    );
    lineRelay("preflight", child.stdout, process.stdout);
    lineRelay("preflight", child.stderr, process.stderr);
    child.once("error", reject);
    child.once("target-error", reject);
    child.once("target-exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `Stripe catalogue preflight exited with ${signal || `code ${code}`}.`
      ));
    });
  });
}

function startStripeListener(stripeKey, runtimeDirectory) {
  return new Promise((resolve, reject) => {
    const listener = spawnChild(
      "Stripe listener",
      "stripe",
      [
        "listen",
        "--color=off",
        "--events", STRIPE_EVENTS,
        "--forward-to", WEBHOOK_URL,
      ],
      {
        cwd: runtimeDirectory,
        env: privateChildEnvironment(runtimeDirectory, {
          STRIPE_API_KEY: stripeKey,
        }),
      }
    );
    monitorChild(listener, "Stripe listener");
    let settled = false;
    let timeout;
    const inspect = (buffered) => {
      const captured = buffered.match(/whsec_[A-Za-z0-9_-]+/)?.[0];
      if (!captured || settled) return;
      settled = true;
      clearTimer(timeout);
      resolve({listener, webhookSecret: captured});
    };
    lineRelay("stripe", listener.stdout, process.stdout, inspect);
    lineRelay("stripe", listener.stderr, process.stderr, inspect);
    listener.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimer(timeout);
        reject(error);
      }
    });
    listener.once("target-error", (error) => {
      if (!settled) {
        settled = true;
        clearTimer(timeout);
        reject(error);
      }
    });
    listener.once("target-exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimer(timeout);
        reject(new Error(`Stripe listener exited with ${signal || `code ${code}`}.`));
      }
    });
    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out waiting for the Stripe listener signing secret."));
      }
    }, 30000);
    timers.add(timeout);
  });
}

async function waitForFirebase(firebase) {
  await waitUntil("Firebase emulators and Functions", firebase, async () => {
    const hub = await httpRequest("http://127.0.0.1:4400/emulators");
    if (hub.status !== 200) return false;
    const emulators = JSON.parse(hub.body);
    for (const name of ["auth", "firestore", "functions"]) {
      if (!emulators[name]) return false;
    }
    const logging = await httpRequest("http://127.0.0.1:4500/");
    if (!logging.status || logging.status >= 500) return false;
    const callable = await httpRequest(CALLABLE_URL, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({data: {}}),
    });
    return callable.status !== 404 && callable.status < 500;
  }, 120000);
}

async function seedLocalPaygClass() {
  const seeded = buildLocalPaygClassDocument();
  const response = await httpRequest(
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/classes/${seeded.classId}`,
    {
      method: "PATCH",
      // Firestore's emulator treats the literal owner token as its local admin
      // identity. The destination remains hard-coded to loopback/demo-*.
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify(seeded.body),
    }
  );
  if (response.status !== 200) {
    throw new Error(
      `Could not seed the isolated PAYG browser class (HTTP ${response.status}).`
    );
  }
  return seeded;
}

async function waitForFrontend(frontend, isReady) {
  await waitUntil(
    "the React development server to compile and pass type-checking",
    frontend,
    async () => isReady(),
    120000
  );
}

async function main() {
  const localDotenvPath = path.join(FUNCTIONS_DIR, ".env.local");
  // Recover before every other fallible preflight. A missing Firebase binary,
  // invalid scope, or stale release must never leave prior temporary gates on.
  // The recovery helper also rolls back a durable CAS transaction whose live
  // path was moved aside immediately before an abrupt process death.
  recoverLocalPaygDotenvOverlay(localDotenvPath);
  assertSupportedProcessPlatform();
  assertNoDiskSecrets();
  const firebaseCommand = resolveFirebaseCommand();
  const catalogueScope = resolveStripeTestCatalogueScope(
    process.env.STRIPE_TEST_PLAN_SCOPE
  );
  const paygRelease = catalogueScope.name === PAYG_SCOPE ?
    loadApprovedPaygRelease(REPO_ROOT) : null;
  const paygEnvironment = paygRelease ?
    buildLocalPaygEnvironment(paygRelease) : {};
  if (paygRelease) {
    // firebase-tools intentionally gives .env.local precedence over the
    // runner's process environment for non-secret params. Install a reversible
    // non-secret overlay so the PAYG browser scope can open locally without
    // weakening production gates or writing provider credentials to disk.
    restoreLocalPaygDotenv = installLocalPaygDotenvOverlay(
      localDotenvPath,
      paygEnvironment
    );
  }
  privateRuntimeDirectory = createPrivateRuntimeDirectory();
  await assertPortsAvailable();

  const stripeKey = stripeCliTestKey();
  console.log("Starting an isolated Stripe test listener (the runner creates no secret files)...");
  const {webhookSecret} = await startStripeListener(
    stripeKey,
    privateRuntimeDirectory
  );

  const preflightEnvironment = privateChildEnvironment(privateRuntimeDirectory, {
    APP_PUBLIC_ORIGIN: APP_ORIGIN,
    STRIPE_SECRET_KEY: stripeKey,
    ...(catalogueScope.name === "full" ? {} : {
      STRIPE_TEST_PLAN_SCOPE: catalogueScope.name,
    }),
  });
  await runPreflight(preflightEnvironment, privateRuntimeDirectory);
  await assertPortsAvailable();

  const functionsEnvironment = privateChildEnvironment(privateRuntimeDirectory, {
    APP_PUBLIC_ORIGIN: APP_ORIGIN,
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
    MEMBERSHIP_CHECKOUT_APP_ID: APP_ID,
    // The shared webhook declares this PAYG secret even when this scoped
    // journey only exercises memberships. Keep it ephemeral and in memory so
    // the emulator never falls back to the real Secret Manager project.
    PAYG_CANCELLATION_TOKEN_SECRET:
      crypto.randomBytes(32).toString("base64url"),
    RESEND_API_KEY: LOCAL_DISABLED_RESEND_API_KEY,
    RESEND_FROM_EMAIL: "local-stripe-test@example.invalid",
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    ...paygEnvironment,
  });

  const firebaseLaunch = firebaseEmulatorLaunch(
    firebaseCommand,
    privateRuntimeDirectory,
    functionsEnvironment
  );
  const firebase = spawnChild(
    "Firebase emulators",
    firebaseLaunch.command,
    firebaseLaunch.args,
    {
      ...firebaseLaunch.options,
      // firebase-tools normally starts Java emulators with detached:true.
      // Keep them in the stable supervisor group for complete teardown.
      preventDetachedDescendants: true,
    }
  );
  lineRelay("firebase", firebase.stdout, process.stdout);
  lineRelay("firebase", firebase.stderr, process.stderr);
  monitorChild(firebase, "Firebase emulators");
  await waitForFirebase(firebase);
  const seededPaygClass = catalogueScope.name === PAYG_SCOPE ?
    await seedLocalPaygClass() : null;
  await assertAppPortAvailable();

  const frontend = spawnChild(
    "React frontend",
    "npm",
    ["--prefix", REPO_ROOT, "start"],
    {
      cwd: privateRuntimeDirectory,
      env: privateChildEnvironment(privateRuntimeDirectory, {
        BROWSER: "none",
        CI: "true",
        HOST: "127.0.0.1",
        PORT: String(APP_PORT),
        REACT_APP_FIREBASE_API_KEY: "demo-api-key",
        REACT_APP_FIREBASE_APP_ID: APP_ID,
        REACT_APP_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
        REACT_APP_FIREBASE_MEASUREMENT_ID: "G-LOCALTEST00",
        REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
        REACT_APP_FIREBASE_PROJECT_ID: PROJECT_ID,
        REACT_APP_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
        REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "true",
        REACT_APP_USE_EMULATORS: "true",
      }),
    }
  );
  let frontendCompiled = false;
  let frontendTypecheckPassed = false;
  const inspectFrontend = (buffered) => {
    if (buffered.includes("Compiled successfully!")) frontendCompiled = true;
    if (buffered.includes("No issues found.")) frontendTypecheckPassed = true;
  };
  lineRelay("frontend", frontend.stdout, process.stdout, inspectFrontend);
  lineRelay("frontend", frontend.stderr, process.stderr);
  monitorChild(frontend, "React frontend");
  await waitForFrontend(
    frontend,
    () => frontendCompiled && frontendTypecheckPassed
  );

  console.log("\nLocal Stripe test journey is ready:");
  console.log(`- Catalogue preflight scope: ${catalogueScope.name}`);
  console.log(`- App: ${APP_ORIGIN}${seededPaygClass ?
    "/pay-as-you-go" : "/memberships"}`);
  console.log("- Firebase UI: http://127.0.0.1:4000");
  console.log(`- Stripe forwarding: ${WEBHOOK_URL}`);
  console.log("- Card: 4242 4242 4242 4242, any future expiry/CVC");
  if (seededPaygClass) {
    console.log(`- Seeded class: ${seededPaygClass.classId} at ${seededPaygClass.startTime}`);
    console.log("- PAYG expectation: one £7 Stripe test-mode payment; no account created");
    console.log("- Email transport: disabled; confirmation remains in the local outbox");
  } else {
    console.log("- Presale expectation: £0 today; first payment on 1 September 2026");
    console.log("- Adult Unlimited TEST ONLY shared code: EXISTING5-TEST");
    console.log("- Verify after Checkout: npm run verify:stripe-test-journey --prefix functions");
  }
  console.log("Press Ctrl-C once to stop every local process.\n");
}

function cleanupOnExit() {
  if (exitCleanupHandled) return;
  exitCleanupHandled = true;
  try {
    restoreLocalPaygDotenv();
  } catch (error) {
    process.exitCode = 1;
    console.error(
      "Could not safely restore functions/.env.local during exit: " +
      redactProviderSecrets(error.message)
    );
  }
  try {
    cleanupPrivateRuntimeDirectory(privateRuntimeDirectory);
  } catch (error) {
    process.exitCode = 1;
    console.error(
      "Could not clean the private local Stripe runtime during exit: " +
      redactProviderSecrets(error.message)
    );
  }
}

function runCli() {
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGHUP", () => void shutdown(0));
  process.once("exit", cleanupOnExit);
  process.on("uncaughtException", (error) => {
    fail(
      "Uncaught exception: " +
      (error instanceof Error ? error.message : String(error))
    );
  });
  process.on("unhandledRejection", (error) => {
    fail(
      "Unhandled rejection: " +
      (error instanceof Error ? error.message : String(error))
    );
  });

  main().catch((error) => {
    if (!stopping) {
      console.error(
        "Local Stripe journey could not start: " +
        redactProviderSecrets(error.message)
      );
      void shutdown(1);
    }
  });
}

module.exports = {
  LOCAL_DISABLED_RESEND_API_KEY,
  assertSupportedProcessPlatform,
  cleanupPrivateRuntimeDirectory,
  createPrivateRuntimeDirectory,
  firebaseEmulatorLaunch,
  processGroupExists,
  signalProcessGroup,
  spawnChild,
  trackProcessGroup,
};

if (require.main === module) runCli();
