import {
  authenticatedSupabase,
  allowedOrigin,
  jsonResponse,
  responseHeaders,
  trustedRuntimeSupabase,
  type AuthenticatedSupabase,
} from "../_shared/http.ts";
import {
  boundedOutputBudget,
  buildResponsesRequest,
  calculateUsageCost,
  CUSTODIAN_MODEL_PRICING_ENV,
  extractResponsesJson,
  isAllowedModelTiers,
  isApprovalOutput,
  maximumPotentialUsageCost,
  readUsage,
  resolveModelPricing,
  resolveSystemPrompt,
  selectRuntimeModel,
  stepKey,
  transitionKey,
  EXTRACTION_SCHEMA,
  SYNTHESIS_SCHEMA,
  type ModelPricing,
  type ModelTier,
  type RunStage,
} from "./runtime.ts";
import {
  advanceCustodianRun,
  approvalIdempotencyKey,
  countDisallowedToolEvents,
  countKnownDisallowedToolClasses,
  parseReservationView,
  providerAttemptKey,
  type DisallowedToolEventCounter,
  type ApprovalIdentity,
  type BudgetSnapshot,
  type CustodianIo,
  type ReservationView,
  type StepArtifact,
  type SynthesisRun,
  type VerificationArtifacts,
} from "./provider-attempt.ts";

export const MAX_REQUEST_BYTES = 16_384;
export const MAX_INVOCATION_KEY_LENGTH = 300;
export const OPENAI_TIMEOUT_MS = 25_000;
export const MAX_EVIDENCE_CHARS = 80_000;
export const PROVIDER_EXECUTION_UNSUPPORTED = true;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_KINDS = [
  "tool_action",
  "canonical_write",
  "external_write",
  "archive_change",
] as const;
const FINDING_OUTCOMES = ["finding", "unresolved", "refusal", "no_finding"] as const;
const FINDING_ANALYSIS_MODES = [
  "plan",
  "claim_review",
  "evidence_gap",
  "contradiction",
  "timeline",
  "causal",
  "risk",
  "decision",
  "synthesis",
] as const;
const TERMINAL_STATES = new Set([
  "completed",
  "blocked",
  "failed",
  "expired",
  "budget_stopped",
  "cancelled",
]);

type Invocation = { runId: string; invocationKey: string };
type JsonRecord = Record<string, unknown>;

