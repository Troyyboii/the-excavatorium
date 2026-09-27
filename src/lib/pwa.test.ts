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

  test("precaches the Night Crypt Custodian character assets used by the UI", async () => {
    const source = await Bun.file("public/sw.js").text();
    expect(source).toContain("excavatorium-static-v4-night-crypt");
    expect(source).toContain('"/character/custodian-cutout.webp"');
    expect(source).toContain('"/character/custodian-portrait.webp"');
    expect(source).toContain('"/character/custodian-lantern.webp"');
    expect(source).not.toContain('"/character/00-custodian-canon.png"');
  });
});
