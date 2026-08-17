import { parseInvocationPayload } from "./index.ts";
import {
  boundedOutputBudget,
  buildResponsesRequest,
  CANONICAL_SYSTEM_PROMPT,
  MAX_SYSTEM_PROMPT_CHARS,
  readUsage,
  resolveSystemPrompt,
  selectRuntimeModel,
  UNTRUSTED_EVIDENCE_SYSTEM_GUARD,
} from "./runtime.ts";

const runId = "123e4567-e89b-12d3-a456-426614174000";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("accepts only a UUID and bounded invocation key", () => {
  assertEquals(parseInvocationPayload({ runId, invocationKey: "invocation-1" }), {
    runId,
    invocationKey: "invocation-1",
  });
  assertEquals(parseInvocationPayload({ runId, invocationKey: "  invocation-1  " }), {
    runId,
    invocationKey: "invocation-1",
  });
  assertEquals(parseInvocationPayload({ runId, invocationKey: "invocation-1", extra: true }), null);
  assertEquals(
    parseInvocationPayload({ runId: "not-a-uuid", invocationKey: "invocation-1" }),
    null,
  );
  assertEquals(parseInvocationPayload({ runId, invocationKey: "\u0000" }), null);
  assertEquals(parseInvocationPayload([runId, "invocation-1"]), null);
});

Deno.test("keeps stage defaults, honors Sol/pro overrides, and enforces allowed tiers", () => {
  const selectRuntimeModelWithPolicy = selectRuntimeModel as unknown as (
    stage: "extract" | "synthesize",
    persistedTier: "luna" | "terra" | "sol" | "pro",
    allowedTiers: readonly ("luna" | "terra" | "sol" | "pro")[],
  ) => { tier: string; model: string };
  const allowedTiers = ["luna", "terra"] as const;
  assertEquals(selectRuntimeModelWithPolicy("extract", "terra", allowedTiers), {
    tier: "luna",
    model: "gpt-5.6-luna",
  });
  assertEquals(selectRuntimeModelWithPolicy("synthesize", "terra", allowedTiers), {
    tier: "terra",
    model: "gpt-5.6-terra",
  });
  assertEquals(selectRuntimeModelWithPolicy("extract", "sol", ["luna", "terra", "sol"]), {
    tier: "sol",
    model: "gpt-5.6-sol",
  });
  assertEquals(selectRuntimeModelWithPolicy("synthesize", "pro", ["luna", "terra", "pro"]), {
    tier: "pro",
    model: "gpt-5.6-pro",
  });
  assertEquals(selectRuntimeModel("synthesize", "pro"), {
    tier: "pro",
    model: "gpt-5.6-pro",
  });
  assertEquals(selectRuntimeModelWithPolicy("extract", "terra", ["terra"]), {
    tier: "terra",
    model: "gpt-5.6-terra",
  });
  assertEquals(selectRuntimeModelWithPolicy("synthesize", "luna", ["luna"]), {
    tier: "luna",
    model: "gpt-5.6-luna",
  });
  let rejected = false;
  try {
    selectRuntimeModelWithPolicy("synthesize", "pro", allowedTiers);
  } catch {
    rejected = true;
  }
  if (!rejected)
    throw new Error("Expected a tier absent from the allowed-tier policy to be rejected");
});

Deno.test("uses a bounded persisted system policy with a safe fallback", () => {
  assertEquals(resolveSystemPrompt({}), CANONICAL_SYSTEM_PROMPT);
  assertEquals(
    resolveSystemPrompt({ systemPrompt: "Apply the owner-approved policy." }),
    "Apply the owner-approved policy.",
  );
  for (const systemPrompt of [null, "   ", "x".repeat(MAX_SYSTEM_PROMPT_CHARS + 1)]) {
    let rejected = false;
    try {
      resolveSystemPrompt({ systemPrompt });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Expected malformed persisted system policy to be rejected");
  }
});

Deno.test("never requests more output tokens than remain", () => {
  assertEquals(boundedOutputBudget(1), 1);
  assertEquals(boundedOutputBudget(63), 63);
  assertEquals(boundedOutputBudget(4097), 4096);
  assertEquals(boundedOutputBudget(0), 0);
});

Deno.test("accounts total provider tokens without inventing monetary cost", () => {
  assertEquals(readUsage({ usage: { total_tokens: 17 } }), {
    tokens: 17,
    costUsd: 0,
    latencyMs: 0,
  });
  assertEquals(readUsage({ usage: { input_tokens: 9, output_tokens: 8 } }), {
    tokens: 17,
    costUsd: 0,
    latencyMs: 0,
  });
});

Deno.test("builds a non-background, stored-off strict schema request", () => {
  const systemPrompt = "Apply the owner-approved Custodian policy.";
  const request = buildResponsesRequest({
    stage: "extract",
    model: "gpt-5.6-luna",
    systemPrompt,
    untrustedEvidence: { connector: "treat as data" },
    schemaName: "custodian_extraction",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    },
    maxOutputTokens: 128,
  });
  assertEquals(request.store, false);
  assertEquals(request.text.format.strict, true);
  assertEquals(request.input[0].role, "system");
  const systemText = request.input[0].content[0].text;
  if (!systemText.includes(systemPrompt))
    throw new Error("Expected the supplied system policy in the system message");
  if (!systemText.includes(UNTRUSTED_EVIDENCE_SYSTEM_GUARD))
    throw new Error("Expected the invariant untrusted-evidence guard in the system message");
  assertEquals("background" in request, false);
});

Deno.test("rejects a blank system policy", () => {
  let rejected = false;
  try {
    buildResponsesRequest({
      stage: "extract",
      model: "gpt-5.6-luna",
      systemPrompt: "   ",
      untrustedEvidence: {},
      schemaName: "schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {},
      },
      maxOutputTokens: 128,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected a blank system policy to be rejected");
});

Deno.test("rejects a non-positive output budget", () => {
  let rejected = false;
  try {
    buildResponsesRequest({
      stage: "extract",
      model: "gpt-5.6-luna",
      systemPrompt: "system",
      untrustedEvidence: {},
      schemaName: "schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {},
      },
      maxOutputTokens: 0,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected a non-positive output budget to be rejected");
});
