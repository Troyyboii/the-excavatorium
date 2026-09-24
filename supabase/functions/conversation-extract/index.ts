import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  declaredContentLengthExceedsLimit,
  MAX_REQUEST_BYTES,
  readJsonObjectBody,
} from "./request.ts";
import {
  excavationFundingMessage,
  parseStoredCredential,
  resolveOwnerExcavationFunding,
  type ExcavationFunding,
  type ExcavationFundingFailure,
  type StoredCredential,
} from "../_shared/owner-excavation-funding.ts";
import { trustedRuntimeSupabase } from "../_shared/http.ts";

const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_CANDIDATE_RECORDS = 75;
const MAX_OUTPUT_CHARS = 40_000;
const OPENAI_TIMEOUT_MS = 25_000;

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin",
};


type CandidateRecord = { id: string; title: string; recordType: string };
type QuotaDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };

type Extraction = {
  title: string;
  summary: string;
  tags: string[];
  projectRoute: string | null;
  highSignalFindings: string;
  decisionsMade: string;
  openLoops: string;
  reusablePrompts: string;
  memoryCandidates: string;
  suggestedRecordIds: string[];
};

export type ConversationExtractDependencies = {
  getEnv?: (name: string) => string | undefined;
  createUserClient?: (authorization: string) => SupabaseClient;
  trustedClient?: () => SupabaseClient | null;
  resolveFunding?: (input: {
    ownerId: string;
    preferredModel: string | null;
    client: SupabaseClient;
  }) => Promise<ExcavationFunding>;
  fetchProvider?: typeof fetch;
};

function allowedOrigins(getEnv: (name: string) => string | undefined) {
  const origins = new Set(["https://the-excavatorium.lovable.app", "http://localhost:8080"]);
  const previewOrigin = getEnv("LOVABLE_PREVIEW_ORIGIN");
  if (previewOrigin) {
    try {
      const normalized = new URL(previewOrigin).origin;
      if (normalized.startsWith("https://") && normalized.endsWith(".lovable.app")) {
        origins.add(normalized);
      }
    } catch {
      // An invalid optional preview-origin setting must not broaden CORS access.
    }
  }
  return origins;
}

function responseHeaders(origin: string | null) {
  return origin ? { ...corsHeaders, "Access-Control-Allow-Origin": origin } : corsHeaders;
}

function json(
  body: Record<string, unknown>,
  status = 200,
  origin: string | null = null,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders(origin),
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isCandidateRecord(value: unknown): value is CandidateRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    ["id", "title", "recordType"].every((key) => key in record) &&
    typeof record.id === "string" &&
    record.id.length <= 64 &&
    typeof record.title === "string" &&
    record.title.length <= 240 &&
    typeof record.recordType === "string" &&
    ["tool", "repository", "conversation", "decision", "document"].includes(record.recordType)
  );
}

function sanitizeCandidateRecords(value: unknown): CandidateRecord[] | null {
  if (!Array.isArray(value) || value.length > MAX_CANDIDATE_RECORDS) return null;
  if (!value.every(isCandidateRecord)) return null;
  return value.map((record) => ({
    id: record.id,
    title: record.title,
    recordType: record.recordType,
  }));
}

function isStringList(value: unknown, maximum: number, itemMaximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && item.length <= itemMaximum)
  );
}

function isQuotaDecision(value: unknown): value is QuotaDecision {
  if (!value || typeof value !== "object") return false;
  const decision = value as Record<string, unknown>;
  const remaining = decision.remaining;
  const retryAfterSeconds = decision.retryAfterSeconds;
  return (
    typeof decision.allowed === "boolean" &&
    typeof remaining === "number" &&
    Number.isInteger(remaining) &&
    typeof retryAfterSeconds === "number" &&
    Number.isInteger(retryAfterSeconds) &&
    remaining >= 0 &&
    retryAfterSeconds >= 0
  );
}

