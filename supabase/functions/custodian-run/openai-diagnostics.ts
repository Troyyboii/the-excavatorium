/**
 * Safe provider diagnostic metadata. Only allowlisted structural tokens are
 * kept: HTTP status, validated error type/code/param, an opaque request id,
 * and the internal classification. Provider messages, bodies, headers,
 * prompts, evidence, output, and credentials are never read into this shape.
 * A value that fails validation is stored as null, never rewritten.
 */

const OPENAI_ERROR_TOKEN = /^[a-z0-9_]{1,80}$/;
const OPENAI_ERROR_PARAM = /^[A-Za-z0-9_.[\]-]{1,200}$/;
const OPENAI_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const OPENAI_QUOTA_ERROR_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

export type ProviderFailureCode =
  | "openai_authentication_failed"
  | "openai_permission_denied"
  | "openai_quota_exceeded"
  | "openai_rate_limited"
  | "openai_model_unavailable"
  | "openai_request_rejected"
  | "openai_server_error"
  | "openai_timeout"
  | "openai_invalid_response"
  | "openai_unavailable";

export type ProviderClassification =
  | ProviderFailureCode
  | "openai_completed"
  | "openai_refusal"
  | "openai_incomplete"
  | "openai_invalid_output"
  | "openai_usage_missing";

export type ProviderContactState = "contacted" | "contact_uncertain";

/** Exactly the fields accepted by custodian_record_provider_diagnostic. */
export type ProviderDiagnostic = {
  provider: "openai";
  contact_state: ProviderContactState;
  classification: ProviderClassification;
  http_status: number | null;
  request_id: string | null;
  error_type: string | null;
  error_code: string | null;
  error_param: string | null;
  incomplete_reason: string | null;
};

export function safeErrorToken(value: unknown): string | null {
  return typeof value === "string" && OPENAI_ERROR_TOKEN.test(value) ? value : null;
}

export function safeErrorParam(value: unknown): string | null {
  return typeof value === "string" && OPENAI_ERROR_PARAM.test(value) ? value : null;
}

export function safeRequestId(value: unknown): string | null {
  return typeof value === "string" && OPENAI_REQUEST_ID.test(value) ? value : null;
}

export function safeHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

/** Contact is established only by a received HTTP status. */
export function providerDiagnostic(input: {
  classification: ProviderClassification;
  httpStatus?: unknown;
  requestId?: unknown;
  errorType?: unknown;
  errorCode?: unknown;
  errorParam?: unknown;
  incompleteReason?: unknown;
}): ProviderDiagnostic {
  const httpStatus = safeHttpStatus(input.httpStatus);
  return {
    provider: "openai",
    contact_state: httpStatus === null ? "contact_uncertain" : "contacted",
    classification: input.classification,
    http_status: httpStatus,
    request_id: safeRequestId(input.requestId),
    error_type: safeErrorToken(input.errorType),
    error_code: safeErrorToken(input.errorCode),
    error_param: safeErrorParam(input.errorParam),
    incomplete_reason: safeErrorToken(input.incompleteReason),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reads only error.type and error.code. Messages and raw bodies are ignored. */
function openAiErrorTokens(body: unknown): { type: string | null; code: string | null } {
  if (!isObject(body)) return { type: null, code: null };
  const error = body.error;
  if (!isObject(error)) return { type: null, code: null };
  return { type: safeErrorToken(error.type), code: safeErrorToken(error.code) };
}

function isAllowlistedOpenAiQuota(type: string | null, code: string | null): boolean {
  return type === "insufficient_quota" || (code !== null && OPENAI_QUOTA_ERROR_CODES.has(code));
}

/**
 * Stable internal code for a non-2xx provider response.
 * Status decides the class. Validated error.type and error.code only separate an
 * allowlisted quota or spend failure from a 403 permission denial or a 429 rate
 * limit, and model-not-found from other 400 rejections.
 */
export function classifyOpenAiHttpFailure(status: number, body: unknown): ProviderFailureCode {
  const { type, code } = openAiErrorTokens(body);
  if (status === 401) return "openai_authentication_failed";
  if (status === 403) {
    if (isAllowlistedOpenAiQuota(type, code)) return "openai_quota_exceeded";
    return "openai_permission_denied";
  }
  if (status === 429) {
    if (isAllowlistedOpenAiQuota(type, code)) return "openai_quota_exceeded";
    return "openai_rate_limited";
  }
  if (status === 404 || (status === 400 && code === "model_not_found")) {
    return "openai_model_unavailable";
  }
  if (status >= 400 && status < 500) return "openai_request_rejected";
  if (status === 500) return "openai_server_error";
  return "openai_unavailable";
}