type AgentRun = JsonRecord & {
  id: string;
  case_id: string;
  status: string;
  input_snapshot: JsonRecord;
  readonly agent_config: JsonRecord;
  readonly tool_policy_id: string;
  objective: string;
  prompt_version: string;
  model_tier: ModelTier;
  tokens_used: number;
  cost_usd: number;
  latency_ms: number;
  tool_events_count: number;
  last_step_number: number;
  cancel_requested_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

type BudgetStatus = {
  allowed: boolean;
  reason: string;
  run_tokens_remaining: number;
  run_cost_remaining: number;
  run_latency_remaining: number;
  daily_token_remaining: number | null;
  monthly_token_remaining: number | null;
};

type ApprovalSummary = {
  id: string;
  status: string;
  approval_kind: string;
  title: string;
  exact_action_hash: string;
};

type RecordedUsage = {
  tokens: number;
  costUsd: number;
  latencyMs: number;
  pricingVersion?: string;
};

class SafeFailure extends Error {
  constructor(
    readonly status: 502 | 503 | 504,
    readonly code: string,
    readonly publicMessage: string,
    readonly latencyMs = 0,
    readonly usage?: RecordedUsage,
  ) {
    super(code);
  }
}

class RpcFailure extends Error {
  constructor() {
    super("rpc_failure");
  }
}

function trustedRuntimeClient(): AuthenticatedSupabase["client"] {
  const client = trustedRuntimeSupabase();
  if (!client) {
    throw new SafeFailure(
      503,
      "trusted_runtime_unavailable",
      "Custodian trusted runtime execution is unavailable.",
    );
  }
  return client;
}

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

export function parseInvocationPayload(value: unknown): Invocation | null {
  if (!isObject(value) || !hasOnlyKeys(value, ["runId", "invocationKey"])) return null;
  if (typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId)) return null;
  if (typeof value.invocationKey !== "string") return null;
  const invocationKey = value.invocationKey.trim();
  if (
    invocationKey.length === 0 ||
    invocationKey.length > MAX_INVOCATION_KEY_LENGTH ||
    [...invocationKey].some((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  )
    return null;
  return { runId: value.runId.toLowerCase(), invocationKey };
}

async function readJsonBody(
  request: Request,
): Promise<{ value: JsonRecord | null; tooLarge: boolean }> {
  if (!request.body) return { value: null, tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { value: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return { value: isObject(parsed) ? parsed : null, tooLarge: false };
  } catch {
    return { value: null, tooLarge: false };
  }
}

export function parseAgentRun(value: unknown): AgentRun {
  if (!isObject(value) || !isObject(value.run)) throw new RpcFailure();
  const run = value.run;
  if (
    typeof run.id !== "string" ||
    typeof run.case_id !== "string" ||
    typeof run.status !== "string" ||
    !isObject(run.input_snapshot) ||
    !isObject(run.agent_config) ||
    typeof run.tool_policy_id !== "string" ||
    !UUID_PATTERN.test(run.tool_policy_id) ||
    typeof run.objective !== "string" ||
    typeof run.prompt_version !== "string" ||
    !["luna", "terra", "sol", "pro"].includes(String(run.model_tier)) ||
    typeof run.tokens_used !== "number" ||
    typeof run.cost_usd !== "number" ||
    typeof run.latency_ms !== "number" ||
    typeof run.tool_events_count !== "number" ||
    typeof run.last_step_number !== "number"
  )
    throw new RpcFailure();
  return run as AgentRun;
}

async function resolveAllowedModelTiers(
  client: AuthenticatedSupabase["client"],
  ownerId: string,
  run: AgentRun,
): Promise<readonly ModelTier[]> {
  const { data, error } = await client
    .from("tool_policies")
    .select("allowed_model_tiers,status,lifecycle_status,kill_switch")
    .eq("owner_id", ownerId)
    .eq("id", run.tool_policy_id)
    .maybeSingle();
  if (
    error ||
    !isObject(data) ||
    data.status !== "active" ||
    data.lifecycle_status !== "active" ||
    data.kill_switch !== false ||
    !isAllowedModelTiers(data.allowed_model_tiers)
  ) {
    throw new SafeFailure(
      502,
      "tool_policy_invalid",
      "The persisted Custodian tool policy is unavailable or malformed.",
    );
  }
  return data.allowed_model_tiers;
}

function budgetFromRpc(value: unknown): BudgetStatus {
  if (!isObject(value)) throw new RpcFailure();
  if (
    typeof value.allowed !== "boolean" ||
    typeof value.reason !== "string" ||
    typeof value.run_tokens_remaining !== "number" ||
    typeof value.run_cost_remaining !== "number" ||
    typeof value.run_latency_remaining !== "number" ||
    (value.daily_token_remaining !== null && typeof value.daily_token_remaining !== "number") ||
    (value.monthly_token_remaining !== null && typeof value.monthly_token_remaining !== "number")
  )
    throw new RpcFailure();
  return value as BudgetStatus;
}

async function rpc(
  client: AuthenticatedSupabase["client"],
  functionName: string,
  args: JsonRecord,
): Promise<unknown> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw new RpcFailure();
  return data;
}

async function getRun(client: AuthenticatedSupabase["client"], runId: string): Promise<AgentRun> {
  return parseAgentRun(await rpc(client, "custodian_get_agent_run", { run_id: runId }));
}

async function getBudget(
  client: AuthenticatedSupabase["client"],
  runId: string,
): Promise<BudgetStatus> {
  return budgetFromRpc(await rpc(client, "custodian_run_budget_status", { run_id: runId }));
}

async function transitionRun(
  client: AuthenticatedSupabase["client"],
  run: AgentRun,
  invocationKey: string,
  nextStatus: string,
  patch: JsonRecord = {},
): Promise<AgentRun> {
  return parseAgentRun(
    await rpc(client, "custodian_transition_agent_run", {
      run_id: run.id,
      expected_status: run.status,
      next_status: nextStatus,
      idempotency_key: transitionKey(invocationKey, run.status, nextStatus),
      patch,
    }),
  );
}

type RecordedStep = {
  run: AgentRun;
  stepId: string;
};

async function recordStep(
  client: AuthenticatedSupabase["client"],
  ownerId: string,
  run: AgentRun,
  invocationKey: string,
  stepKind: string,
  idempotencyKey: string,
  modelTier: ModelTier,
  inputPayload: JsonRecord,
  outputPayload: JsonRecord,
  status: "completed" | "failed" | "blocked" = "completed",
  usage: RecordedUsage = {
    tokens: 0,
    costUsd: 0,
    latencyMs: 0,
  },
): Promise<RecordedStep> {
  if (stepKind === "synthesize" && status === "completed") {
    throw new RpcFailure();
  }
  const value = await rpc(client, "custodian_record_agent_step", {
    run_id: run.id,
    idempotency_key: idempotencyKey,
    step_payload: {
      sequence_no: run.last_step_number + 1,
      step_kind: stepKind,
      status,
      model_tier: modelTier,
      prompt_version: run.prompt_version,
      input_payload: inputPayload,
      output_payload: outputPayload,
      tokens_used: usage.tokens,
      cost_usd: usage.costUsd,
      latency_ms: usage.latencyMs,
      ...(usage.pricingVersion ? { pricing_version: usage.pricingVersion } : {}),
      provenance: {
        runtime: "custodian-run",
        evidence_untrusted: true,
      },
    },
  });
  if (!isObject(value) || !isObject(value.step) || typeof value.step.id !== "string") {
    throw new RpcFailure();
  }
  return {
    run: parseAgentRun(value),
    stepId: value.step.id,
  };
}

async function materializeRuntimeFindings(ownerId: string, stepId: string): Promise<void> {
  await rpc(trustedRuntimeClient(), "custodian_materialize_runtime_findings", {
    runtime_owner_id: ownerId,
    agent_step_id: stepId,
  });
}

function boundedObject(value: unknown, maxChars = 120_000): value is JsonRecord {
  if (!isObject(value)) return false;
  try {
    return JSON.stringify(value).length <= maxChars;
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => boundedString(item, maxItemLength))
  );
}

function validExtraction(value: unknown): value is JsonRecord {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "summary",
      "facts",
      "uncertainties",
      "requiresApproval",
      "proposedDiff",
      "toolAction",
    ])
  )
    return false;
  return (
    boundedString(value.summary, 6_000) &&
    boundedStringArray(value.facts, 32, 1_000) &&
    boundedStringArray(value.uncertainties, 32, 1_000) &&
    typeof value.requiresApproval === "boolean" &&
    boundedObject(value.proposedDiff) &&
    boundedObject(value.toolAction)
  );
}

