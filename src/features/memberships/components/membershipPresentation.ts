import {YOUTH_FAMILY_OFFER} from "../../../lib/membershipPlans";

function comparableName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

/**
 * Prefer the versioned multi-participant projection only when it is complete
 * and still begins with the legacy primary participant. Malformed projections
 * fall back to the scalar field instead of hiding or inventing a child.
 */
export function resolveParticipantFullNames(
  participantFullName: string,
  participantFullNames?: string[],
  participantCount?: number
): string[] {
  const primary = participantFullName.trim();
  if (!Array.isArray(participantFullNames) ||
    participantFullNames.length < 1 ||
    participantFullNames.length > YOUTH_FAMILY_OFFER.maximumParticipants) {
    return primary ? [primary] : [];
  }

  const names = participantFullNames.map((name) =>
    typeof name === "string" ? name.trim().replace(/\s+/g, " ") : ""
  );
  const comparableNames = names.map(comparableName);
  const projectedParticipantCountIsValid = Number.isInteger(participantCount) &&
    (participantCount ?? 0) >= 1 &&
    (participantCount ?? 0) <= YOUTH_FAMILY_OFFER.maximumParticipants;
  const projectedNamesAreValid = names.every((name) =>
    name.length >= 2 && name.length <= 160
  ) && comparableNames[0] === comparableName(primary) &&
    (!projectedParticipantCountIsValid || names.length === participantCount);

  return projectedNamesAreValid ? names : primary ? [primary] : [];
}
