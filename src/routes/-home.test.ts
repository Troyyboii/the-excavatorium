import { describe, expect, test } from "bun:test";
import { homeAttentionCopy } from "./-home-helpers";

describe("Home attention copy", () => {
  test("states the quiet fact immediately after the atmospheric line", () => {
    expect(homeAttentionCopy(false)).toEqual({
      heading: "Nothing stirs.",
      explanation:
        "No archive records currently need your attention under the checks available here.",
    });
  });

  test("explains the persisted record conditions when attention exists", () => {
    expect(homeAttentionCopy(true).heading).toBe("Attention is needed.");
    expect(homeAttentionCopy(true).explanation).toContain("saved status and content");
    expect(homeAttentionCopy(true).explanation).toContain("matching reason");
  });
});
