import {resolveParticipantFullNames} from "./membershipPresentation";

describe("resolveParticipantFullNames", () => {
  it("keeps legitimate same-name siblings in the ordered projection", () => {
    expect(resolveParticipantFullNames("Alex Child", [
      "Alex Child",
      "Alex Child",
    ], 2)).toEqual(["Alex Child", "Alex Child"]);
  });

  it("falls back to the primary name when the plural projection is malformed", () => {
    expect(resolveParticipantFullNames("Primary Child", [
      "Different Child",
      "",
    ])).toEqual(["Primary Child"]);
  });

  it("falls back when the legacy primary is not projection index zero", () => {
    expect(resolveParticipantFullNames("Primary Child", [
      "Sibling Child",
      "Primary Child",
    ], 2)).toEqual(["Primary Child"]);
  });

  it("falls back when a valid projected participant count does not match", () => {
    expect(resolveParticipantFullNames("Primary Child", [
      "Primary Child",
    ], 2)).toEqual(["Primary Child"]);
    expect(resolveParticipantFullNames("Primary Child", [
      "Primary Child",
      "Sibling Child",
    ], 3)).toEqual(["Primary Child"]);
  });

  it("accepts a complete ordered projection when participant count is valid", () => {
    expect(resolveParticipantFullNames("Primary Child", [
      "Primary Child",
      "Sibling Child",
    ], 2)).toEqual(["Primary Child", "Sibling Child"]);
  });
});
