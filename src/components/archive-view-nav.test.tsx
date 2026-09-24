// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { ArchiveViewNav } from "./archive-view-nav";

afterEach(cleanup);

describe("Archive view navigation", () => {
  test("keeps Browse, Connections, Timeline, and Search within the Archive", async () => {
    const root = createRootRoute({
      component: () => (
        <>
          <ArchiveViewNav active="connections" />
          <Outlet />
        </>
      ),
    });
    const routes = ["/", "/archive", "/graph", "/timeline", "/search"].map((path) =>
      createRoute({
        getParentRoute: () => root,
        path,
        component: () => <p>Archive view</p>,
      }),
    );
    const router = createRouter({
      routeTree: root.addChildren(routes),
      history: createMemoryHistory({ initialEntries: ["/graph"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText("Archive view")).toBeTruthy());

    const nav = screen.getByRole("navigation", { name: "Archive views" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Browse", "/archive"],
      ["Connections", "/graph"],
      ["Timeline", "/timeline"],
      ["Search", "/search"],
    ]);
    expect(
      within(nav).getByRole("link", { name: "Connections" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