export function validFindingCandidate(value: unknown): value is JsonRecord {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "outcome",
      "title",
      "conclusion",
      "analysis_mode",
      "confidence",
      "supporting_evidence_ids",
      "contrary_evidence_ids",
      "uncertainties",
      "assumptions",
      "scope_limits",
      "evidence_gaps",
      "what_would_change_mind",
      "revisit_condition",
    ])
  )
    return false;
  const outcome = value.outcome;
  const supporting = value.supporting_evidence_ids;
  const contrary = value.contrary_evidence_ids;
  const caveatArrays = [
    value.uncertainties,
    value.assumptions,
    value.scope_limits,
    value.evidence_gaps,
  ];
  const hasMeaningfulCaveat = caveatArrays.some(
    (items) =>
      Array.isArray(items) && items.some((item) => typeof item === "string" && item.trim()),
  );
  return (
    typeof outcome === "string" &&
    FINDING_OUTCOMES.includes(outcome as (typeof FINDING_OUTCOMES)[number]) &&
    boundedString(value.title, 500) &&
    value.title.trim().length > 0 &&
    boundedString(value.conclusion, 30000) &&
    value.conclusion.trim().length > 0 &&
    typeof value.analysis_mode === "string" &&
    FINDING_ANALYSIS_MODES.includes(
      value.analysis_mode as (typeof FINDING_ANALYSIS_MODES)[number],
    ) &&
    boundedInteger(value.confidence, 0, 100) &&
    boundedStringArray(supporting, 32, 100) &&
    boundedStringArray(contrary, 32, 100) &&
    boundedStringArray(value.uncertainties, 32, 1000) &&
    boundedStringArray(value.assumptions, 32, 1000) &&
    boundedStringArray(value.scope_limits, 32, 1000) &&
    boundedStringArray(value.evidence_gaps, 32, 1000) &&
    boundedString(value.what_would_change_mind, 10000) &&
    boundedString(value.revisit_condition, 10000) &&
    (outcome !== "finding" || supporting.length > 0) &&
    (outcome !== "unresolved" || hasMeaningfulCaveat)
  );
}

