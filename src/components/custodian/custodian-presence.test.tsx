// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CUSTODIAN_CUTOUT_SRC,
  CUSTODIAN_LANTERN_SRC,
  CUSTODIAN_PORTRAIT_SRC,
  CustodianLine,
  CustodianNiche,
  CustodianPortrait,
} from "./custodian-presence";

describe("Night Crypt Custodian", () => {
  test("points at shipped crops", () => {
    for (const src of [CUSTODIAN_CUTOUT_SRC, CUSTODIAN_PORTRAIT_SRC, CUSTODIAN_LANTERN_SRC]) {
      expect(existsSync(`public${src}`)).toBe(true);
    }
  });

  test("the niche keeps the cut-out inside the arch, with raven, plinth and candles", () => {
    const html = renderToStaticMarkup(<CustodianNiche />);
    expect(html).toMatch(/<div aria-hidden="true" class="flex select-none/);
    expect(html).toContain(CUSTODIAN_CUTOUT_SRC);
    expect(html).toContain("custodian-niche-well");
    expect(html).toContain("The Custodian");
    expect(html.match(/<svg/g)?.length).toBe(3);
  });

  test("the portrait is a decorative circle", () => {
    const html = renderToStaticMarkup(<CustodianPortrait size={48} ring="candle" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("object-[60%_30%]");
    expect(html).toContain("width:48px");
  });

  test("narration is set in italic", () => {
    const html = renderToStaticMarkup(<CustodianLine>Nothing stirs.</CustodianLine>);
    expect(html).toContain("font-serif italic");
    expect(html).toContain("Nothing stirs.");
  });
});
