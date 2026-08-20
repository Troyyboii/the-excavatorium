// Bun supplies this module at test runtime; it is not part of the app's TypeScript type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

mock.module("@/lib/archive", () => ({
  useArchive: () => ({
    data: { records: [] },
    isPending: false,
  }),
}));

import { CommandPalette } from "./command-palette";

afterEach(() => {
  window.innerWidth = 1024;
  cleanup();
});

async function verifyResponsiveShortcut(width: number) {
  window.innerWidth = width;
  const user = userEvent.setup();
  render(
    <>
      <CommandPalette shortcutScope="mobile" />
      <CommandPalette shortcutScope="desktop" />
    </>,
  );

  fireEvent.keyDown(window, { key: "k", ctrlKey: true });

  await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1));
  const activeTrigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Open Custodian command palette"][aria-expanded="true"]',
  );
  expect(activeTrigger).not.toBeNull();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(activeTrigger));
}

describe("CommandPalette", () => {
  test("returns focus to the trigger when the dialog closes", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    const trigger = screen.getByRole("button", { name: "Open Custodian command palette" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).not.toBeNull();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("opens one desktop dialog and restores its trigger focus", () =>
    verifyResponsiveShortcut(1024));

  test("opens one mobile dialog and restores its trigger focus", () =>
    verifyResponsiveShortcut(390));
});