export function validSynthesis(value: unknown): value is JsonRecord {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "summary",
      "findings",
      "requiresApproval",
      "approvalKind",
      "proposedDiff",
      "toolAction",
    ])
  )
    return false;
  return (
    boundedString(value.summary, 10_000) &&
    Array.isArray(value.findings) &&
    value.findings.length <= 64 &&
    value.findings.every(validFindingCandidate) &&
    typeof value.requiresApproval === "boolean" &&
    typeof value.approvalKind === "string" &&
    APPROVAL_KINDS.includes(value.approvalKind as (typeof APPROVAL_KINDS)[number]) &&
    boundedObject(value.proposedDiff) &&
    boundedObject(value.toolAction)
  );
}

export function evaluatePricedProviderResponse(
  upstream: unknown,
  stage: RunStage,
  pricing: ModelPricing,
  latencyMs: number,
): {
  output: JsonRecord;
  usage: RecordedUsage & { pricingVersion: string };
} {
  const usage = readUsage(upstream);
  if (!usage) {
    throw new SafeFailure(
      502,
      "openai_usage_missing",
      "Custodian model response did not include complete usage accounting.",
      latencyMs,
    );
  }
  const costUsd = calculateUsageCost(usage, pricing);
  if (costUsd === null) {
    throw new SafeFailure(
      502,
      "model_pricing_invalid",
      "Custodian model pricing could not be applied safely.",
      latencyMs,
    );
  }
  const accountedUsage: RecordedUsage & { pricingVersion: string } = {
    tokens: usage.tokens,
    costUsd,
    latencyMs,
    pricingVersion: pricing.version,
  };
  const output = extractResponsesJson(upstream);
  if (output === null) {
    throw new SafeFailure(
      502,
      "openai_invalid_output",
      "Custodian model returned an invalid bounded result.",
      latencyMs,
      accountedUsage,
    );
  }
  const invalidOutput = stage === "extract" ? !validExtraction(output) : !validSynthesis(output);
  if (invalidOutput) {
    throw new SafeFailure(
      502,
      "openai_invalid_output",
      "Custodian model returned an invalid bounded result.",
      latencyMs,
      accountedUsage,
    );
  }
  return { output, usage: accountedUsage };
}

function finiteDbNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stepArtifact(value: unknown): StepArtifact | null {
  if (!isObject(value) || typeof value.id !== "string") return null;
  if (typeof value.step_kind !== "string" || typeof value.status !== "string") return null;
  if (typeof value.idempotency_key !== "string") return null;
  const tokens = finiteDbNumber(value.tokens_used);
  const cost = finiteDbNumber(value.cost_usd);
  if (tokens === null || cost === null) return null;
  return {
    id: value.id,
    stepKind: value.step_kind,
    status: value.status,
    idempotencyKey: value.idempotency_key,
    output: isObject(value.output_payload) ? value.output_payload : null,
    tokensUsed: tokens,
    costUsd: cost,
    pricingVersion: typeof value.pricing_version === "string" ? value.pricing_version : null,
  };
}

function publicApproval(value: unknown): ApprovalSummary | null {
  if (!isObject(value)) return null;
  const approval = value.approval;
  if (!isObject(approval)) return null;
  if (
    typeof approval.id !== "string" ||
    typeof approval.status !== "string" ||
    typeof approval.approval_kind !== "string" ||
    typeof approval.title !== "string" ||
    typeof approval.exact_action_hash !== "string"
  )
    return null;
  return {
    id: approval.id,
    status: approval.status,
    approval_kind: approval.approval_kind,
    title: approval.title,
    exact_action_hash: approval.exact_action_hash,
  };
}

