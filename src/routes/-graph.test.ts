import { describe, expect, it, test } from "bun:test";
import { getGraphLinkReadState, graphLinkEvidenceLabel } from "../lib/graph-read-state";

describe("graph link read state", () => {
  test("does not present pending, failed, or cold-offline link reads as an empty graph", () => {
    expect(getGraphLinkReadState({ pending: true, error: null, coldOffline: false })).toBe(
      "pending",
    );
    expect(
      getGraphLinkReadState({
        pending: false,
        error: new Error("read failed"),
        coldOffline: false,
      }),
    ).toBe("error");
    expect(getGraphLinkReadState({ pending: true, error: null, coldOffline: true })).toBe(
      "cold-offline",
    );
  });

  test("marks a completed successful link read as ready", () => {
    expect(getGraphLinkReadState({ pending: false, error: null, coldOffline: false })).toBe(
      "ready",
    );
  });
});

describe("graph accessible link evidence", () => {
  it("never reports unavailable or pending evidence as zero links", () => {
    expect(graphLinkEvidenceLabel("pending", 0)).toContain("being retrieved");
    expect(graphLinkEvidenceLabel("error", 0)).toContain("unavailable");
    expect(graphLinkEvidenceLabel("cold-offline", 0)).toContain("no cached");
    expect(graphLinkEvidenceLabel("ready", 3)).toBe("3 persisted links");
  });
});