function isExtraction(value: unknown, allowedIds: Set<string>): value is Extraction {
  if (!value || typeof value !== "object") return false;
  const output = value as Record<string, unknown>;
  return (
    typeof output.title === "string" &&
    output.title.length <= 240 &&
    typeof output.summary === "string" &&
    output.summary.length <= 2_000 &&
    isStringList(output.tags, 12, 48) &&
    // The model never invents a route; only an explicitly stated one is kept.
    (output.projectRoute === null ||
      (typeof output.projectRoute === "string" &&
        output.projectRoute.trim().length > 0 &&
        output.projectRoute.length <= 120)) &&
    [
      "highSignalFindings",
      "decisionsMade",
      "openLoops",
      "reusablePrompts",
      "memoryCandidates",
    ].every((key) => typeof output[key] === "string" && (output[key] as string).length <= 5_000) &&
    isStringList(output.suggestedRecordIds, 12, 64) &&
    (output.suggestedRecordIds as string[]).every((id) => allowedIds.has(id))
  );
}

function extractAssistantOutputText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  if (response.status !== "completed" || !Array.isArray(response.output)) return null;

  let text = "";
  let foundAssistantMessage = false;
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    if (message.type !== "message" || message.role !== "assistant") continue;
    foundAssistantMessage = true;
    if (!Array.isArray(message.content)) return null;
    for (const part of message.content) {
      if (!part || typeof part !== "object") return null;
      const content = part as Record<string, unknown>;
      if (content.type === "refusal") return null;
      if (content.type === "output_text") {
        if (typeof content.text !== "string") return null;
        text += content.text;
      }
    }
  }
  return foundAssistantMessage && text.length > 0 ? text : null;
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "tags",
    "projectRoute",
    "highSignalFindings",
    "decisionsMade",
    "openLoops",
    "reusablePrompts",
    "memoryCandidates",
    "suggestedRecordIds",
  ],
  properties: {
    title: { type: "string", maxLength: 240 },
    summary: { type: "string", maxLength: 2_000 },
    tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 48 } },
    projectRoute: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
    highSignalFindings: { type: "string", maxLength: 5_000 },
    decisionsMade: { type: "string", maxLength: 5_000 },
    openLoops: { type: "string", maxLength: 5_000 },
    reusablePrompts: { type: "string", maxLength: 5_000 },
    memoryCandidates: { type: "string", maxLength: 5_000 },
    suggestedRecordIds: { type: "array", maxItems: 12, items: { type: "string", maxLength: 64 } },
  },
};

function fundingStatus(reason: ExcavationFundingFailure): 409 {
  void reason;
  return 409;
}

async function defaultResolveFunding(input: {
  ownerId: string;
  preferredModel: string | null;
  client: SupabaseClient;
  getEnv: (name: string) => string | undefined;
  trustedClient: () => SupabaseClient | null;
}): Promise<ExcavationFunding> {
  return resolveOwnerExcavationFunding({
    ownerId: input.ownerId,
    preferredModel: input.preferredModel,
    getEnv: input.getEnv,
    fetchCredential: async (credentialOwnerId) => {
      const trusted = input.trustedClient();
      if (!trusted) throw new Error("trusted_runtime_unavailable");
      const { data, error } = await trusted.rpc("custodian_get_provider_credential", {
        runtime_owner_id: credentialOwnerId,
      });
      if (error) throw new Error("credential_lookup_failed");
      const parsed = parseStoredCredential(data);
      if (parsed === "malformed") throw new Error("credential_malformed");
      return parsed as StoredCredential | null;
    },
  });
}

