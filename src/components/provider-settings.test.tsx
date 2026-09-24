// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OPENAI_MODEL_IDS } from "@/lib/openai-models";
import { ProviderSection } from "./provider-settings";

afterEach(() => cleanup());

const secret = "sk-proj-TESTKEYTESTKEYTESTKEY1234";

// supabase.functions is a getter that builds a new client per access, so it can
// not be spied on; replace the accessor on the instance for the test's duration.
function stubFunctions(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const fake = {
    invoke: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  Object.defineProperty(supabase, "functions", { configurable: true, get: () => fake });
  return {
    calls,
    restore: () => {
      delete (supabase as unknown as Record<string, unknown>).functions;
    },
  };
}

function renderSection() {
  const toasts: string[] = [];
  const errors: Array<string | null> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProviderSection setToast={(m) => toasts.push(m)} setError={(m) => errors.push(m)} />
    </QueryClientProvider>,
  );
  return { toasts, errors };
}

describe("ProviderSection", () => {
  test("explains that the archive is free and lists exactly the six catalog models", () => {
    renderSection();
    expect(screen.getByText(/free to use without a key/i)).toBeTruthy();
    const select = screen.getByLabelText("Custodian model") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value).filter((v) => v !== "");
    expect(values.sort()).toEqual([...OPENAI_MODEL_IDS].sort());
  });

  test("the key field is a masked, non-autofilled password input", () => {
    renderSection();
    const input = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  test("saving sends the key once, clears the field, and persists nothing in the browser", async () => {
    const invoke = stubFunctions({
      data: { configured: true, last4: "1234", keyVersion: 1 },
      error: null,
    });
    const { toasts } = renderSection();
    const user = userEvent.setup();
    const input = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
    await user.type(input, secret);
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(toasts).toEqual(["API key saved"]));
    expect(invoke.calls).toEqual([["provider-key", { body: { action: "set", apiKey: secret } }]]);
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain(secret);
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        expect(String(store.getItem(String(store.key(i))))).not.toContain(secret);
      }
    }
    invoke.restore();
  });

  test("a failed save reports the server's safe message and still clears the field", async () => {
    const invoke = stubFunctions({ data: null, error: new Error("network") });
    const { errors } = renderSection();
    const user = userEvent.setup();
    const input = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
    await user.type(input, secret);
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(errors.at(-1)).toBe("The key could not be saved."));
    expect(input.value).toBe("");
    invoke.restore();
  });
});
