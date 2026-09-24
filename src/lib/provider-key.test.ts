import { describe, expect, test } from "bun:test";
import {
  parseProviderKeyStatus,
  removeProviderKey,
  saveProviderKey,
  type FunctionsClient,
} from "./provider-key";

const secret = "sk-proj-TESTKEYTESTKEYTESTKEY1234";

function client(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const fake: FunctionsClient = {
    functions: {
      invoke(name, options) {
        calls.push({ name, body: options.body });
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      },
    },
  };
  return { fake, calls };
}

describe("provider key client", () => {
  test("saving sends the key only to the provider-key function and returns masked metadata", async () => {
    const { fake, calls } = client({ data: { configured: true, last4: "1234", keyVersion: 1 } });
    const status = await saveProviderKey(secret, fake);
    expect(calls).toEqual([{ name: "provider-key", body: { action: "set", apiKey: secret } }]);
    expect(status).toEqual({ configured: true, last4: "1234", keyVersion: 1, updatedAt: null });
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  test("a failed save throws a message that does not contain the key", async () => {
    const { fake } = client({ error: new Error(`boom ${secret}`) });
    let message = "";
    try {
      await saveProviderKey(secret, fake);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("The key could not be saved.");
    expect(message).not.toContain(secret);
  });

  test("removal calls the function with no key", async () => {
    const { fake, calls } = client({ data: { configured: false } });
    await removeProviderKey(fake);
    expect(calls).toEqual([{ name: "provider-key", body: { action: "remove" } }]);
  });

  test("status parsing accepts only masked, non-secret fields", () => {
    expect(parseProviderKeyStatus({ configured: false })).toEqual({ configured: false });
    expect(
      parseProviderKeyStatus({ configured: true, last4: "abcd", key_version: 2, updated_at: "x" }),
    ).toEqual({ configured: true, last4: "abcd", keyVersion: 2, updatedAt: "x" });
    expect(() => parseProviderKeyStatus({ configured: true, last4: secret })).toThrow();
    expect(() => parseProviderKeyStatus(null)).toThrow();
  });

  test("the client module never touches browser storage", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./provider-key.ts", import.meta.url), "utf8");
    // Comments describe the contract; check only executable lines.
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./);
  });
});
