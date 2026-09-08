/* eslint-disable require-jsdoc, valid-jsdoc, max-len, no-control-regex */

/**
 * Pure interrupted-checkout recovery email helpers.
 *
 * This module deliberately has no Firebase, Stripe, Resend, clock, or network
 * dependency. The recovery callable supplies only provider-verified data and
 * persists the returned deterministic routing evidence before delivery.
 */

import {createHash} from "crypto";
import {COMPANY} from "./membershipPlans";

const MEMBERSHIP_CHECKOUT_INTENT_PATTERN = /^attempt_[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_LOCAL_PART_LENGTH = 64;
const MAX_DISPLAY_TEXT_LENGTH = 200;

export const MEMBERSHIP_CHECKOUT_RECOVERY_EMAIL_SCHEMA_VERSION = 1;

export type CheckoutRecoveryEmailPayload = Readonly<{
  from: string;
  to: readonly [string];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}>;

export const CHECKOUT_RECOVERY_RECIPIENT_SOURCES = [
  "stripe_session_customer_details",
  "stripe_session_customer_email",
  "authenticated_intent",
  "stripe_customer",
] as const;

export type CheckoutRecoveryRecipientSource =
  typeof CHECKOUT_RECOVERY_RECIPIENT_SOURCES[number];

export type CheckoutRecoveryEmailInput = Readonly<{
  recipientEmail: string;
  fromEmail: string;
  publicOrigin: string;
  planName: string;
  participantFullNames: readonly string[];
}>;

export function canonicalizeCheckoutRecoveryEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value.trim().toLowerCase();
  if (!canonical || canonical.length > MAX_EMAIL_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(canonical) ||
    !EMAIL_PATTERN.test(canonical)) return null;

  const separator = canonical.lastIndexOf("@");
  const local = canonical.slice(0, separator);
  const domain = canonical.slice(separator + 1);
  if (!local || local.length > MAX_EMAIL_LOCAL_PART_LENGTH ||
    domain.startsWith(".") || domain.endsWith(".") ||
    domain.includes("..")) return null;
  return canonical;
}

export function maskCheckoutRecoveryEmail(value: unknown): string | null {
  const canonical = canonicalizeCheckoutRecoveryEmail(value);
  if (!canonical) return null;
  const separator = canonical.lastIndexOf("@");
  const local = canonical.slice(0, separator);
  const domain = canonical.slice(separator + 1);
  const maskedLocal = local.length === 1 ? "*" : `${local[0]}***`;
  return `${maskedLocal}@${domain}`;
}

function requireCheckoutIntentId(value: string): string {
  if (!MEMBERSHIP_CHECKOUT_INTENT_PATTERN.test(value)) {
    throw new Error("intentId must be a canonical membership checkout intent ID.");
  }
  return value;
}

function checkoutRecoveryDigest(intentId: string): string {
  return createHash("sha256")
    .update(requireCheckoutIntentId(intentId), "utf8")
    .digest("hex");
}

export function checkoutRecoveryOutboxId(intentId: string): string {
  return `checkout-recovery-email_${checkoutRecoveryDigest(intentId)}`;
}

export function checkoutRecoveryIdempotencyKey(intentId: string): string {
  return `membership-checkout-recovery/${checkoutRecoveryDigest(intentId)}/v1`;
}

