// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { emptyToolData, type ArchiveRecord } from "@/lib/types";
import { CaseScopePicker } from "./case-scope-picker";

afterEach(cleanup);

const records: ArchiveRecord[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    recordType: "tool",
    title: "First archive record",
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-09-04T09:00:00.000Z",
    updatedAt: "2026-09-04T09:01:00.000Z",
    recordData: emptyToolData,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    recordType: "tool",
    title: "Second archive record",
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:01:00.000Z",
    recordData: emptyToolData,
  },
];

function PickerHarness({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return <CaseScopePicker all={records} value={value} onChange={setValue} />;
}

describe("Case archive scope picker", () => {
  test("keeps selected archive records in owner-selected order", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);
    await user.click(screen.getByRole("button", { name: /Select archive records/ }));

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    expect(screen.getByRole("button", { name: /2 archive records selected/ })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove archive record Second archive record" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove archive record Second archive record" })
        .parentElement?.className,
    ).toContain("shrink-0");
  });

  test("keeps a selected record visible when it is absent from the current snapshot", () => {
    render(
      <CaseScopePicker
        all={records}
        value={["33333333-3333-4333-8333-333333333333"]}
        onChange={mock()}
      />,
    );

    expect(
      screen.getByText(/Unavailable record 33333333-3333-4333-8333-333333333333/),
    ).not.toBeNull();
  });
});
