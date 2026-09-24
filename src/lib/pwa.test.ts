import { describe, expect, test } from "bun:test";

describe("service worker privacy boundary", () => {
  test("bypasses authenticated APIs and honors private cache controls", async () => {
    const source = await Bun.file("public/sw.js").text();
    expect(source).toContain('request.headers.has("authorization")');
    expect(source).toContain('"/auth/"');
    expect(source).toContain('"/functions/"');
    expect(source).toContain('"/rest/"');
    expect(source).toContain('"/rpc/"');
    expect(source).toContain('"/storage/"');
    expect(source).toContain('"/brand/excavatorium-lantern.png"');
    expect(source).toContain('"/brand/excavatorium-lantern-app-icon.png"');
    expect(source).toContain("no-store");
    expect(source).toContain("private");
  });
});
