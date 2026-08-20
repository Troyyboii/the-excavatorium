// Bun supplies this module at test runtime; it is not part of the app's TypeScript type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InboxIntake, type InboxCreatePayload } from "./inbox-intake";

afterEach(() => cleanup());

const FORBIDDEN_GENERIC_COPY = /GitHub|Context7|record ID|clipboard|mobile.?share/i;

function renderIntake(onCreate?: (payload: InboxCreatePayload) => Promise<unknown> | unknown) {
  return render(<InboxIntake onCreate={onCreate} />);
}

function statusContaining(text: string) {
  const status = screen
    .getAllByRole("status")
    .find((element) => (element.textContent ?? "").includes(text));
  if (!status) throw new Error(`No status contained ${text}`);
  return status;
}

async function fillThought({ title = "A useful thought", content = "Capture this idea." } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Short title for review"), title);
  await user.type(
    screen.getByPlaceholderText("Write or paste what you want to review before saving."),
    content,
  );
  await user.click(screen.getByRole("button", { name: "Continue to review" }));
  return user;
}

describe("InboxIntake progressive capture", () => {
  test("offers only the four generic capture types and no connector copy", () => {
    renderIntake();

    const typeSelect = screen.getByRole("combobox", { name: "Type" });
    expect(
      Array.from((typeSelect as HTMLSelectElement).options).map((option) => option.textContent),
    ).toEqual(["Thought", "Link", "Conversation", "Document"]);
    expect(document.body.textContent ?? "").not.toMatch(FORBIDDEN_GENERIC_COPY);
    expect(
      screen
        .getByPlaceholderText("Write or paste what you want to review before saving.")
        .getAttribute("placeholder"),
    ).not.toMatch(FORBIDDEN_GENERIC_COPY);
  });

  test("rejects a blank draft without opening review or persisting", async () => {
    const onCreate = mock(() => Promise.resolve());
    renderIntake(onCreate);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to review" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Review capture" })).toBeNull();
    expect(
      statusContaining("Add a thought, link, conversation, or document").textContent,
    ).toContain("Add a thought, link, conversation, or document");
  });

  test("keeps a valid candidate local until Save to Inbox and preserves it when editing back", async () => {
    const onCreate = mock(() => Promise.resolve());
    const user = userEvent.setup();
    renderIntake(onCreate);

    await user.type(screen.getByPlaceholderText("Short title for review"), "Draft title");
    await user.type(
      screen.getByPlaceholderText("Write or paste what you want to review before saving."),
      "Draft content",
    );
    await user.click(screen.getByRole("button", { name: "Continue to review" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review capture" })).not.toBeNull();
    expect(screen.getByText("Nothing has been saved yet.")).not.toBeNull();
    expect(screen.getByText("Draft content")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to edit" }));

    expect(screen.queryByRole("heading", { name: "Review capture" })).toBeNull();
    expect((screen.getByPlaceholderText("Short title for review") as HTMLInputElement).value).toBe(
      "Draft title",
    );
    expect(
      (
        screen.getByPlaceholderText(
          "Write or paste what you want to review before saving.",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Draft content");
  });

  test("maps Link to the existing url backend kind while preserving other kinds", async () => {
    const onCreate = mock(() => Promise.resolve());
    const user = userEvent.setup();
    renderIntake(onCreate);

    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "link");
    await user.type(
      screen.getByPlaceholderText("Write or paste what you want to review before saving."),
      "https://example.com",
    );
    await user.click(screen.getByRole("button", { name: "Continue to review" }));
    await user.click(screen.getByRole("button", { name: "Save to Inbox" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      sourceKind: "url",
      title: "",
      content: "https://example.com",
    });
  });

  test("preserves the backend kind for Thought, Conversation, and Document", async () => {
    for (const [captureKind, sourceKind] of [
      ["thought", "thought"],
      ["conversation", "conversation"],
      ["document", "document"],
    ] as const) {
      const onCreate = mock(() => Promise.resolve());
      const user = userEvent.setup();
      renderIntake(onCreate);

      await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), captureKind);
      await user.type(
        screen.getByPlaceholderText("Write or paste what you want to review before saving."),
        `${captureKind} content`,
      );
      await user.click(screen.getByRole("button", { name: "Continue to review" }));
      await user.click(screen.getByRole("button", { name: "Save to Inbox" }));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      expect(onCreate).toHaveBeenCalledWith({
        sourceKind,
        title: "",
        content: `${captureKind} content`,
      });
      cleanup();
    }
  });

  test("allows only one save while the persistence request is pending", async () => {
    let resolveSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onCreate = mock(() => pendingSave);
    renderIntake(onCreate);
    await fillThought();

    const save = screen.getByRole("button", { name: "Save to Inbox" });
    fireEvent.click(save);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(save.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveSave();
      await pendingSave;
    });
    expect(screen.queryByRole("heading", { name: "Review capture" })).toBeNull();
  });

  test("keeps the candidate after a failed save and permits a retry", async () => {
    const onCreate = mock()
      .mockRejectedValueOnce(new Error("temporary inbox failure"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderIntake(onCreate);
    await fillThought({ content: "Retryable content" });

    await user.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await waitFor(() =>
      expect(statusContaining("temporary inbox failure").textContent).toContain(
        "temporary inbox failure",
      ),
    );
    expect(screen.getByRole("heading", { name: "Review capture" })).not.toBeNull();
    expect(screen.getByText("Retryable content")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Review capture" })).toBeNull(),
    );
  });

  test("resets the capture form only after a successful save", async () => {
    const onCreate = mock(() => Promise.resolve());
    const user = userEvent.setup();
    renderIntake(onCreate);
    await fillThought({ title: "Saved title", content: "Saved content" });
    await user.click(screen.getByRole("button", { name: "Save to Inbox" }));

    await waitFor(() =>
      expect(statusContaining("Saved to Inbox.").textContent).toContain("Saved to Inbox."),
    );
    expect(screen.queryByRole("heading", { name: "Review capture" })).toBeNull();
    expect((screen.getByPlaceholderText("Short title for review") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (
        screen.getByPlaceholderText(
          "Write or paste what you want to review before saving.",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });
});
