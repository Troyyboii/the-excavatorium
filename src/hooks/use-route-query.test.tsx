// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useRouteQuery } from "./use-route-query";

afterEach(cleanup);

function Harness({
  initialRouteQ = "",
  debounceMs = 30,
}: {
  initialRouteQ?: string;
  debounceMs?: number;
}) {
  const [routeQ, setRouteQ] = useState<string | undefined>(initialRouteQ || undefined);
  const [text, setQuery] = useRouteQuery(routeQ, setRouteQ, debounceMs);
  return (
    <div>
      <input aria-label="Query" value={text} onChange={(event) => setQuery(event.target.value)} />
      <output aria-label="Route q">{routeQ ?? ""}</output>
      <button type="button" onClick={() => setRouteQ("from-history")}>
        Simulate back
      </button>
      <button type="button" onClick={() => setRouteQ(undefined)}>
        Clear route
      </button>
    </div>
  );
}

describe("useRouteQuery", () => {
  test("updates the visible input immediately while typing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Query");
    await user.type(input, "lantern");
    expect(input).toHaveProperty("value", "lantern");
  });

  test("commits the route q after the debounce window", async () => {
    const user = userEvent.setup();
    render(<Harness debounceMs={40} />);
    await user.type(screen.getByLabelText("Query"), "crypt");
    expect(screen.getByLabelText("Route q").textContent).toBe("");
    await waitFor(() => expect(screen.getByLabelText("Route q").textContent).toBe("crypt"));
  });

  test("adopts a later route q change after the initial render", async () => {
    const user = userEvent.setup();
    render(<Harness initialRouteQ="first" />);
    expect(screen.getByLabelText("Query")).toHaveProperty("value", "first");
    await user.click(screen.getByRole("button", { name: "Simulate back" }));
    expect(screen.getByLabelText("Query")).toHaveProperty("value", "from-history");
    expect(screen.getByLabelText("Route q").textContent).toBe("from-history");
  });

  test("clears the input when the route q is removed", async () => {
    const user = userEvent.setup();
    render(<Harness initialRouteQ="vault" />);
    await user.click(screen.getByRole("button", { name: "Clear route" }));
    expect(screen.getByLabelText("Query")).toHaveProperty("value", "");
  });
});
