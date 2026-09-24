import {
  handleRequest,
  parseAgentRun,
  parseInvocationPayload,
  PROVIDER_EXECUTION_UNSUPPORTED,
  validFindingCandidate,
  validSynthesis,
} from "./index.ts";
import {
  boundedOutputBudget,
  CANONICAL_SYSTEM_PROMPT,
  calculateUsageCost,
  ceilCostForDatabase,
  CUSTODIAN_MODEL_PRICING_ENV,
  MAX_SYSTEM_PROMPT_CHARS,
  maximumPotentialUsageCost,
  readUsage,
  resolveSystemPrompt,
  resolveModelPricing,
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

Deno.test("rejects a run without its mandatory persisted tool policy", () => {
  const validRun = {
    id: runId,
    case_id: runId,
    status: "retrieving",
    input_snapshot: {},
    agent_config: {},
    objective: "Read the selected evidence.",
    prompt_version: "custodian-runtime-v1",
    model_tier: "terra",
    tokens_used: 0,
    cost_usd: 0,
    latency_ms: 0,
    tool_events_count: 0,
    last_step_number: 0,
    cancel_requested_at: null,
    failure_code: null,
    failure_message: null,
  };

  assertEquals(
    (() => {
      try {
        parseAgentRun({ run: validRun });
        return false;
      } catch {
        return true;
      }
    })(),
    true,
  );
  assertEquals(
    (() => {
      try {
        parseAgentRun({ run: { ...validRun, tool_policy_id: null } });
        return false;
      } catch {
        return true;
      }
    })(),
    true,
  );
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
    model: "gpt-6-astra",
  });
  assertEquals(selectRuntimeModel("synthesize", "pro", ["luna", "terra", "sol", "pro"]), {
    tier: "pro",
    model: "gpt-6-astra",
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
  let omitted = false;
  try {
    (
      selectRuntimeModel as unknown as (
        stage: "synthesize",
        persistedTier: "pro",
      ) => {
        tier: string;
        model: string;
      }
    )("synthesize", "pro");
  } catch {
    omitted = true;
  }
  if (!omitted) throw new Error("Expected omitted allowed tiers to be rejected");
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
  assertEquals(boundedOutputBudget(1), 0);
  assertEquals(boundedOutputBudget(15), 0);
  assertEquals(boundedOutputBudget(16), 16);
  assertEquals(boundedOutputBudget(63), 63);
  assertEquals(boundedOutputBudget(4074), 4074);
  assertEquals(boundedOutputBudget(4096), 4096);
  assertEquals(boundedOutputBudget(4097), 4096);
  assertEquals(boundedOutputBudget(0), 0);
});

Deno.test("accepts exact-model versioned pricing only", () => {
  const pricingJson = JSON.stringify({
    "gpt-5.6-luna": {
      version: "2026-08-22",
      inputUsdPerMillion: 1.2,
      cachedInputUsdPerMillion: 0.3,
      outputUsdPerMillion: 4.8,
    },
  });
  assertEquals(resolveModelPricing(pricingJson, "gpt-5.6-luna"), {
    version: "2026-08-22",
    inputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.3,
    outputUsdPerMillion: 4.8,
  });
  assertEquals(resolveModelPricing(undefined, "gpt-5.6-luna"), null);
  assertEquals(resolveModelPricing(pricingJson, "not-an-allowlisted-model"), null);
  assertEquals(
    resolveModelPricing(
      JSON.stringify({
        "gpt-5.6-luna": {
          version: "missing-cached-rate",
          inputUsdPerMillion: 1.2,
          outputUsdPerMillion: 4.8,
        },
      }),
      "gpt-5.6-luna",
    ),
    null,
  );
  assertEquals(CUSTODIAN_MODEL_PRICING_ENV, "CUSTODIAN_MODEL_PRICING_JSON");
});

Deno.test(
  "Custodian HTTP handler rejects invalid method, origin, size, and unauthenticated calls",
  async () => {
    const method = await handleRequest(
      new Request("https://example.test/custodian-run", { method: "GET" }),
    );
    assertEquals(method.status, 405);

    const origin = await handleRequest(
      new Request("https://example.test/custodian-run", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      }),
    );
    assertEquals(origin.status, 403);

    const tooLarge = await handleRequest(
      new Request("https://example.test/custodian-run", {
        method: "POST",
        headers: { "content-length": "16385" },
      }),
    );
    assertEquals(tooLarge.status, 413);

    const unauthenticated = await handleRequest(
      new Request("https://example.test/custodian-run", { method: "POST", body: "{}" }),
    );
    assertEquals(unauthenticated.status, 401);
    assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, false);
  },
);

