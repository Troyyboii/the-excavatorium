// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
  RouterProvider,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./app-shell";

const DESTINATIONS = [
  "/",
  "/archive",
  "/cases",
  "/approvals",
  "/advanced",
  "/run-room",
  "/settings",
  "/search",
  "/conversations/new",
  "/tools/new",
  "/repositories/new",
  "/decisions/new",
  "/documents/new",
] as const;
afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  cleanup();
});
async function renderShell() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const noScroll = () => undefined;
  window.scrollTo = noScroll;
  globalThis.scrollTo = noScroll;
  const rootRoute = createRootRoute({
    component: () => (
      <AppShell email="owner@example.test">
        <Outlet />
      </AppShell>
    ),
  });
  const routeTree = rootRoute.addChildren(
    DESTINATIONS.map((path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => <div>Route content</div>,
      }),
    ),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy());
}

describe("Excavatorium shell", () => {
  test("uses canonical desktop destinations and keeps secondary routes under More", async () => {
    const user = userEvent.setup();
    await renderShell();
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Home", "/"],
      ["Archive", "/archive"],
      ["Investigations", "/cases"],
      ["Review", "/approvals"],
    ]);
    expect(screen.getByRole("link", { name: "Search Archive" }).getAttribute("href")).toBe(
      "/search",
    );
    await user.click(within(primary).getByRole("button", { name: "More destinations" }));
    const more = screen.getByRole("menu", { name: "More destinations" });
    expect(
      within(more)
        .getByRole("menuitem", { name: /Settings/ })
        .getAttribute("href"),
    ).toBe("/settings");
    expect(
      within(more)
        .getByRole("menuitem", { name: /Advanced/ })
        .getAttribute("href"),
    ).toBe("/advanced");
    expect(within(more).getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });
  test("keeps the mobile bar to Home, Archive, Add, Investigations, and Review", async () => {
    await renderShell();
    const mobile = screen.getByRole("navigation", { name: "Mobile primary" });
    expect(within(mobile).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(within(mobile).getByRole("link", { name: "Archive" }).getAttribute("href")).toBe(
      "/archive",
    );
    expect(within(mobile).getByRole("button", { name: "Add or capture material" })).toBeTruthy();
    expect(within(mobile).getByRole("link", { name: "Investigations" }).getAttribute("href")).toBe(
      "/cases",
    );
    expect(within(mobile).getByRole("link", { name: "Review" }).getAttribute("href")).toBe(
      "/approvals",
    );
  });
  test("opens a non-mutating Capture first choice and closes it with Escape", async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getAllByRole("button", { name: "Add or capture material" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Choose an action" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close capture");
    expect(within(dialog).getByRole("button", { name: /Capture material/ })).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: /Start an Investigation/ })
        .getAttribute("href"),
    ).toBe("/cases");
    expect(screen.getByText("Route content")).toBeTruthy();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement?.textContent).toContain("Start an Investigation");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose an action" })).toBeNull(),
    );
  });
});
