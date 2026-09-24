import { encryptProviderKey, loadWrappingKeys } from "../_shared/provider-key-crypto.ts";
import { parseStoredCredential, resolveOwnerProviderKey } from "./owner-provider-key.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const apiKey = "sk-proj-TESTKEYTESTKEYTESTKEY1234";
const envValues: Record<string, string> = {
  PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({
    "1": btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  }),
  PROVIDER_KEY_ACTIVE_VERSION: "1",
};
const getEnv = (name: string) => envValues[name];

Deno.test("the owner's own stored key is decrypted for that owner", async () => {
  const sealed = await encryptProviderKey(loadWrappingKeys(getEnv), ownerA, apiKey);
  const result = await resolveOwnerProviderKey({
    ownerId: ownerA,
    getEnv,
    fetchCredential: () => Promise.resolve({ ciphertext: sealed.ciphertext, keyVersion: 1 }),
  });
  assertEquals(result, { status: "ok", apiKey });
});

Deno.test("another owner's ciphertext never yields a key, even if mis-served", async () => {
  const sealed = await encryptProviderKey(loadWrappingKeys(getEnv), ownerA, apiKey);
  const result = await resolveOwnerProviderKey({
    ownerId: ownerB,
    getEnv,
    fetchCredential: () => Promise.resolve({ ciphertext: sealed.ciphertext, keyVersion: 1 }),
  });
  assertEquals(result, { status: "unreadable" });
});

Deno.test("the lookup is requested for exactly the given owner", async () => {
  const asked: string[] = [];
  await resolveOwnerProviderKey({
    ownerId: ownerB,
    getEnv,
    fetchCredential: (owner) => {
      asked.push(owner);
      return Promise.resolve(null);
    },
  });
  assertEquals(asked, [ownerB]);
});

Deno.test("no row means missing; failures and unconfigured crypto mean unreadable", async () => {
  assertEquals(
    await resolveOwnerProviderKey({
      ownerId: ownerA,
      getEnv,
      fetchCredential: () => Promise.resolve(null),
    }),
    { status: "missing" },
  );
  assertEquals(
    await resolveOwnerProviderKey({
      ownerId: ownerA,
      getEnv,
      fetchCredential: () => Promise.reject(new Error(`db down ${apiKey}`)),
    }),
    { status: "unreadable" },
  );
  const sealed = await encryptProviderKey(loadWrappingKeys(getEnv), ownerA, apiKey);
  const result = await resolveOwnerProviderKey({
    ownerId: ownerA,
    getEnv: () => undefined,
    fetchCredential: () => Promise.resolve({ ciphertext: sealed.ciphertext, keyVersion: 1 }),
  });
  assertEquals(result, { status: "unreadable" });
  assertEquals(JSON.stringify(result).includes(apiKey), false);
});

Deno.test("stored credential rows are validated", () => {
  assertEquals(parseStoredCredential(null), null);
  assertEquals(parseStoredCredential({ ciphertext: "abc", key_version: 1 }), {
    ciphertext: "abc",
    keyVersion: 1,
  });
  for (const bad of [
    "x",
    [],
    {},
    { ciphertext: "", key_version: 1 },
    { ciphertext: "a", key_version: 0 },
  ]) {
    assertEquals(parseStoredCredential(bad), "malformed");
  }
});
