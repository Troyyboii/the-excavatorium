export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const RUNTIME_RUN_STATES = [
  "queued",
  "retrieving",
  "synthesizing",
  "awaiting_approval",
  "executing",
  "verifying",
  "completed",
  "blocked",
  "failed",
  "expired",
  "budget_stopped",
  "cancelled",
] as const;
export type RuntimeRunState = (typeof RUNTIME_RUN_STATES)[number];

export const TERMINAL_RUN_STATES = [
  "completed",
  "blocked",
  "failed",
  "expired",
  "budget_stopped",
  "cancelled",
] as const satisfies readonly RuntimeRunState[];
export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

export const RUN_TRANSITIONS: Readonly<Record<RuntimeRunState, readonly RuntimeRunState[]>> = {
  queued: ["retrieving", "blocked", "failed", "expired", "budget_stopped", "cancelled"],
  retrieving: [
    "synthesizing",
    "awaiting_approval",
    "blocked",
    "failed",
    "expired",
    "budget_stopped",
    "cancelled",
  ],
  synthesizing: [
    "awaiting_approval",
    "verifying",
    "blocked",
    "failed",
    "expired",
    "budget_stopped",
    "cancelled",
  ],
  awaiting_approval: ["executing", "blocked", "expired", "cancelled"],
  executing: ["verifying", "blocked", "failed", "expired", "budget_stopped", "cancelled"],
  verifying: [
    "completed",
    "awaiting_approval",
    "blocked",
    "failed",
    "expired",
    "budget_stopped",
    "cancelled",
  ],
  completed: [],
  blocked: [],
  failed: [],
  expired: [],
  budget_stopped: [],
  cancelled: [],
};

export function isRuntimeRunState(value: string): value is RuntimeRunState {
  return (RUNTIME_RUN_STATES as readonly string[]).includes(value);
}

export function isTerminalRunState(value: RuntimeRunState): value is TerminalRunState {
  return (TERMINAL_RUN_STATES as readonly string[]).includes(value);
}

export function canTransitionRunState(from: RuntimeRunState, to: RuntimeRunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RuntimeRunState, to: RuntimeRunState): void {
  if (!canTransitionRunState(from, to)) {
    throw new Error(`Invalid Custodian run transition: ${from} -> ${to}`);
  }
}

export function isIdempotentReplay(
  lastIdempotencyKey: string | null | undefined,
  requestKey: string,
): boolean {
  return (
    typeof lastIdempotencyKey === "string" &&
    lastIdempotencyKey.length > 0 &&
    lastIdempotencyKey === requestKey
  );
}

