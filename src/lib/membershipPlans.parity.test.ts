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
    "YOUTH_FAMILY_OFFER",
    "MEMBERSHIP_SCHEMA_VERSION",
    "COMPANY",
    "PLAN_KEYS",
    "MEMBERSHIP_PLANS",
    "BILLING_POLICY",
    "POLICY_TEXT",
    "CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES",
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

  it("keeps schema v3 and the youth recommendation boundary identical", () => {
    const {
      MEMBERSHIP_SCHEMA_VERSION,
      MEMBERSHIP_PLANS,
      resolveYouthPlanForAge,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    expect(MEMBERSHIP_SCHEMA_VERSION).toBe(3);
    expect(resolveYouthPlanForAge(-1)).toBeNull();
    expect(resolveYouthPlanForAge(0)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(10)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(11)).toBe("youth_teenstars");
    expect(resolveYouthPlanForAge(120)).toBe("youth_teenstars");

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

  it("freezes the approved version of every checkout document", () => {
    const {
      CHECKOUT_DOCUMENTS,
      CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    expect(CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION).toBe(true);
    expect(Object.fromEntries(Object.entries(CHECKOUT_DOCUMENTS).map(
      ([key, document]) => [key, [document.version, document.effectiveDate]]
    ))).toEqual({
      membershipTerms: ["ZAF-TERMS-2026-08-25-01", "2026-08-25"],
      cancellationPolicy: ["ZAF-CANCEL-2026-08-23-01", "2026-08-23"],
      privacyNotice: ["ZAF-PRIVACY-2026-08-25-01", "2026-08-25"],
      adultWaiver: ["ZAF-ADULT-WAIVER-2026-08-23-01", "2026-08-23"],
      guardianAddendum: ["ZAF-GUARDIAN-2026-08-25-01", "2026-08-25"],
    });
    Object.values(CHECKOUT_DOCUMENTS).forEach((document) => {
      expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(document)).not.toMatch(/\b(?:DRAFT|PENDING)\b/i);
    });
  });

  it("keeps canonical legal copy within the checkout outbox byte budget", () => {
    const {
      CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES,
      CHECKOUT_DOCUMENTS,
    } = require("./membershipPlans") as typeof import("./membershipPlans");
    const bytes = Object.values(CHECKOUT_DOCUMENTS).reduce(
      (total, document) => total + Buffer.byteLength(document.content, "utf8"),
      0
    );

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES);
  });

  it("serves the exact canonical UTF-8 document bytes linked at checkout", () => {
    const {
      CHECKOUT_DOCUMENTS,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    Object.values(CHECKOUT_DOCUMENTS).forEach((document) => {
      const publicFile = path.join(
        __dirname,
        "..",
        "..",
        "public",
        document.publicUrl.replace(/^\//, "")
      );
      expect(fs.readFileSync(publicFile, "utf8")).toBe(document.content);
      expect(document.contentType).toBe("text/plain; charset=utf-8");
      expect(document.hashCovers).toBe("UTF-8 bytes of content");
    });
  });

  it("resolves exact adult and youth legal sets without cross-role documents", () => {
    const {
      resolveCheckoutAcceptanceStatements,
      resolveCheckoutDocuments,
      resolveCheckoutSignerRole,
    } = require("./membershipPlans") as typeof import("./membershipPlans");

    expect(resolveCheckoutDocuments("adult_unlimited").map(({key}) => key)).toEqual([
      "membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver",
    ]);
    expect(resolveCheckoutAcceptanceStatements("adult_unlimited").map(({id}) => id))
      .toEqual([
        "membership_contract", "privacy_notice", "adult_participant_waiver",
        "recurring_payment_authority", "immediate_performance",
      ]);
    expect(resolveCheckoutSignerRole("adult_unlimited"))
      .toBe("adult_participant_and_payer");

    expect(resolveCheckoutDocuments("youth_teenstars").map(({key}) => key)).toEqual([
      "membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum",
    ]);
    expect(resolveCheckoutAcceptanceStatements("youth_teenstars").map(({id}) => id))
      .toEqual([
        "membership_contract", "privacy_notice", "guardian_authority",
        "guardian_youth_addendum", "recurring_payment_authority",
        "immediate_performance",
      ]);
    expect(resolveCheckoutSignerRole("youth_teenstars"))
      .toBe("youth_guardian_and_payer");
  });
});
