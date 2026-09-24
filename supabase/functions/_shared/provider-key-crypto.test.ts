import {
  decryptProviderKey,
  encryptProviderKey,
  isPlausibleOpenAiKey,
  loadWrappingKeys,
  ProviderKeyCryptoError,
} from "./provider-key-crypto.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertRejectsWith(code: string, run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ProviderKeyCryptoError) || error.code !== code) {
      throw new Error(`Expected ${code}, got ${String(error)}`);
    }
    return error;
  }
  throw new Error(`Expected rejection with ${code}`);
}

function b64(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const apiKey = "sk-proj-TESTKEYTESTKEYTESTKEY1234";

function env(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

const wrapping = loadWrappingKeys(
  env({
    PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({ "1": b64(1), "2": b64(2) }),
    PROVIDER_KEY_ACTIVE_VERSION: "2",
  }),
);

Deno.test("a key round-trips and exposes only a masked last four", async () => {
  const sealed = await encryptProviderKey(wrapping, ownerA, apiKey);
  assertEquals(sealed.keyVersion, 2);
  assertEquals(sealed.last4, "1234");
  assertEquals(sealed.ciphertext.includes(apiKey), false);
  assertEquals(sealed.ciphertext.includes("sk-"), false);
  assertEquals(await decryptProviderKey(wrapping, ownerA, sealed.ciphertext, 2), apiKey);
});

Deno.test("every encryption uses a fresh nonce", async () => {
  const one = await encryptProviderKey(wrapping, ownerA, apiKey);
  const two = await encryptProviderKey(wrapping, ownerA, apiKey);
  assertEquals(one.ciphertext === two.ciphertext, false);
});

Deno.test("a ciphertext cannot be decrypted for another owner", async () => {
  const sealed = await encryptProviderKey(wrapping, ownerA, apiKey);
  await assertRejectsWith("decrypt_failed", () =>
    decryptProviderKey(wrapping, ownerB, sealed.ciphertext, 2),
  );
});

Deno.test("a ciphertext cannot be replayed under a different key version", async () => {
  const sealed = await encryptProviderKey(wrapping, ownerA, apiKey);
  await assertRejectsWith("decrypt_failed", () =>
    decryptProviderKey(wrapping, ownerA, sealed.ciphertext, 1),
  );
});

Deno.test("tampering and malformed ciphertext fail closed without echoing anything", async () => {
  const sealed = await encryptProviderKey(wrapping, ownerA, apiKey);
  const flipped = sealed.ciphertext[10] === "A" ? "B" : "A";
  const tampered = sealed.ciphertext.slice(0, 10) + flipped + sealed.ciphertext.slice(11);
  const error = await assertRejectsWith("decrypt_failed", () =>
    decryptProviderKey(wrapping, ownerA, tampered, 2),
  );
  assertEquals(error.message.includes(apiKey), false);
  await assertRejectsWith("decrypt_failed", () => decryptProviderKey(wrapping, ownerA, "!!!", 2));
  await assertRejectsWith("unknown_key_version", () =>
    decryptProviderKey(wrapping, ownerA, sealed.ciphertext, 9),
  );
});

Deno.test("only plausible OpenAI key shapes are accepted", async () => {
  assertEquals(isPlausibleOpenAiKey(apiKey), true);
  for (const bad of [
    "",
    "sk-",
    "sk-short",
    `pk-${"x".repeat(30)}`,
    `sk-has space ${"x".repeat(20)}`,
  ]) {
    assertEquals(isPlausibleOpenAiKey(bad), false);
  }
  await assertRejectsWith("invalid_key_format", () => encryptProviderKey(wrapping, ownerA, "nope"));
});

Deno.test("wrapping keys must be configured, 32 bytes, and include the active version", () => {
  for (const values of [
    {},
    { PROVIDER_KEY_ENCRYPTION_KEYS: "{", PROVIDER_KEY_ACTIVE_VERSION: "1" },
    {
      PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({ "1": btoa("short") }),
      PROVIDER_KEY_ACTIVE_VERSION: "1",
    },
    {
      PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({ "1": b64(1) }),
      PROVIDER_KEY_ACTIVE_VERSION: "2",
    },
  ]) {
    try {
      loadWrappingKeys(env(values));
    } catch (error) {
      assertEquals(error instanceof ProviderKeyCryptoError, true);
      assertEquals((error as ProviderKeyCryptoError).code, "crypto_not_configured");
      continue;
    }
    throw new Error("Expected loadWrappingKeys to reject");
  }
});
