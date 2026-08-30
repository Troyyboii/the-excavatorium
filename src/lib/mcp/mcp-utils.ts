import type { ToolContext } from "@lovable.dev/mcp-js";
import { mcpClientAccess } from "./security";

export const CANONICAL_RECORD_TYPES = [
  "tool",
  "repository",
  "conversation",
  "decision",
  "document",
] as const;

export type CanonicalRecordType = (typeof CANONICAL_RECORD_TYPES)[number];

export const RECORD_LIST_SELECT =
  "id,record_type,title,summary,tags,is_example,created_at,updated_at";
export const RECORD_DETAIL_SELECT = `${RECORD_LIST_SELECT},record_data`;

const SAFE_DATA_FIELDS: Record<CanonicalRecordType, readonly string[]> = {
  tool: [
    "category",
    "status",
    "whatCaughtMyEye",
    "whatItPromised",
    "whatActuallyHappened",
    "whatWorked",
    "whatFailed",
    "whyIKeptOrStoppedUsingIt",
    "revisitCondition",
    "finalVerdict",
    "replacementToolId",
    "lastReviewed",
  ],
  repository: [
    "githubUrl",
    "whatCaughtMyEye",
    "whatItClaims",
    "whatItActuallyDoes",
    "maintenanceImpression",
    "complexity",
    "risk",
    "integrationCost",
    "immediateUsefulness",
    "longTermValue",
    "finalVerdict",
    "recommendedAction",
    "lastReviewed",
  ],
  conversation: [
    "conversationDate",
    "projectRoute",
    "highSignalFindings",
    "decisionsMade",
    "openLoops",
    "reusablePrompts",
    "memoryCandidates",
    "rawConversationText",
  ],
  decision: [
    "reason",
    "trigger",
    "whatWouldChangeMyMind",
    "decisionDate",
    "status",
    "confidence",
    "supersedesDecisionId",
  ],
  document: [
    "originalFileName",
    "mimeType",
    "fileSizeBytes",
    "documentDate",
    "pageCount",
    "contentHash",
    "highSignalFindings",
    "keyClaims",
    "contradictions",
    "uncertainties",
    "sourceReferences",
    "projectRoute",
  ],
};

export type SafeRecord = {
  id: string;
  record_type: CanonicalRecordType;
  title: string;
  summary: string;
  tags: string[];
  is_example: boolean;
  created_at: string;
  updated_at: string;
  record_data?: Record<string, unknown>;
};

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_CONFIGURATION_ERROR"
  | "CLIENT_NOT_ALLOWED"
  | "INVALID_INPUT"
  | "FILE_UNAVAILABLE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "QUOTA_EXCEEDED"
  | "EXTRACTION_FAILED"
  | "SAVE_FAILED"
  | "NOT_FOUND"
  | "DATA_UNAVAILABLE"
  | "FOUNDATION_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE";

export type ToolErrorPayload = {
  error: {
    code: ErrorCode;
    message: string;
  };
};

export type JsonToolResult = {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ErrorResultOptions = {
  includeStructuredContent?: boolean;
};

const SAFE_ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "An authenticated OAuth session is required.",
  AUTH_CONFIGURATION_ERROR: "MCP authorization is temporarily unavailable.",
  CLIENT_NOT_ALLOWED: "This OAuth client is not permitted to access this server.",
  INVALID_INPUT: "The request input is invalid or exceeds the supported limit.",
  FILE_UNAVAILABLE: "The uploaded file is unavailable. Attach it again and retry.",
  FILE_TOO_LARGE: "The uploaded file exceeds the 10 MB document limit.",
  UNSUPPORTED_FILE: "Supported files are PDF, Markdown (.md), and plain text (.txt).",
  QUOTA_EXCEEDED: "Document excavation is temporarily rate limited. Please retry later.",
  EXTRACTION_FAILED: "The document could not be excavated.",
  SAVE_FAILED: "The excavated document could not be saved.",
  NOT_FOUND: "The requested archive item was not found.",
  DATA_UNAVAILABLE: "Archive data is temporarily unavailable.",
  FOUNDATION_UNAVAILABLE: "Custodian case/finding foundation is not available.",
  RUNTIME_UNAVAILABLE: "Custodian analysis runtime is not available.",
};

