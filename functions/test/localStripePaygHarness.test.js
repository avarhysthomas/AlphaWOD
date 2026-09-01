/* eslint-disable @typescript-eslint/no-var-requires, max-len */

const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  LOCAL_DISABLED_RESEND_API_KEY,
  assertSupportedProcessPlatform,
  cleanupPrivateRuntimeDirectory,
  createPrivateRuntimeDirectory,
  firebaseEmulatorLaunch,
  signalProcessGroup,
  spawnChild,
  trackProcessGroup,
} = require("../scripts/runLocalStripeTestJourney");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

test("Firebase logs stay in a private disposable runtime directory", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "payg-runtime-parent-"));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const runtime = createPrivateRuntimeDirectory(parent);
  assert.equal(fs.statSync(runtime).mode & 0o777, 0o700);

  const environment = {FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true"};
  const launch = firebaseEmulatorLaunch(
    "/example/firebase",
    runtime,
    environment
  );
  assert.equal(launch.options.cwd, runtime);
  assert.equal(launch.options.env, environment);
  const configIndex = launch.args.indexOf("--config");
  assert.notEqual(configIndex, -1);
  assert.equal(
    launch.args[configIndex + 1],
    path.join(REPOSITORY_ROOT, "firebase.json")
  );
  assert.notEqual(launch.options.cwd, REPOSITORY_ROOT);

  fs.writeFileSync(
    path.join(runtime, "firebase-debug.log"),
    "browser@example.test\n"
  );
  cleanupPrivateRuntimeDirectory(runtime);
  assert.equal(fs.existsSync(runtime), false);
});

test("local PAYG email delivery fails before any provider request", () => {
  assert.equal(LOCAL_DISABLED_RESEND_API_KEY.length > 0, true);
  assert.equal(LOCAL_DISABLED_RESEND_API_KEY.trim(), "");
  assert.notEqual(LOCAL_DISABLED_RESEND_API_KEY, "re_test_local_email_disabled");
});

test("an exited child leader does not discard its detached process group", () => {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 43210,
    exitCode: null,
    signalCode: null,
    kill: () => {
      throw new Error("leader kill must not be used on POSIX");
    },
  });
  const registry = new Map();
  const group = trackProcessGroup(child, "detached test", registry, () => true);
  child.exitCode = 0;
  child.emit("close", 0, null);
  assert.equal(registry.get(group.pid), group);

  const signals = [];
  const signalled = signalProcessGroup(
    group,
    "SIGTERM",
    (pid, signal) => signals.push({pid, signal}),
    "darwin"
  );
  assert.equal(signalled, true);
  assert.deepEqual(signals, [{pid: -43210, signal: "SIGTERM"}]);
});

test("a stable supervisor contains a fast self-detaching grandchild", {
  skip: process.platform === "win32",
}, async (t) => {
  const supervisorPath = path.join(
    REPOSITORY_ROOT,
    "functions/scripts/localStripeProcessSupervisor.js"
  );
  const targetSource = [
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,",
    "['-e','setInterval(() => {}, 1000)'],",
    "{detached:true,stdio:'ignore'});",
    "process.stdout.write(String(child.pid)+'\\n',()=>process.exit(0));",
  ].join("");
  const supervisor = spawn(
    process.execPath,
    [supervisorPath, process.execPath, "-e", targetSource],
    {
      cwd: os.tmpdir(),
      detached: true,
      env: {
        ...process.env,
        LOCAL_STRIPE_ATTACH_TARGET_DESCENDANTS: "true",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }
  );
  let grandchildPid = 0;
  let output = "";
  supervisor.stdout.on("data", (chunk) => {
    output += String(chunk);
    grandchildPid = Number(output.trim()) || grandchildPid;
  });
  const targetExit = new Promise((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.on("message", (message) => {
      if (message?.type === "target-error") {
        reject(new Error(message.message));
      }
      if (message?.type === "target-exit") resolve(message);
    });
  });
  t.after(() => {
    try {
      process.kill(-supervisor.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });

  const exit = await targetExit;
  assert.equal(exit.code, 0);
  for (let attempt = 0; !grandchildPid && attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(Number.isSafeInteger(grandchildPid) && grandchildPid > 0, true);
  assert.doesNotThrow(() => process.kill(supervisor.pid, 0));

  process.kill(-supervisor.pid, "SIGTERM");
  await new Promise((resolve) => supervisor.once("close", resolve));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(grandchildPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
  }
  assert.fail("the supervised grandchild remained alive after group shutdown");
});

test("a supervisor crash reports failure instead of hanging preflight", {
  skip: process.platform === "win32",
}, async (t) => {
  const child = spawnChild(
    "supervisor crash fixture",
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {cwd: os.tmpdir(), env: process.env}
  );
  t.after(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const reported = new Promise((resolve) => child.once(
    "target-error",
    resolve
  ));
  process.kill(child.pid, "SIGKILL");
  const error = await reported;
  assert.match(error.message, /before reporting the command result/);
});

test("the process harness fails closed on Windows", () => {
  assert.doesNotThrow(() => assertSupportedProcessPlatform("darwin"));
  assert.throws(
    () => assertSupportedProcessPlatform("win32"),
    /requires POSIX process groups/
  );
});

test("abandoned PAYG overlay recovery precedes every fallible preflight", () => {
  const source = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      "functions/scripts/runLocalStripeTestJourney.js"
    ),
    "utf8"
  );
  const mainStart = source.indexOf("async function main() {");
  const recovery = source.indexOf(
    "recoverLocalPaygDotenvOverlay(localDotenvPath);",
    mainStart
  );
  const secretScan = source.indexOf("assertNoDiskSecrets();", mainStart);
  const firebaseResolution = source.indexOf(
    "resolveFirebaseCommand();",
    mainStart
  );
  const scopeResolution = source.indexOf(
    "resolveStripeTestCatalogueScope(",
    mainStart
  );

  assert.notEqual(mainStart, -1);
  assert.equal(recovery > mainStart, true);
  assert.equal(secretScan > recovery, true);
  assert.equal(firebaseResolution > recovery, true);
  assert.equal(scopeResolution > recovery, true);
});

test("PAYG runbook keeps the stack open until second-terminal verification", () => {
  const runbook = fs.readFileSync(
    path.join(REPOSITORY_ROOT, "docs/billing/local-stripe-test-journey.md"),
    "utf8"
  );
  const terminalOne = runbook.indexOf("Terminal 1");
  const paygStart = runbook.indexOf(
    "\nnpm run stripe:test:payg\n",
    terminalOne
  );
  const terminalTwo = runbook.indexOf("Terminal 2", terminalOne);
  const verifier = runbook.indexOf(
    "npm run verify:stripe-test-payg-journey",
    terminalTwo
  );
  const stop = runbook.indexOf("Ctrl-C", verifier);
  assert.equal(paygStart >= 0, true);
  assert.equal(paygStart > terminalOne, true);
  assert.equal(terminalTwo > terminalOne, true);
  assert.equal(verifier > terminalTwo, true);
  assert.equal(stop > verifier, true);
});
