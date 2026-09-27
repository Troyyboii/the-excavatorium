// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CRYPT_GLYPHS, CryptIcon } from "./crypt-icon";

describe("CryptIcon", () => {
  test("covers the 22-glyph Night Crypt set", () => {
    expect(CRYPT_GLYPHS.length).toBe(22);
    for (const glyph of CRYPT_GLYPHS) {
      const html = renderToStaticMarkup(<CryptIcon glyph={glyph} />);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toMatch(/<(path|circle|rect) /);
    }
  });

  test("matches the handoff SVGs when they are present", () => {
    let files: string[] = [];
    try {
      files = readdirSync("night-crypt/icons").filter((file) => file.endsWith(".svg"));
    } catch {
      return;
    }
    expect([...CRYPT_GLYPHS].sort()).toEqual(files.map((file) => file.slice(0, -4)).sort());
  });

  test("is decorative by default and labelled only on request", () => {
    const decorative = renderToStaticMarkup(<CryptIcon glyph="skull" size={32} />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).toContain('width="32"');
    expect(decorative).toContain('stroke="currentColor"');
    const labelled = renderToStaticMarkup(<CryptIcon glyph="skull" label="Uncertain" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Uncertain"');
    expect(labelled).not.toContain("aria-hidden");
  });
});
