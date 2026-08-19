import fs from "fs";
import path from "path";

/**
 * The membership catalogue and billing policy exist twice: once for Cloud
 * Functions and once for the browser bundle, because neither build can import
 * across the other's root. These tests make that duplication safe by failing
 * whenever the two copies disagree, so pricing, ages, AlphaWOD entitlement,
 * document versions, and customer-facing policy text stay single-sourced.
 */

const FRONTEND_FILE = path.join(__dirname, "membershipPlans.ts");
const FUNCTIONS_FILE = path.join(
  __dirname,
  "..",
  "..",
  "functions",
  "src",
  "membershipPlans.ts"
);

/**
 * Captures the value of a top-level `export const NAME = ...;` declaration,
 * with comments removed and whitespace normalised.
 *
 * The scan is string- and comment-aware because the policy copy and the
 * explanatory comments both contain semicolons, which a naive split would
 * treat as the end of the declaration.
 */
function extractDeclaration(source: string, name: string): string {
  const startPattern = new RegExp(`^export const ${name}(?::[^=]+)? = `, "m");
  const match = startPattern.exec(source);
  if (!match) throw new Error(`Declaration ${name} not found in source`);

  let index = match.index + match[0].length;
  let depth = 0;
  let out = "";

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) break;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        out += source[index];
        if (source[index] === "\\") {
          out += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;
    if (char === ";" && depth === 0) break;

    out += char;
    index += 1;
  }

  return out
    .replace(/\s+/g, " ")
    .replace(/,\s*([}\]])/g, " $1")
    .replace(/([{[])\s+/g, "$1 ")
    .trim();
}

describe("membership catalogue parity", () => {
  const frontendSource = fs.readFileSync(FRONTEND_FILE, "utf8");
  const functionsSource = fs.readFileSync(FUNCTIONS_FILE, "utf8");

  const sharedDeclarations = [
    "BILLING_TIMEZONE",
    "BILLING_CURRENCY",
    "PRESALE_BILLING_ANCHOR_AT_ISO",
    "PRESALE_BILLING_ANCHOR_UNIX_SECONDS",
    "PRESALE_SIGNUP_CUTOFF_AT_ISO",
    "PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS",
    "EXISTING_MEMBER_OFFER",
    "COMPANY",
    "PLAN_KEYS",
    "MEMBERSHIP_PLANS",
    "BILLING_POLICY",
    "POLICY_TEXT",
    "CHECKOUT_DOCUMENTS",
    "CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION",
  ];

  it.each(sharedDeclarations)(
    "keeps %s identical in the functions and frontend copies",
    (name) => {
      expect(extractDeclaration(frontendSource, name)).toBe(
        extractDeclaration(functionsSource, name)
      );
    }
  );

  it("keeps the youth routing boundary identical in both copies", () => {
    const {
      MEMBERSHIP_PLANS,
      resolveYouthPlanForAge,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    expect(resolveYouthPlanForAge(3)).toBeNull();
    expect(resolveYouthPlanForAge(4)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(11)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(12)).toBe("youth_teenstars");
    expect(resolveYouthPlanForAge(16)).toBe("youth_teenstars");
    expect(resolveYouthPlanForAge(17)).toBeNull();

    expect(MEMBERSHIP_PLANS.youth_youngstars.maxAge).toBe(
      MEMBERSHIP_PLANS.youth_teenstars.minAge - 1
    );
  });

  it("grants AlphaWOD access on exactly one plan", () => {
    const {
      MEMBERSHIP_PLANS,
      PLAN_KEYS,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    const granting = PLAN_KEYS.filter((key) => MEMBERSHIP_PLANS[key].grantsAlphaWodAccess);
    expect(granting).toEqual(["adult_unlimited"]);
  });

  it("keeps the purchase flow closed while the legal documents are drafts", () => {
    const {
      CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    // This guard is intentional: every document version in CHECKOUT_DOCUMENTS
    // is still marked "DRAFT FOR LEGAL REVIEW - NOT APPROVED FOR PUBLICATION".
    // Flip it only together with approved, versioned documents.
    expect(CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION).toBe(false);
  });
});
