// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let records: unknown[] = [];
mock.module("@/lib/archive", () => ({
  useArchive: () => ({ data: { records }, isPending: false }),
}));

import { ProjectRouteField } from "./project-route-field";

afterEach(() => {
  cleanup();
  records = [];
});

describe("ProjectRouteField", () => {
  test("is an optional free-text field with a neutral placeholder and no preset routes", () => {
    render(<ProjectRouteField value={null} onChange={() => {}} />);
    const input = screen.getByLabelText("Project route") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Optional project, workspace, or route");
    expect(input.required).toBe(false);
    expect(document.querySelector("datalist")).toBeNull();
    const text = document.body.textContent ?? "";
    for (const value of ["The Forge", "The Chamber", "The Book", "General", "Do not preserve"]) {
      expect(text.includes(value)).toBe(false);
    }
  });

  test("reports typed text, and null when cleared", () => {
    const seen: Array<string | null> = [];
    const onChange = (value: string | null) => seen.push(value);
    const { rerender } = render(<ProjectRouteField value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Project route"), {
      target: { value: "Kitchen renovation" },
    });
    rerender(<ProjectRouteField value="Kitchen renovation" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Project route"), { target: { value: "" } });
    expect(seen).toEqual(["Kitchen renovation", null]);
  });

  test("shows an existing historical value exactly", () => {
    render(<ProjectRouteField value="The Forge" onChange={() => {}} />);
    expect((screen.getByLabelText("Project route") as HTMLInputElement).value).toBe("The Forge");
  });

  test("suggests only the owner's own existing routes", () => {
    records = [
      { recordType: "conversation", updatedAt: "2026-01-01", recordData: { projectRoute: "Mine" } },
    ];
    render(<ProjectRouteField value={null} onChange={() => {}} />);
    const options = [...document.querySelectorAll("datalist option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(["Mine"]);
  });
});
