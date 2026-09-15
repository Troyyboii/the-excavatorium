// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { CaseReadingSurface } from "./case-reading";

afterEach(cleanup);

describe("Case Reading admission display", () => {
  test("shows the derived reason for an unavailable selected record", () => {
    render(
      <CaseReadingSurface
        scope={{ recordIds: ["missing-record"], freeTextContext: "" }}
        archiveRecords={[]}
        archiveReady
      />,
    );

    expect(
      screen.getByText(
        /Selected in the Case archive scope, but unavailable in this archive snapshot\./,
      ),
    ).not.toBeNull();
  });
});
