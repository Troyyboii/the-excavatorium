import { createProviderKeyHandler, type ProviderKeyDependencies } from "./index.ts";
import { decryptProviderKey, loadWrappingKeys } from "../_shared/provider-key-crypto.ts";
import type { AuthenticatedSupabase } from "../_shared/http.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const userId = "123e4567-e89b-12d3-a456-426614174000";
const apiKey = "sk-proj-TESTKEYTESTKEYTESTKEY1234";
const envValues: Record<string, string> = {
  PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({
    "1": btoa(String.fromCharCode(...new Uint8Array(32).fill(3))),
  }),
  PROVIDER_KEY_ACTIVE_VERSION: "1",
};

type Call = { fn: string; args: Record<string, unknown> | undefined; client: "user" | "trusted" };

function harness(
  options: {
    signedIn?: boolean;
    env?: Record<string, string>;
    trusted?: boolean;
    rpcError?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const rpcFor = (client: "user" | "trusted") => ({
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args, client });
      return Promise.resolve(
        options.rpcError
          ? { data: null, error: { message: `boom ${apiKey}` } }
          : { data: {}, error: null },
      );
    },
  });
  const dependencies: ProviderKeyDependencies = {
    authenticate: () =>
      Promise.resolve(
        options.signedIn === false
          ? null
          : ({
              client: rpcFor("user"),
              user: { id: userId },
              authorization: "Bearer jwt",
            } as unknown as AuthenticatedSupabase),
      ),
    trustedClient: () =>
      options.trusted === false
        ? null
        : (rpcFor("trusted") as unknown as AuthenticatedSupabase["client"]),
    getEnv: (name) => (options.env ?? envValues)[name],
  };
  return { calls, handler: createProviderKeyHandler(dependencies) };
}

function post(body: unknown): Request {
  return new Request("https://example.test/provider-key", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("saving stores ciphertext for the caller and never echoes the key", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ action: "set", apiKey }));
  const text = await response.text();
  assertEquals(response.status, 200);
  assertEquals(JSON.parse(text), { configured: true, last4: "1234", keyVersion: 1 });
  assertEquals(text.includes(apiKey), false);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.fn, "custodian_store_provider_credential");
  assertEquals(calls[0]?.client, "trusted");
  const args = calls[0]?.args as Record<string, unknown>;
  assertEquals(args.runtime_owner_id, userId);
  assertEquals(JSON.stringify(args).includes(apiKey), false);
  assertEquals(
    await decryptProviderKey(
      loadWrappingKeys((n) => envValues[n]),
      userId,
      String(args.ciphertext),
      1,
    ),
    apiKey,
  );
});

Deno.test("the owner is always the JWT user; a client-supplied owner is rejected", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ action: "set", apiKey, ownerId: "someone-else" }));
  assertEquals(response.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("unauthenticated callers are refused before any work", async () => {
  const { calls, handler } = harness({ signedIn: false });
  const response = await handler(post({ action: "set", apiKey }));
  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("malformed keys are rejected without echoing them", async () => {
  const { calls, handler } = harness();
  const bad = "not-a-key-but-looks-secret-9999";
  const response = await handler(post({ action: "set", apiKey: bad }));
  const text = await response.text();
  assertEquals(response.status, 400);
  assertEquals(text.includes(bad), false);
  assertEquals(calls.length, 0);
});

Deno.test("an unconfigured server never stores plaintext", async () => {
  const noCrypto = harness({ env: {} });
  const response = await noCrypto.handler(post({ action: "set", apiKey }));
  assertEquals(response.status, 503);
  assertEquals(noCrypto.calls.length, 0);
  const noTrusted = harness({ trusted: false });
  assertEquals((await noTrusted.handler(post({ action: "set", apiKey }))).status, 503);
  assertEquals(noTrusted.calls.length, 0);
});

Deno.test("a storage failure surfaces a generic error with no secret", async () => {
  const { handler } = harness({ rpcError: true });
  const response = await handler(post({ action: "set", apiKey }));
  const text = await response.text();
  assertEquals(response.status, 503);
  assertEquals(text.includes(apiKey), false);
  assertEquals(text.includes("boom"), false);
});

Deno.test("removal runs as the caller, not the service role", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ action: "remove" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { configured: false });
  assertEquals(
    calls.map((c) => [c.fn, c.client]),
    [["custodian_remove_provider_credential", "user"]],
  );
});

Deno.test("oversized, non-JSON and non-POST requests are refused", async () => {
  const { handler } = harness();
  assertEquals((await handler(post("x".repeat(3000)))).status, 413);
  assertEquals((await handler(post("{not json"))).status, 400);
  assertEquals((await handler(new Request("https://example.test/provider-key"))).status, 405);
});
