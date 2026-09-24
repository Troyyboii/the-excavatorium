import {
  excavationFundingFromParts,
  excavationFundingMessage,
  resolveOwnerExcavationFunding,
} from "./owner-excavation-funding.ts";
import { encryptProviderKey, loadWrappingKeys } from "./provider-key-crypto.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ownerId = "11111111-1111-4111-8111-111111111111";
const apiKey = "sk-proj-TESTKEYTESTKEYTESTKEY1234";
const envValues: Record<string, string> = {
  PROVIDER_KEY_ENCRYPTION_KEYS: JSON.stringify({
    "1": btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  }),
  PROVIDER_KEY_ACTIVE_VERSION: "1",
};
const getEnv = (name: string) => envValues[name];

Deno.test("funding requires both an owner key and a catalog model", () => {
  assertEquals(excavationFundingFromParts({ status: "missing" }, "gpt-5.6-terra"), {
    ok: false,
    reason: "provider_key_missing",
  });
  assertEquals(excavationFundingFromParts({ status: "unreadable" }, "gpt-5.6-terra"), {
    ok: false,
    reason: "provider_key_unreadable",
  });
  assertEquals(excavationFundingFromParts({ status: "ok", apiKey }, null), {
    ok: false,
    reason: "model_not_selected",
  });
  assertEquals(excavationFundingFromParts({ status: "ok", apiKey }, "gpt-imaginary"), {
    ok: false,
    reason: "model_selection_invalid",
  });
  assertEquals(excavationFundingFromParts({ status: "ok", apiKey }, "gpt-5.6-terra"), {
    ok: true,
    apiKey,
    model: "gpt-5.6-terra",
  });
});

Deno.test("funding failure messages never mention secrets", () => {
  for (const reason of [
    "provider_key_missing",
    "provider_key_unreadable",
    "model_not_selected",
    "model_selection_invalid",
  ] as const) {
    const message = excavationFundingMessage(reason);
    assertEquals(message.includes(apiKey), false);
    assertEquals(message.includes("OPENAI_API_KEY"), false);
    assertEquals(typeof message === "string" && message.length > 0, true);
  }
});

Deno.test(
  "resolveOwnerExcavationFunding decrypts then fails closed without operator fallback",
  async () => {
    const sealed = await encryptProviderKey(loadWrappingKeys(getEnv), ownerId, apiKey);
    const funded = await resolveOwnerExcavationFunding({
      ownerId,
      preferredModel: "gpt-5.6-sol",
      getEnv,
      fetchCredential: () => Promise.resolve({ ciphertext: sealed.ciphertext, keyVersion: 1 }),
    });
    assertEquals(funded, { ok: true, apiKey, model: "gpt-5.6-sol" });

    const missing = await resolveOwnerExcavationFunding({
      ownerId,
      preferredModel: "gpt-5.6-sol",
      getEnv,
      fetchCredential: () => Promise.resolve(null),
    });
    assertEquals(missing, { ok: false, reason: "provider_key_missing" });
    assertEquals(JSON.stringify(missing).includes(apiKey), false);
  },
);
