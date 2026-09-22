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
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AppShell } from "./app-shell";

const DESTINATIONS = [
  "/",
  "/inbox",
  "/cases",
  "/run-room",
  "/archive",
  "/conversations",
  "/documents",
  "/repositories",
  "/decisions",
  "/graph",
  "/timeline",
  "/tools",
  "/search",
  "/settings",
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
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const scrollTo = () => undefined;
  window.scrollTo = scrollTo;
  globalThis.scrollTo = scrollTo;
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
        component: () => <div>Archive content</div>,
      }),
    ),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
  });
}

describe("primary navigation", () => {
  test("places Run Room in the desktop Work section and the mobile More menu", async () => {
    const user = userEvent.setup();
    await renderShell();

    const primary = screen.getByRole("navigation", { name: "Primary" });
    const workLinks = within(primary)
      .getAllByRole("link")
      .slice(0, 4)
      .map((link) => ({
        label: link.textContent,
        href: link.getAttribute("href"),
      }));
    expect(workLinks).toEqual([
      { label: "Custodian Desk", href: "/" },
      { label: "Inbox", href: "/inbox" },
      { label: "Cases", href: "/cases" },
      { label: "Run Room", href: "/run-room" },
    ]);
    expect(screen.getAllByRole("link", { name: "Run Room" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "More" }));

    const mobileNav = screen.getByRole("dialog", { name: "Browse archive" });
    const mobileRunRoom = within(mobileNav).getByRole("link", { name: "Run Room" });
    expect(mobileRunRoom.getAttribute("href")).toBe("/run-room");
    expect(screen.getAllByRole("link", { name: "Run Room" })).toHaveLength(2);
  });
});