export async function handleConversationExtract(
  req: Request,
  dependencies: ConversationExtractDependencies = {},
): Promise<Response> {
  const getEnv = dependencies.getEnv ?? ((name: string) => Deno.env.get(name));
  const fetchProvider = dependencies.fetchProvider ?? fetch;
  const trustedClient = dependencies.trustedClient ?? trustedRuntimeSupabase;
  const createUserClient =
    dependencies.createUserClient ??
    ((authorization: string) => {
      const supabaseUrl = getEnv("SUPABASE_URL");
      const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("service_configuration_unavailable");
      }
      return createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authorization } },
      });
    });

  const requestOrigin = req.headers.get("Origin");
  const origins = allowedOrigins(getEnv);
  const allowedOrigin = requestOrigin && origins.has(requestOrigin) ? requestOrigin : null;
  if (requestOrigin && !allowedOrigin) return json({ error: "Origin is not allowed." }, 403);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(allowedOrigin) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, allowedOrigin);

  if (declaredContentLengthExceedsLimit(req.headers.get("content-length"), MAX_REQUEST_BYTES)) {
    return json({ error: "Request is too large." }, 413, allowedOrigin);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return json(
      { error: "Authentication or service configuration is unavailable." },
      401,
      allowedOrigin,
    );
  }

  let supabase: SupabaseClient;
  try {
    supabase = createUserClient(authorization);
  } catch {
    return json(
      { error: "Authentication or service configuration is unavailable." },
      401,
      allowedOrigin,
    );
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Sign in is required." }, 401, allowedOrigin);
  }
  const ownerId = authData.user.id;

  const parsedBody = await readJsonObjectBody(req, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) return json({ error: parsedBody.error }, parsedBody.status, allowedOrigin);

  const transcript = parsedBody.value.transcript;
  const candidateRecords = sanitizeCandidateRecords(parsedBody.value.candidateRecords);
  if (
    typeof transcript !== "string" ||
    transcript.trim().length === 0 ||
    transcript.length > MAX_TRANSCRIPT_CHARS ||
    !candidateRecords
  ) {
    return json(
      { error: "Request content is invalid or exceeds the allowed size." },
      400,
      allowedOrigin,
    );
  }

  const { data: settings, error: settingsError } = await supabase
    .from("owner_provider_settings")
    .select("model_name")
    .eq("owner_id", ownerId)
    .eq("provider", "openai")
    .maybeSingle();
  if (settingsError) {
    return json(
      { error: "Excavation is temporarily unavailable. Please retry." },
      503,
      allowedOrigin,
    );
  }
  const preferredModel =
    settings && typeof settings.model_name === "string" ? settings.model_name : null;

  const resolveFunding =
    dependencies.resolveFunding ??
    ((input) =>
      defaultResolveFunding({
        ...input,
        getEnv,
        trustedClient,
      }));
  const funding = await resolveFunding({ ownerId, preferredModel, client: supabase });
  if (!funding.ok) {
    return json(
      { error: excavationFundingMessage(funding.reason), code: funding.reason },
      fundingStatus(funding.reason),
      allowedOrigin,
    );
  }

  const { data: quotaData, error: quotaError } = await supabase.rpc(
    "consume_conversation_extraction_quota",
  );
  if (quotaError || !isQuotaDecision(quotaData)) {
    return json(
      { error: "Excavation is temporarily unavailable. Please retry." },
      503,
      allowedOrigin,
    );
  }
  if (!quotaData.allowed) {
    return json(
      { error: "Excavation is temporarily rate limited. Please retry later." },
      429,
      allowedOrigin,
      { "Retry-After": String(Math.max(1, quotaData.retryAfterSeconds)) },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetchProvider("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${funding.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: funding.model,
        store: false,
        max_output_tokens: 2_400,
        input: [
          {
            role: "system",
            content:
              "Extract a careful, neutral draft for a private technical archive. Do not invent facts. Use concise plain text. Suggested record IDs must only come from the supplied candidate records. Return empty strings or arrays when unsupported. Set projectRoute to null unless the conversation explicitly names a project, workspace, or route; never invent or guess one.",
          },
          {
            role: "user",
            content: JSON.stringify({ transcript, candidateRecords }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "conversation_excavation",
            strict: true,
            schema: responseSchema,
          },
        },
      }),
    });

    if (!response.ok) {
      return json(
        { error: "Excavation service is temporarily unavailable. Please retry." },
        502,
        allowedOrigin,
      );
    }
    const upstream = await response.json();
    const outputText = extractAssistantOutputText(upstream);
    if (!outputText || outputText.length > MAX_OUTPUT_CHARS) {
      return json(
        { error: "The excavation response was invalid. Please retry." },
        502,
        allowedOrigin,
      );
    }

    let extraction: unknown;
    try {
      extraction = JSON.parse(outputText);
    } catch {
      return json(
        { error: "The excavation response was invalid. Please retry." },
        502,
        allowedOrigin,
      );
    }
    if (!isExtraction(extraction, new Set(candidateRecords.map((record) => record.id)))) {
      return json(
        { error: "The excavation response was invalid. Please retry." },
        502,
        allowedOrigin,
      );
    }
    return json(extraction as Record<string, unknown>, 200, allowedOrigin);
  } catch {
    return json(
      { error: "Excavation timed out or is unavailable. Please retry." },
      504,
      allowedOrigin,
    );
  } finally {
    clearTimeout(timeout);
  }
}

if (import.meta.main) Deno.serve((req) => handleConversationExtract(req));