export function jsonResult(payload: Record<string, unknown>): JsonToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function errorResult(
  code: ErrorCode,
  message = SAFE_ERROR_MESSAGES[code],
  options: ErrorResultOptions = {},
): JsonToolResult {
  const payload: ToolErrorPayload = { error: { code, message } };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(options.includeStructuredContent === false ? {} : { structuredContent: payload }),
    isError: true,
  };
}

export async function authResult(
  ctx: ToolContext,
  options: ErrorResultOptions = {},
): Promise<JsonToolResult | null> {
  if (!ctx.isAuthenticated()) return errorResult("AUTH_REQUIRED", undefined, options);
  const access = await mcpClientAccess(ctx);
  if (access === "configuration_invalid") {
    return errorResult("AUTH_CONFIGURATION_ERROR", undefined, options);
  }
  return access === "allowed" ? null : errorResult("CLIENT_NOT_ALLOWED", undefined, options);
}

export function isCanonicalRecordType(value: unknown): value is CanonicalRecordType {
  return typeof value === "string" && CANONICAL_RECORD_TYPES.includes(value as CanonicalRecordType);
}

export function projectRecord(
  row: Record<string, unknown>,
  options: { includeRawConversationText?: boolean } = {},
): SafeRecord {
  const recordType = isCanonicalRecordType(row.record_type) ? row.record_type : "document";
  const recordData = isObject(row.record_data) ? row.record_data : {};
  const safeData: Record<string, unknown> = {};

  for (const field of SAFE_DATA_FIELDS[recordType]) {
    if (field === "rawConversationText" && !options.includeRawConversationText) continue;
    if (Object.prototype.hasOwnProperty.call(recordData, field)) {
      safeData[field] = cloneSafeValue(recordData[field]);
    }
  }

  return {
    id: String(row.id ?? ""),
    record_type: recordType,
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    is_example: row.is_example === true,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    record_data: safeData,
  };
}

export function withoutRecordData(record: SafeRecord): Omit<SafeRecord, "record_data"> {
  const { record_data: _recordData, ...summary } = record;
  return summary;
}

export function buildSearchFilter(query: string): string | null {
  const safeQuery = sanitizeSearchQuery(query);
  if (!safeQuery) return null;
  return `title.ilike.%${safeQuery}%,summary.ilike.%${safeQuery}%,tags.cs.{${safeQuery}}`;
}

export function buildTextSearchFilter(query: string): string | null {
  const safeQuery = sanitizeSearchQuery(query);
  if (!safeQuery) return null;
  return `title.ilike.%${safeQuery}%,summary.ilike.%${safeQuery}%`;
}

export function boundedLimit(value: number | undefined, defaultValue = 25, maximum = 100): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError("limit out of bounds");
  }
  return value;
}

export function mapSupabaseError(
  error: unknown,
  missingCode:
    | "FOUNDATION_UNAVAILABLE"
    | "RUNTIME_UNAVAILABLE"
    | "DATA_UNAVAILABLE" = "DATA_UNAVAILABLE",
): ErrorCode {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  if (code === "42P01" || code === "PGRST205" || /relation .* does not exist/i.test(message)) {
    return missingCode;
  }
  return "DATA_UNAVAILABLE";
}

export function compareProjectedRecords(records: SafeRecord[]) {
  const valuesByField = new Map<string, unknown[]>();
  for (const record of records) {
    const base = { ...record } as Record<string, unknown>;
    delete base.record_data;
    for (const [field, value] of Object.entries(base)) {
      if (field === "id") continue;
      const values = valuesByField.get(field) ?? [];
      values.push(value);
      valuesByField.set(field, values);
    }
    for (const field of new Set(records.flatMap((item) => Object.keys(item.record_data ?? {})))) {
      const values = valuesByField.get(`record_data.${field}`) ?? [];
      values.push(record.record_data?.[field]);
      valuesByField.set(`record_data.${field}`, values);
    }
  }

  const differences = Object.fromEntries(
    [...valuesByField.entries()]
      .filter(([, values]) => new Set(values.map((value) => stableJson(value))).size > 1)
      .map(([field, values]) => [field, values]),
  );
  return { recordIds: records.map((record) => record.id), differences };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSafeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneSafeValue);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      [
        "user_id",
        "seed_key",
        "storagePath",
        "extractedContentPath",
        "rawConversationText",
      ].includes(key)
    ) {
      continue;
    }
    result[key] = cloneSafeValue(nestedValue);
  }
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
