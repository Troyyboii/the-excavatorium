// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CUSTODIAN_FIGURE_SRC, CustodianFigure } from "./custodian-figure";

describe("CustodianFigure", () => {
  test("points at shipped canonical assets", () => {
    expect(existsSync(`public${CUSTODIAN_FIGURE_SRC}`)).toBe(true);
    expect(existsSync("public/character/00-custodian-canon.png")).toBe(true);
  });

  test("is decorative and hidden below the lg breakpoint", () => {
    const html = renderToStaticMarkup(<CustodianFigure />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("hidden");
    expect(html).toContain("lg:block");
  });
});