function requireDisplayText(value: string, field: string): string {
  const normalised = value.trim().replace(/\s+/g, " ");
  if (!normalised || normalised.length > MAX_DISPLAY_TEXT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${field} must be non-empty plain text.`);
  }
  return normalised;
}

function requirePublicOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("publicOrigin must be an absolute HTTP(S) origin.");
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username || parsed.password || parsed.pathname !== "/" ||
    parsed.search || parsed.hash) {
    throw new Error("publicOrigin must be an absolute HTTP(S) origin.");
  }
  return parsed.origin;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function participantLabel(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function buildRecoveryHtml(input: Readonly<{
  planName: string;
  participantNames: readonly string[];
  ctaUrl: string;
}>): string {
  const planName = escapeHtml(input.planName);
  const participants = escapeHtml(participantLabel(input.participantNames));
  const ctaUrl = escapeHtml(input.ctaUrl);
  const tradingName = escapeHtml(COMPANY.tradingName);
  const legalName = escapeHtml(COMPANY.legalName);
  const supportEmail = escapeHtml(COMPANY.supportEmail);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark">
  <title>Restart your ${planName} checkout</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { padding: 28px 22px 34px !important; }
      .email-title { font-size: 40px !important; line-height: 42px !important; }
    }
  </style>
</head>
<body style="margin:0;background:#050505;color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Your signup did not complete. No payment was taken, and your place is available again.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;background:#050505;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;table-layout:fixed;box-sizing:border-box;background:#11100f;border:1px solid #302d2a;border-radius:24px;overflow:hidden;">
        <tr><td class="email-shell" style="padding:34px 34px 40px;overflow-wrap:anywhere;word-break:break-word;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.24em;line-height:18px;text-transform:uppercase;color:#a7f3d0;">ZERO ALPHA</div>
          <div style="height:1px;margin:22px 0 34px;background:#302d2a;font-size:0;line-height:0;">&nbsp;</div>
          <h1 class="email-title" style="margin:0 0 24px;color:#ffffff;font-family:Impact,'Arial Narrow',Arial,sans-serif;font-size:52px;font-weight:400;letter-spacing:0.2px;line-height:54px;text-transform:uppercase;">Your place is available again</h1>
          <p style="margin:0 0 18px;color:#f4f4f4;font-size:17px;line-height:1.65;">Your ${planName} sign-up for <strong>${participants}</strong> didn&#39;t complete.</p>
          <p style="margin:0 0 28px;color:#b7b7b9;font-size:16px;line-height:1.7;">No payment was taken and no membership was created. Your place is available again, so you can start a new sign-up whenever you are ready.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="border-radius:14px;background:#ffffff;">
            <a href="${ctaUrl}" style="display:block;padding:17px 22px;color:#050505;font-size:13px;font-weight:900;letter-spacing:0.12em;line-height:18px;text-decoration:none;text-transform:uppercase;">Restart my signup</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#d0d0d2;font-size:14px;line-height:1.65;">If you&#39;ve already restarted, no action is needed.</p>
          <div style="height:1px;margin:34px 0 22px;background:#302d2a;font-size:0;line-height:0;">&nbsp;</div>
          <p style="margin:0 0 12px;color:#8f8f93;font-size:12px;line-height:1.65;">If you did not expect this email, you can ignore it. Questions? Contact ${supportEmail}.</p>
          <p style="margin:0;color:#8f8f93;font-size:12px;line-height:1.65;">
          ${tradingName} · ${legalName} · Company ${escapeHtml(COMPANY.companyNumber)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildRecoveryText(input: Readonly<{
  planName: string;
  participantNames: readonly string[];
  ctaUrl: string;
}>): string {
  return `ZERO ALPHA

Your place is available again

Your ${input.planName} sign-up for ${participantLabel(input.participantNames)} didn't complete.

No payment was taken and no membership was created. Your place is available again, so you can start a new sign-up whenever you are ready.

Restart my signup: ${input.ctaUrl}

If you've already restarted, no action is needed.

If you did not expect this email, you can ignore it. Questions? Contact ${COMPANY.supportEmail}.

${COMPANY.tradingName} · ${COMPANY.legalName} · Company ${COMPANY.companyNumber}`;
}

export function buildCheckoutRecoveryPayload(
  input: CheckoutRecoveryEmailInput
): CheckoutRecoveryEmailPayload {
  const recipientEmail = canonicalizeCheckoutRecoveryEmail(input.recipientEmail);
  const fromEmail = canonicalizeCheckoutRecoveryEmail(input.fromEmail);
  if (!recipientEmail) throw new Error("recipientEmail must be a valid email address.");
  if (!fromEmail) throw new Error("fromEmail must be a valid email address.");

  const planName = requireDisplayText(input.planName, "planName");
  if (!Array.isArray(input.participantFullNames) ||
    input.participantFullNames.length === 0 ||
    input.participantFullNames.length > 10) {
    throw new Error("participantFullNames must contain between one and ten names.");
  }
  const participantNames = input.participantFullNames.map((name, index) =>
    requireDisplayText(name, `participantFullNames[${index}]`)
  );
  const publicOrigin = requirePublicOrigin(input.publicOrigin);
  const ctaUrl = new URL("/memberships", publicOrigin).toString();
  return Object.freeze({
    from: `${COMPANY.tradingName} <${fromEmail}>`,
    to: Object.freeze([recipientEmail]) as readonly [string],
    reply_to: COMPANY.supportEmail,
    subject: `Your ${COMPANY.tradingName} signup is ready to restart`,
    text: buildRecoveryText({planName, participantNames, ctaUrl}),
    html: buildRecoveryHtml({planName, participantNames, ctaUrl}),
  });
}
