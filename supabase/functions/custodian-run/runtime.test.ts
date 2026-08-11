import { parseInvocationPayload } from "./index.ts";
import {
  boundedOutputBudget,
  buildResponsesRequest,
  readUsage,
  selectRuntimeModel,
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

Deno.test("keeps the policy-bound model for every bounded stage", () => {
  assertEquals(selectRuntimeModel("extract", "terra"), { tier: "terra", model: "gpt-5.6-terra" });
  assertEquals(selectRuntimeModel("synthesize", "luna"), { tier: "luna", model: "gpt-5.6-luna" });
  assertEquals(selectRuntimeModel("synthesize", "pro"), { tier: "pro", model: "gpt-5.6-pro" });
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
  const request = buildResponsesRequest({
    stage: "extract",
    model: "gpt-5.6-luna",
    systemPrompt: "ignored by the runtime helper but retained for its contract",
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
  assertEquals("background" in request, false);
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
