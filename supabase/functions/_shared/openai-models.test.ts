import {
  defaultModelForTier,
  isOpenAiModelId,
  OPENAI_MODEL_IDS,
  openAiModelTier,
} from "./openai-models.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("the catalog is exactly the six approved OpenAI model IDs", () => {
  assertEquals(
    [...OPENAI_MODEL_IDS].sort(),
    [
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6-sol",
    ].sort(),
  );
});

Deno.test("only catalog IDs are accepted; retired and foreign models are not", () => {
  assertEquals(isOpenAiModelId("gpt-6-astra"), true);
  for (const value of ["gpt-5.6-pro", "gpt-4o", "", null, undefined, 5, "GPT-6-ASTRA"]) {
    assertEquals(isOpenAiModelId(value), false);
  }
});

Deno.test("models map onto policy tiers; astra is the highest (pro) tier", () => {
  assertEquals(openAiModelTier("gpt-5.6-luna"), "luna");
  assertEquals(openAiModelTier("gpt-6-luna"), "luna");
  assertEquals(openAiModelTier("gpt-5.6-terra"), "terra");
  assertEquals(openAiModelTier("gpt-5.6-sol"), "sol");
  assertEquals(openAiModelTier("gpt-6-sol"), "sol");
  assertEquals(openAiModelTier("gpt-6-astra"), "pro");
  assertEquals(openAiModelTier("gpt-5.6-pro"), null);
  assertEquals(defaultModelForTier("pro"), "gpt-6-astra");
});