export const APPROVAL_KINDS = [
  "tool_action",
  "canonical_write",
  "external_write",
  "archive_change",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const TOOL_OPERATION_CLASSES = [
  "read_only",
  "evidence_write",
  "canonical_write",
  "external_write",
  "archive_change",
] as const;
export type ToolOperationClass = (typeof TOOL_OPERATION_CLASSES)[number];

export const TOOL_EVENT_KINDS = [
  "requested",
  "started",
  "succeeded",
  "failed",
  "denied",
  "skipped",
  "approval_required",
] as const;
export type ToolEventKind = (typeof TOOL_EVENT_KINDS)[number];

export function requiresApprovalForOperation(operation: ToolOperationClass): boolean {
  return operation !== "read_only";
}

export type ApprovalClassification = {
  required: boolean;
  reason: "read_only" | "write_capable_tool";
};

export function classifyApprovalRequirement(operation: ToolOperationClass): ApprovalClassification {
  return requiresApprovalForOperation(operation)
    ? { required: true, reason: "write_capable_tool" }
    : { required: false, reason: "read_only" };
}

export type BudgetLimits = {
  runTokens: number;
  runCostUsd: number;
  runLatencyMs: number;
  runToolEvents: number;
  dailyTokens?: number | null;
  monthlyTokens?: number | null;
  dailyCostUsd?: number | null;
  monthlyCostUsd?: number | null;
};

export type BudgetUsage = {
  runTokens: number;
  runCostUsd: number;
  runLatencyMs: number;
  runToolEvents: number;
  dailyTokens?: number;
  monthlyTokens?: number;
  dailyCostUsd?: number;
  monthlyCostUsd?: number;
};

export type BudgetRemaining = {
  runTokens: number;
  runCostUsd: number;
  runLatencyMs: number;
  runToolEvents: number;
  dailyTokens: number | null;
  monthlyTokens: number | null;
  dailyCostUsd: number | null;
  monthlyCostUsd: number | null;
};

function remaining(limit: number | null | undefined, used: number | undefined): number | null {
  return limit == null ? null : Math.max(limit - (used ?? 0), 0);
}

export function calculateBudgetRemaining(
  limits: BudgetLimits,
  usage: BudgetUsage,
): BudgetRemaining {
  return {
    runTokens: Math.max(limits.runTokens - usage.runTokens, 0),
    runCostUsd: Math.max(limits.runCostUsd - usage.runCostUsd, 0),
    runLatencyMs: Math.max(limits.runLatencyMs - usage.runLatencyMs, 0),
    runToolEvents: Math.max(limits.runToolEvents - usage.runToolEvents, 0),
    dailyTokens: remaining(limits.dailyTokens, usage.dailyTokens),
    monthlyTokens: remaining(limits.monthlyTokens, usage.monthlyTokens),
    dailyCostUsd: remaining(limits.dailyCostUsd, usage.dailyCostUsd),
    monthlyCostUsd: remaining(limits.monthlyCostUsd, usage.monthlyCostUsd),
  };
}

export type BudgetStopReason =
  | "run_tokens"
  | "run_cost"
  | "run_latency"
  | "run_tool_events"
  | "daily_tokens"
  | "monthly_tokens"
  | "daily_cost"
  | "monthly_cost"
  | null;

export function budgetStopReason(limits: BudgetLimits, usage: BudgetUsage): BudgetStopReason {
  if (usage.runTokens >= limits.runTokens) return "run_tokens";
  if (usage.runCostUsd >= limits.runCostUsd) return "run_cost";
  if (usage.runLatencyMs >= limits.runLatencyMs) return "run_latency";
  if (usage.runToolEvents >= limits.runToolEvents) return "run_tool_events";
  if (limits.dailyTokens != null && (usage.dailyTokens ?? 0) >= limits.dailyTokens)
    return "daily_tokens";
  if (limits.monthlyTokens != null && (usage.monthlyTokens ?? 0) >= limits.monthlyTokens)
    return "monthly_tokens";
  if (limits.dailyCostUsd != null && (usage.dailyCostUsd ?? 0) >= limits.dailyCostUsd)
    return "daily_cost";
  if (limits.monthlyCostUsd != null && (usage.monthlyCostUsd ?? 0) >= limits.monthlyCostUsd)
    return "monthly_cost";
  return null;
}

export function shouldStopForBudget(limits: BudgetLimits, usage: BudgetUsage): boolean {
  return budgetStopReason(limits, usage) !== null;
}

export const MODEL_ALLOWLIST = {
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
  pro: "gpt-5.6-pro",
} as const;
export type ModelTier = keyof typeof MODEL_ALLOWLIST;
export type ModelStage = "extract" | "synthesize";

export function selectModelForStage(
  stage: ModelStage,
  persistedTier: ModelTier,
  allowedTiers: readonly ModelTier[],
): { tier: ModelTier; model: string } {
  const requestedOverride = persistedTier === "sol" || persistedTier === "pro";
  const tier = requestedOverride ? persistedTier : stage === "extract" ? "luna" : "terra";
  if (!allowedTiers.includes(tier)) {
    throw new Error(`Model tier ${tier} is not permitted by the persisted owner policy`);
  }
  return { tier, model: MODEL_ALLOWLIST[tier] };
}

export type ResponsesJsonSchema = {
  type: "object";
  additionalProperties: false;
  required: readonly string[];
  properties: Record<string, JsonValue>;
};

export type ResponsesRequest = {
  model: string;
  store: false;
  input: readonly [
    { role: "system"; content: readonly [{ type: "input_text"; text: string }] },
    { role: "user"; content: readonly [{ type: "input_text"; text: string }] },
  ];
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: ResponsesJsonSchema;
    };
  };
  max_output_tokens: number;
};

export function buildResponsesJsonRequest(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: ResponsesJsonSchema;
  maxOutputTokens: number;
}): ResponsesRequest {
  if (!input.model || !input.schemaName || input.maxOutputTokens < 1) {
    throw new Error("A model, schema name, and positive output budget are required");
  }
  return {
    model: input.model,
    store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: input.systemPrompt }] },
      { role: "user", content: [{ type: "input_text", text: input.userPrompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        strict: true,
        schema: input.schema,
      },
    },
    max_output_tokens: input.maxOutputTokens,
  };
}

export function extractResponsesJson(response: unknown): JsonObject | null {
  if (!response || typeof response !== "object") return null;
  const value = response as { status?: unknown; output?: unknown };
  if (value.status !== "completed" || !Array.isArray(value.output)) return null;
  let text = "";
  for (const item of value.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as { type?: unknown; role?: unknown; content?: unknown };
    if (
      message.type !== "message" ||
      message.role !== "assistant" ||
      !Array.isArray(message.content)
    )
      continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") return null;
      const content = part as { type?: unknown; text?: unknown };
      if (content.type === "refusal") return null;
      if (content.type === "output_text") {
        if (typeof content.text !== "string") return null;
        text += content.text;
      }
    }
  }
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

export type RuntimeAgentRun = {
  id: string;
  owner_id: string;
  case_id: string;
  objective: string;
  input_snapshot: JsonObject;
  agent_graph: JsonObject;
  agent_config: JsonObject;
  prompt_version: string;
  tool_allowlist: string[];
  model_tier: ModelTier;
  status: RuntimeRunState;
  budget_tokens: number;
  budget_cost_usd: number;
  budget_latency_ms: number;
  budget_tool_events: number;
  tokens_used: number;
  cost_usd: number;
  latency_ms: number;
  tool_events_count: number;
  cancel_requested_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};