Deno.test("validates structured Finding outcomes before any materialization boundary", () => {
  const supportingEvidenceId = "123e4567-e89b-12d3-a456-426614174000";
  const baseCandidate = {
    outcome: "finding",
    title: "Bounded conclusion",
    conclusion: "The selected evidence supports the conclusion.",
    analysis_mode: "synthesis",
    confidence: 80,
    supporting_evidence_ids: [supportingEvidenceId],
    contrary_evidence_ids: [],
    uncertainties: [],
    assumptions: ["Only selected Case evidence was reviewed."],
    scope_limits: [],
    evidence_gaps: [],
    what_would_change_mind: "A newer primary record would change the conclusion.",
    revisit_condition: "Revisit when the Case scope changes.",
  };

  assertEquals(validFindingCandidate(baseCandidate), true);
  assertEquals(
    validFindingCandidate({ ...baseCandidate, outcome: "finding", supporting_evidence_ids: [] }),
    false,
  );
  assertEquals(
    validFindingCandidate({
      ...baseCandidate,
      outcome: "unresolved",
      supporting_evidence_ids: [],
      evidence_gaps: ["The archive does not contain the primary confirmation."],
    }),
    true,
  );
  assertEquals(validFindingCandidate({ ...baseCandidate, outcome: "refusal" }), true);
  assertEquals(validFindingCandidate("generic agent step output"), false);
  assertEquals(
    validSynthesis({
      summary: "Fixture synthesis",
      findings: [baseCandidate],
      requiresApproval: false,
      approvalKind: "external_write",
    }),
    true,
  );
  assertEquals(
    validSynthesis({
      summary: "Legacy generic output",
      findings: ["this must not become a Finding"],
      requiresApproval: false,
      approvalKind: "external_write",
    }),
    false,
  );
  // The contract carries no executable payload. A diff or tool action is rejected.
  for (const extra of [{ proposedDiff: {} }, { toolAction: {} }, { toolAction: { run: "x" } }]) {
    assertEquals(
      validSynthesis({
        summary: "Fixture synthesis",
        findings: [baseCandidate],
        requiresApproval: false,
        approvalKind: "external_write",
        ...extra,
      }),
      false,
    );
  }
  assertEquals(validFindingCandidate({ ...baseCandidate, title: "   " }), false);
  assertEquals(validFindingCandidate({ ...baseCandidate, title: "x".repeat(501) }), false);
  assertEquals(validFindingCandidate({ ...baseCandidate, confidence: 80.5 }), false);
  assertEquals(validFindingCandidate({ ...baseCandidate, confidence: 101 }), false);
  assertEquals(validFindingCandidate({ ...baseCandidate, unexpected: true }), false);
  assertEquals(
    validFindingCandidate({
      ...baseCandidate,
      outcome: "unresolved",
      supporting_evidence_ids: [],
      assumptions: ["  "],
    }),
    false,
  );
});

Deno.test("calculates cached-input and output costs by rounding upward to DB precision", () => {
  const usage = readUsage({
    usage: {
      input_tokens: 1_000,
      output_tokens: 250,
      total_tokens: 1_250,
      input_tokens_details: { cached_tokens: 400 },
    },
  });
  if (!usage) throw new Error("Expected valid provider usage");
  const cost = calculateUsageCost(usage, {
    version: "v1",
    inputUsdPerMillion: 1.1,
    cachedInputUsdPerMillion: 0.2,
    outputUsdPerMillion: 3.3,
  });
  assertEquals(cost, 0.0016);
  assertEquals(ceilCostForDatabase(0.0000001), 0.0001);
});

Deno.test("bounds maximum provider cost before a call", () => {
  const pricing = {
    version: "v1",
    inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 8,
  };
  assertEquals(maximumPotentialUsageCost(10_000, 1_000, pricing), 0.028);
  assertEquals(maximumPotentialUsageCost(-1, 1_000, pricing), null);
});

Deno.test("blocks missing or malformed provider usage instead of recording it as free", () => {
  assertEquals(readUsage({}), null);
  assertEquals(readUsage({ usage: { total_tokens: 17 } }), null);
  assertEquals(readUsage({ usage: { input_tokens: 9, output_tokens: 8, total_tokens: 16 } }), null);
  assertEquals(
    readUsage({
      usage: { input_tokens: 9, output_tokens: 8, input_tokens_details: { cached_tokens: 10 } },
    }),
    null,
  );
});
