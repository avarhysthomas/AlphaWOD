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
const path = require("node:path");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");
const {
  resolveStripeTestCatalogueScope,
} = require("./stripeTestCatalogueScope");

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

const FIREBASE_COMMAND = resolveFirebaseCommand();
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
const timers = new Set();
let stopping = false;
let shutdownPromise;

function safeEnvironment(additions = {}) {
  const environment = {};
  for (const name of SAFE_PARENT_ENVIRONMENT) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {...environment, ...additions};
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

function spawnChild(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || safeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.localJourneyLabel = label;
  children.add(child);
  child.once("close", () => children.delete(child));
  child.once("error", (error) => {
    if (!stopping) fail(`${label} could not start: ${error.message}`);
  });
  return child;
}

function monitorChild(child, label) {
  child.once("exit", (code, signal) => {
    if (!stopping) {
      fail(`${label} exited unexpectedly (${signal || `code ${code}`}).`);
    }
  });
}

function running(child) {
  return child?.pid && child.exitCode === null && child.signalCode === null;
}

function signalChild(child, signal) {
  if (!running(child)) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error(`Could not signal ${child.localJourneyLabel}: ${error.message}`);
    }
  }
}

function waitForChildExit(child) {
  if (!running(child)) return Promise.resolve();
  return new Promise((resolve) => child.once("close", resolve));
}

async function waitForChildrenOrTimeout(activeChildren, milliseconds) {
  let timer;
  await Promise.race([
    Promise.all(activeChildren.map(waitForChildExit)),
    new Promise((resolve) => {
      timer = setTimeout(resolve, milliseconds);
      timers.add(timer);
    }),
  ]);
  if (timer) clearTimer(timer);
}

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const active = [...children].filter(running);
    active.forEach((child) => signalChild(child, "SIGTERM"));
    await waitForChildrenOrTimeout(active, 4000);
    const stubborn = [...children].filter(running);
    stubborn.forEach((child) => signalChild(child, "SIGKILL"));
    await waitForChildrenOrTimeout(stubborn, 1500);
    process.exit(code);
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

function runPreflight(runtimeEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(
      "Stripe catalogue preflight",
      process.execPath,
      ["--env-file=.env.local", "scripts/verifyStripeTestConfig.js"],
      {cwd: FUNCTIONS_DIR, env: runtimeEnvironment}
    );
    lineRelay("preflight", child.stdout, process.stdout);
    lineRelay("preflight", child.stderr, process.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `Stripe catalogue preflight exited with ${signal || `code ${code}`}.`
      ));
    });
  });
}

function startStripeListener(stripeKey) {
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
      {env: safeEnvironment({STRIPE_API_KEY: stripeKey})}
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
    listener.once("exit", (code, signal) => {
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

async function waitForFrontend(frontend, isReady) {
  await waitUntil(
    "the React development server to compile and pass type-checking",
    frontend,
    async () => isReady(),
    120000
  );
}

async function main() {
  assertNoDiskSecrets();
  const catalogueScope = resolveStripeTestCatalogueScope(
    process.env.STRIPE_TEST_PLAN_SCOPE
  );
  if (!fs.existsSync(path.join(FUNCTIONS_DIR, ".env.local"))) {
    throw new Error("functions/.env.local is missing. Copy .env.local.example first.");
  }
  await assertPortsAvailable();

  const stripeKey = stripeCliTestKey();
  console.log("Starting an isolated Stripe test listener (the runner creates no secret files)...");
  const {webhookSecret} = await startStripeListener(stripeKey);

  const preflightEnvironment = safeEnvironment({
    APP_PUBLIC_ORIGIN: APP_ORIGIN,
    STRIPE_SECRET_KEY: stripeKey,
    ...(catalogueScope.name === "full" ? {} : {
      STRIPE_TEST_PLAN_SCOPE: catalogueScope.name,
    }),
  });
  await runPreflight(preflightEnvironment);
  await assertPortsAvailable();

  const functionsEnvironment = safeEnvironment({
    APP_PUBLIC_ORIGIN: APP_ORIGIN,
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
    MEMBERSHIP_CHECKOUT_APP_ID: APP_ID,
    // The shared webhook declares this PAYG secret even when this scoped
    // journey only exercises memberships. Keep it ephemeral and in memory so
    // the emulator never falls back to the real Secret Manager project.
    PAYG_CANCELLATION_TOKEN_SECRET:
      crypto.randomBytes(32).toString("base64url"),
    RESEND_API_KEY: "re_test_local_email_disabled",
    RESEND_FROM_EMAIL: "local-stripe-test@example.invalid",
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });

  const firebase = spawnChild(
    "Firebase emulators",
    FIREBASE_COMMAND,
    [
      "emulators:start",
      "--project", PROJECT_ID,
      "--only", "auth,firestore,functions",
    ],
    {env: functionsEnvironment}
  );
  lineRelay("firebase", firebase.stdout, process.stdout);
  lineRelay("firebase", firebase.stderr, process.stderr);
  monitorChild(firebase, "Firebase emulators");
  await waitForFirebase(firebase);
  await assertAppPortAvailable();

  const frontend = spawnChild(
    "React frontend",
    "npm",
    ["start"],
    {
      env: safeEnvironment({
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
  console.log(`- App: ${APP_ORIGIN}/memberships`);
  console.log("- Firebase UI: http://127.0.0.1:4000");
  console.log(`- Stripe forwarding: ${WEBHOOK_URL}`);
  console.log("- Card: 4242 4242 4242 4242, any future expiry/CVC");
  console.log("- Presale expectation: £0 today; first payment on 1 September 2026");
  console.log("- Adult Unlimited TEST ONLY shared code: EXISTING5-TEST");
  console.log("- Verify after Checkout: npm run verify:stripe-test-journey --prefix functions");
  console.log("Press Ctrl-C once to stop every local process.\n");
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));
process.on("uncaughtException", (error) => {
  fail(`Uncaught exception: ${error instanceof Error ? error.message : String(error)}`);
});
process.on("unhandledRejection", (error) => {
  fail(`Unhandled rejection: ${error instanceof Error ? error.message : String(error)}`);
});

main().catch((error) => {
  if (!stopping) {
    console.error(`Local Stripe journey could not start: ${redactProviderSecrets(error.message)}`);
    void shutdown(1);
  }
});
