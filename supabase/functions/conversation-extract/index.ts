import { createClient } from "npm:@supabase/supabase-js@2";
import {
  declaredContentLengthExceedsLimit,
  MAX_REQUEST_BYTES,
  readJsonObjectBody,
} from "./request.ts";

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

const projectRoutes = ["The Forge", "The Chamber", "The Book", "General", "Do not preserve"];

type CandidateRecord = { id: string; title: string; recordType: string };
type QuotaDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };

type Extraction = {
  title: string;
  summary: string;
  tags: string[];
  projectRoute: string;
  highSignalFindings: string;
  decisionsMade: string;
  openLoops: string;
  reusablePrompts: string;
  memoryCandidates: string;
  suggestedRecordIds: string[];
};

function allowedOrigins() {
  const origins = new Set(["https://the-excavatorium.lovable.app", "http://localhost:8080"]);
  const previewOrigin = Deno.env.get("LOVABLE_PREVIEW_ORIGIN");
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
    typeof output.projectRoute === "string" &&
    projectRoutes.includes(output.projectRoute) &&
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
    projectRoute: { type: "string", enum: projectRoutes },
    highSignalFindings: { type: "string", maxLength: 5_000 },
    decisionsMade: { type: "string", maxLength: 5_000 },
    openLoops: { type: "string", maxLength: 5_000 },
    reusablePrompts: { type: "string", maxLength: 5_000 },
    memoryCandidates: { type: "string", maxLength: 5_000 },
    suggestedRecordIds: { type: "array", maxItems: 12, items: { type: "string", maxLength: 64 } },
  },
};

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("Origin");
  const allowedOrigin = requestOrigin && allowedOrigins().has(requestOrigin) ? requestOrigin : null;
  if (requestOrigin && !allowedOrigin) return json({ error: "Origin is not allowed." }, 403);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(allowedOrigin) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, allowedOrigin);

  if (declaredContentLengthExceedsLimit(req.headers.get("content-length"), MAX_REQUEST_BYTES)) {
    return json({ error: "Request is too large." }, 413, allowedOrigin);
  }

  const authorization = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !supabaseAnonKey) {
    return json(
      { error: "Authentication or service configuration is unavailable." },
      401,
      allowedOrigin,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Sign in is required." }, 401, allowedOrigin);
  }

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

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return json(
      { error: "Excavation is not configured. Please try again later." },
      503,
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
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        store: false,
        max_output_tokens: 2_400,
        input: [
          {
            role: "system",
            content:
              "Extract a careful, neutral draft for a private technical archive. Do not invent facts. Use concise plain text. Suggested record IDs must only come from the supplied candidate records. Return empty strings or arrays when unsupported.",
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
});
