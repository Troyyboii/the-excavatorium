// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const saved: Array<Record<string, unknown>> = [];
mock.module("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}));
mock.module("@/lib/archive", () => ({
  useArchive: () => ({ data: { records: [] }, isPending: false }),
  useSaveRecord: () => ({
    mutateAsync: (input: Record<string, unknown>) => {
      saved.push(input);
      return Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" });
    },
  }),
  useDeleteRecord: () => ({ mutateAsync: () => Promise.resolve() }),
}));
mock.module("@/hooks/use-online", () => ({ useOnlineStatus: () => true }));

import { RecordForm } from "./record-form";

afterEach(() => {
  cleanup();
  saved.length = 0;
});

function renderConversation() {
  render(<RecordForm recordType="conversation" existing={null} allRecords={[]} allLinks={[]} />);
  fireEvent.click(screen.getByText("Write manually"));
}

describe("conversation form", () => {
  test("saves with a blank route as null, and never runs document validation", async () => {
    renderConversation();
    fireEvent.change(screen.getByLabelText("Title", { exact: false }), {
      target: { value: "Plain conversation" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(document.body.textContent).not.toContain("originalFileName");
    const data = saved[0].recordData as Record<string, unknown>;
    expect(data.projectRoute).toBeNull();
  });

  test("saves an arbitrary owner-defined route, trimmed", async () => {
    renderConversation();
    fireEvent.change(screen.getByLabelText("Title", { exact: false }), {
      target: { value: "Routed conversation" },
    });
    fireEvent.change(screen.getByLabelText("Project route"), {
      target: { value: "  Kitchen renovation " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect((saved[0].recordData as Record<string, unknown>).projectRoute).toBe(
      "Kitchen renovation",
    );
  });
});