async function createApproval(
  client: AuthenticatedSupabase["client"],
  run: AgentRun,
  output: JsonRecord,
): Promise<{ run: AgentRun; approval: ApprovalIdentity }> {
  const approval = await rpc(client, "custodian_create_approval_request", {
    approval_payload: {
      case_id: run.case_id,
      run_id: run.id,
      approval_kind: output.approvalKind,
      title: "Custodian synthesis requires approval",
      rationale: output.summary,
      proposed_diff: output.proposedDiff,
      tool_action: output.toolAction,
      provenance: { runtime: "custodian-run", stage: "synthesize", evidence_untrusted: true },
    },
    idempotency_key: approvalIdempotencyKey(run.id),
  });
  const updatedRun = isObject(approval) && isObject(approval.run) ? parseAgentRun(approval) : run;
  const approvalSummary = publicApproval(approval);
  if (!approvalSummary) throw new RpcFailure();
  return {
    run: updatedRun,
    approval: {
      id: approvalSummary.id,
      status: approvalSummary.status,
      approvalKind: approvalSummary.approval_kind,
      exactActionHash: approvalSummary.exact_action_hash,
    },
  };
}

async function readReservation(
  client: AuthenticatedSupabase["client"],
  runId: string,
  idempotencyKey: string,
): Promise<ReservationView | null> {
  const { data, error } = await client
    .from("agent_provider_reservations")
    .select(
      "id,status,usage_knowledge,hold_tokens,hold_cost_usd,actual_tokens,actual_cost_usd,pricing_version,failure_code,in_flight_until,idempotency_key",
    )
    .eq("run_id", runId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new RpcFailure();
  if (!data) return null;
  const reservation = parseReservationView(data);
  if (!reservation) throw new RpcFailure();
  return reservation;
}

async function readStep(
  client: AuthenticatedSupabase["client"],
  runId: string,
  idempotencyKey: string,
): Promise<StepArtifact | null> {
  const { data, error } = await client
    .from("agent_steps")
    .select(
      "id,step_kind,status,idempotency_key,output_payload,tokens_used,cost_usd,pricing_version",
    )
    .eq("run_id", runId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new RpcFailure();
  if (!data) return null;
  const step = stepArtifact(data);
  if (!step) throw new RpcFailure();
  return step;
}

async function readVerificationArtifacts(
  client: AuthenticatedSupabase["client"],
  runId: string,
): Promise<VerificationArtifacts | null> {
  const reservationSelect =
    "id,status,usage_knowledge,hold_tokens,hold_cost_usd,actual_tokens,actual_cost_usd,pricing_version,failure_code,in_flight_until,idempotency_key";
  const [
    steps,
    reservations,
    findings,
    approvals,
    proposals,
    disallowedToolEventCount,
    toolClassCounts,
  ] = await Promise.all([
    client
      .from("agent_steps")
      .select(
        "id,step_kind,status,idempotency_key,output_payload,tokens_used,cost_usd,pricing_version",
      )
      .eq("run_id", runId),
    client
      .from("agent_provider_reservations")
      .select(reservationSelect)
      .eq("run_id", runId)
      .eq("idempotency_key", providerAttemptKey(runId)),
    client
      .from("custodian_findings")
      .select("id", { count: "exact", head: true })
      .eq("origin_run_id", runId),
    client
      .from("approval_requests")
      .select("id")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("change_proposals")
      .select("id")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1),
    countDisallowedToolEvents(client as unknown as DisallowedToolEventCounter, runId),
    countKnownDisallowedToolClasses(client as unknown as DisallowedToolEventCounter, runId),
  ]);
  if (
    steps.error ||
    reservations.error ||
    findings.error ||
    approvals.error ||
    proposals.error ||
    disallowedToolEventCount === null ||
    toolClassCounts === null
  ) {
    return null;
  }
  const parsedSteps = (steps.data ?? [])
    .map((row) => stepArtifact(row))
    .filter((row): row is StepArtifact => row !== null);
  const reservationRow = reservations.data?.[0];
  const reservation = reservationRow ? parseReservationView(reservationRow) : null;
  if (reservationRow && !reservation) return null;
  const approvalId =
    approvals.data && approvals.data[0] && typeof approvals.data[0].id === "string"
      ? approvals.data[0].id
      : null;
  const proposalId =
    proposals.data && proposals.data[0] && typeof proposals.data[0].id === "string"
      ? proposals.data[0].id
      : null;
  return {
    steps: parsedSteps,
    reservation,
    findingCount: findings.count ?? 0,
    approvalId,
    proposalId,
    toolOperationClasses: null,
    toolClassCounts,
    disallowedToolEventCount,
  };
}

function createCustodianIo(auth: AuthenticatedSupabase): CustodianIo {
  const ownerId = auth.user.id;
  return {
    getRun: (runId) => getRun(auth.client, runId),
    getBudget: async (runId) => {
      const budget = await getBudget(auth.client, runId);
      const snapshot: BudgetSnapshot = {
        allowed: budget.allowed,
        reason: budget.reason,
        run_tokens_remaining: budget.run_tokens_remaining,
        run_cost_remaining: budget.run_cost_remaining,
        run_latency_remaining: budget.run_latency_remaining,
      };
      return snapshot;
    },
    transitionRun: (run, invocationKey, nextStatus, patch) =>
      transitionRun(auth.client, run as AgentRun, invocationKey, nextStatus, patch),
    recordStep: (input) =>
      recordStep(
        auth.client,
        ownerId,
        input.run as AgentRun,
        input.idempotencyKey,
        input.stepKind,
        input.idempotencyKey,
        input.modelTier,
        input.inputPayload,
        input.outputPayload,
        input.status ?? "completed",
        input.usage,
      ),
    resolveAllowedModelTiers: (run) =>
      resolveAllowedModelTiers(auth.client, ownerId, run as AgentRun),
    getReservation: (runId, idempotencyKey) => readReservation(auth.client, runId, idempotencyKey),
    reserveProviderCall: (runId, idempotencyKey, payload) =>
      rpc(auth.client, "custodian_reserve_provider_call", {
        run_id_value: runId,
        idempotency_key: idempotencyKey,
        reservation_payload: payload,
      }),
    settleProviderReservation: async (runtimeOwnerId, runId, idempotencyKey, settlement) => {
      const value = await rpc(trustedRuntimeClient(), "custodian_settle_provider_reservation", {
        runtime_owner_id: runtimeOwnerId,
        run_id: runId,
        idempotency_key: idempotencyKey,
        settlement,
      });
      if (!isObject(value) || !isObject(value.run)) throw new RpcFailure();
      const reservation = parseReservationView(value.reservation);
      if (!reservation) throw new RpcFailure();
      return { run: parseAgentRun({ run: value.run }), reservation };
    },
    getStepByIdempotency: (runId, idempotencyKey) => readStep(auth.client, runId, idempotencyKey),
    materializeFindings: (runtimeOwnerId, stepId) =>
      materializeRuntimeFindings(runtimeOwnerId, stepId),
    createApproval: (run, output) => createApproval(auth.client, run as AgentRun, output),
    readVerificationArtifacts: (runId) => readVerificationArtifacts(auth.client, runId),
    getEnv: (name) => Deno.env.get(name),
    fetchProvider: (url, init) => fetch(url, init),
    trustedRuntimeAvailable: () =>
      Boolean(Deno.env.get("SUPABASE_URL") && Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
    now: () => Date.now(),
  };
}

export async function handleRequest(request: Request): Promise<Response> {
  const requestOrigin = request.headers.get("Origin");
  const origin = allowedOrigin(requestOrigin);
  if (requestOrigin && !origin) return jsonResponse({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    return jsonResponse({ error: "Request is too large." }, 413, origin);
  }

  let auth: AuthenticatedSupabase | null;
  try {
    auth = await authenticatedSupabase(request);
  } catch {
    return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503, origin);
  }
  if (!auth) return jsonResponse({ error: "Sign in is required." }, 401, origin);

  let body: { value: JsonRecord | null; tooLarge: boolean };
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonResponse({ error: "Request must be valid JSON." }, 400, origin);
  }
  if (body.tooLarge) return jsonResponse({ error: "Request is too large." }, 413, origin);
  const invocation = parseInvocationPayload(body.value);
  if (!invocation)
    return jsonResponse(
      { error: "Request must contain only a valid runId and invocationKey." },
      400,
      origin,
    );

  try {
    const advanced = await advanceCustodianRun({
      io: createCustodianIo(auth),
      ownerId: auth.user.id,
      invocation,
      providerExecutionUnsupported: PROVIDER_EXECUTION_UNSUPPORTED,
      validSynthesis,
    });
    return jsonResponse(advanced.body, advanced.status, origin);
  } catch (error) {
    if (error instanceof SafeFailure) {
      return jsonResponse({ error: error.publicMessage }, error.status, origin);
    }
    return jsonResponse({ error: "Custodian runtime is temporarily unavailable." }, 503, origin);
  }
}

if (typeof Deno !== "undefined" && import.meta.main) Deno.serve(handleRequest);
