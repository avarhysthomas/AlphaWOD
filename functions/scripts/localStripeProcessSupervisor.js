/* eslint-disable no-console, require-jsdoc */

// Keep a stable process-group leader alive for each local journey command.
// The runner can then terminate the entire group even when the command exits
// before one of its descendants. The IPC disconnect path also cleans the group
// if the runner itself is killed abruptly.

const {spawn} = require("node:child_process");
const path = require("node:path");

const command = process.argv[2];
const args = process.argv.slice(3);
const targetEnvironment = {...process.env};
if (targetEnvironment.LOCAL_STRIPE_ATTACH_TARGET_DESCENDANTS === "true") {
  delete targetEnvironment.LOCAL_STRIPE_ATTACH_TARGET_DESCENDANTS;
  targetEnvironment.LOCAL_STRIPE_ATTACH_DESCENDANTS_ACTIVE = "true";
  const preloadPath = path.join(__dirname, "localStripePreventDetach.js");
  const preloadOption = "--require=" + JSON.stringify(preloadPath);
  targetEnvironment.NODE_OPTIONS = [
    targetEnvironment.NODE_OPTIONS,
    preloadOption,
  ].filter(Boolean).join(" ");
}

if (!command || typeof process.send !== "function") {
  console.error("The local Stripe process supervisor requires runner IPC.");
  process.exit(64);
}

let target = null;
let targetExited = false;
let stopping = false;
let orphaned = false;
const keepAlive = setInterval(() => {}, 60 * 60 * 1000);

function send(message) {
  if (!process.connected) return;
  try {
    process.send(message, () => {});
  } catch {
    // The disconnect handler owns cleanup if the runner disappeared.
  }
}

function signalTarget(signal) {
  if (!target || targetExited) return;
  try {
    target.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error("Could not signal supervised command: " + error.message);
    }
  }
}

function signalOwnGroup(signal) {
  if (process.platform === "win32") {
    signalTarget(signal);
    return;
  }
  try {
    process.kill(-process.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error("Could not signal supervised process group: " + error.message);
    }
  }
}

function finishWhenSafe() {
  if (!stopping || orphaned || !targetExited) return;
  clearInterval(keepAlive);
  process.exit(0);
}

function beginShutdown(signal, runnerDisconnected = false) {
  if (stopping) return;
  stopping = true;
  orphaned = runnerDisconnected;
  signalTarget(signal);
  if (runnerDisconnected) {
    // This includes the supervisor itself. Signal handlers keep it alive long
    // enough to escalate for a descendant that ignores TERM.
    signalOwnGroup("SIGTERM");
    const escalation = setTimeout(() => signalOwnGroup("SIGKILL"), 1500);
    escalation.unref();
    return;
  }
  finishWhenSafe();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => beginShutdown(signal));
}
process.once("disconnect", () => beginShutdown("SIGTERM", true));

target = spawn(command, args, {
  cwd: process.cwd(),
  env: targetEnvironment,
  stdio: ["ignore", "inherit", "inherit"],
  detached: false,
});

target.once("spawn", () => send({type: "target-started", pid: target.pid}));
target.once("error", (error) => {
  targetExited = true;
  send({type: "target-error", message: error.message});
  finishWhenSafe();
});
target.once("exit", (code, signal) => {
  targetExited = true;
  send({type: "target-exit", code, signal});
  finishWhenSafe();
});
