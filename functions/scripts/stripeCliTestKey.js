/* eslint-disable max-len, require-jsdoc */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function assertStripeTestKey(key) {
  if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) {
    throw new Error("Only a Stripe test-mode key (rk_test_ or sk_test_) is allowed.");
  }
  return key;
}

function redactProviderSecrets(value) {
  return String(value)
    .replace(/whsec_[A-Za-z0-9_-]+/g, "whsec_<redacted>")
    .replace(/(?:rk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "<stripe-key-redacted>")
    .replace(/re_[A-Za-z0-9_-]+/g, "<resend-key-redacted>");
}

function activeProfileSection(config) {
  const selectedProfile = config.match(/^project-name\s*=\s*['\"]([^'\"]+)['\"]\s*$/m)?.[1] ||
    "default";
  const marker = `[${selectedProfile}]`;
  const sectionStart = config.indexOf(marker);
  if (sectionStart !== -1) {
    const remainder = config.slice(sectionStart + marker.length);
    const nextSection = remainder.search(/\n\s*\[/);
    return nextSection === -1 ? remainder : remainder.slice(0, nextSection);
  }

  // Some older Stripe CLI configurations put the default profile at top level.
  if (selectedProfile === "default") {
    const firstSection = config.search(/^\s*\[/m);
    return firstSection === -1 ? config : config.slice(0, firstSection);
  }
  return "";
}

function stripeCliConfigPath(environment) {
  const configRoot = environment.XDG_CONFIG_HOME?.trim() ||
    path.join(os.homedir(), ".config");
  return path.join(configRoot, "stripe", "config.toml");
}

function assertPrivateConfig(configPath) {
  const linkStat = fs.lstatSync(configPath);
  if (linkStat.isSymbolicLink()) {
    throw new Error("Stripe CLI configuration must not be a symbolic link.");
  }
  const stat = fs.statSync(configPath);
  if (!stat.isFile()) throw new Error("Stripe CLI configuration is not a regular file.");
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      "Stripe CLI configuration permissions are too broad. Set the file mode to 600."
    );
  }
}

function parseExpiry(section) {
  const raw = section.match(/^(?:test_mode_key_expires_at|test_mode_api_key_expiry)\s*=\s*['\"]?([^'\"\s]+)['\"]?\s*$/m)?.[1];
  if (!raw) return null;
  const numeric = /^\d+$/.test(raw) ? Number(raw) : null;
  const milliseconds = numeric === null ? Date.parse(raw) :
    numeric > 1000000000000 ? numeric : numeric * 1000;
  return Number.isFinite(milliseconds) ? milliseconds : NaN;
}

function stripeCliTestKey(environment = process.env) {
  const supplied = environment.STRIPE_SECRET_KEY?.trim() ||
    environment.STRIPE_API_KEY?.trim();
  if (supplied) return assertStripeTestKey(supplied);

  const configPath = stripeCliConfigPath(environment);
  let config;
  try {
    assertPrivateConfig(configPath);
    config = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Stripe CLI is not authenticated. Run `stripe login` first.");
    }
    throw error;
  }

  let section = activeProfileSection(config);
  config = "";
  const key = section.match(/^test_mode_api_key\s*=\s*['\"]([^'\"]+)['\"]\s*$/m)?.[1];
  if (!key) {
    throw new Error("The active Stripe CLI profile has no test-mode key. Run `stripe login`.");
  }
  const expiry = parseExpiry(section);
  if (Number.isNaN(expiry)) {
    throw new Error("The active Stripe CLI profile has an invalid test-key expiry.");
  }
  if (expiry !== null && expiry <= Date.now() + 5 * 60 * 1000) {
    throw new Error("The Stripe CLI test key is expired or expires within five minutes. Run `stripe login`.");
  }
  section = "";
  return assertStripeTestKey(key);
}

module.exports = {assertStripeTestKey, redactProviderSecrets, stripeCliTestKey};
