import OpenAI from "npm:openai@7.20.0";
import { zodTextFormat } from "npm:openai@7.20.0/helpers/zod";
import { z } from "npm:zod@3.25.76/v4";
import {
  buildSynthesisParams,
  classifySynthesisOutput,
  createOpenAiClient,
  interpretSynthesisResponse,
  OPENAI_BASE_URL,
  OPENAI_RESPONSES_URL,
  sendSynthesisRequest,
  serializedRequestBytes,
  singleRequestTransport,
  type ProviderExchange,
  type ProviderFetch,
} from "./openai-provider.ts";
import { providerDiagnostic, safeErrorParam, safeRequestId } from "./openai-diagnostics.ts";
import { APPROVAL_KINDS, synthesisTextFormat } from "./openai-schema.ts";
import { UNTRUSTED_EVIDENCE_SYSTEM_GUARD } from "./runtime.ts";

const apiKey = "sk-test-adapter-key";
const EVIDENCE_SENTINEL = "evidence-sentinel-7f3a";
const PROMPT_SENTINEL = "system-policy-sentinel-91c2";
const LEAKED_MESSAGE = `Authorization: Bearer ${apiKey} ${PROMPT_SENTINEL} ${EVIDENCE_SENTINEL}`;

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function params(maxOutputTokens = 512) {
  return buildSynthesisParams({
    model: "gpt-5.6-luna",
    systemPrompt: `Apply the owner policy. ${PROMPT_SENTINEL}`,
    untrustedEvidence: { objective: "bounded", evidence: { note: EVIDENCE_SENTINEL } },
    maxOutputTokens,
  });
}

type Transport = { fetch: ProviderFetch; calls: Array<{ url: string; init: RequestInit }> };

function transport(respond: (init: RequestInit) => Promise<Response>): Transport {
  const calls: Transport["calls"] = [];
  return {
    calls,
    fetch: (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return respond(init);
    },
  };
}

function send(fake: Transport, timeoutMs = 5_000): Promise<ProviderExchange> {
  return sendSynthesisRequest({ apiKey, fetch: fake.fetch, timeoutMs, params: params() });
}

function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "content-type": typeof body === "string" ? "text/plain" : "application/json",
      // Headers that would make a retrying client try again immediately.
      "x-should-retry": "true",
      "retry-after-ms": "0",
      ...headers,
    },
  });
}

function successBody() {
  return {
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              summary: "s",
              findings: [],
              requiresApproval: false,
              approvalKind: "tool_action",
            }),
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

function assertNoLeak(value: unknown): void {
  const text = JSON.stringify(value);
  for (const forbidden of [apiKey, "Bearer", "Authorization", PROMPT_SENTINEL, EVIDENCE_SENTINEL]) {
    if (text.includes(forbidden)) throw new Error(`diagnostic leaked ${forbidden}`);
  }
}

type SchemaNode = Record<string, unknown>;

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "description",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "anyOf",
]);

function walkSchema(
  node: SchemaNode,
  path: string,
  depth: number,
  visit: (node: SchemaNode, path: string, depth: number) => void,
): void {
  visit(node, path, depth);
  if (node.properties && typeof node.properties === "object") {
    for (const [key, child] of Object.entries(node.properties as Record<string, SchemaNode>)) {
      walkSchema(child, `${path}.${key}`, depth + 1, visit);
    }
  }
  if (node.items && typeof node.items === "object") {
    walkSchema(node.items as SchemaNode, `${path}[]`, depth + 1, visit);
  }
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, index) =>
      walkSchema(child as SchemaNode, `${path}|${index}`, depth, visit),
    );
  }
}

/** Throws for any construct outside the documented Structured Outputs subset. */
function assertStrictStructuredOutputSchema(schema: SchemaNode): string[] {
  const propertyNames: string[] = [];
  if (schema.type !== "object" || "anyOf" in schema) throw new Error("root must be an object");
  walkSchema(schema, "$", 0, (node, path, depth) => {
    if (depth > 10) throw new Error(`${path} nests deeper than 10 levels`);
    for (const key of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) throw new Error(`${path} uses unsupported ${key}`);
    }
    if (node.type === "object") {
      const properties = node.properties as Record<string, unknown> | undefined;
      if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
        throw new Error(`${path} is an object without fixed properties`);
      }
      if (node.additionalProperties !== false) {
        throw new Error(`${path} must set additionalProperties false`);
      }
      const required = [...((node.required as string[] | undefined) ?? [])].sort();
      const keys = Object.keys(properties).sort();
      if (JSON.stringify(required) !== JSON.stringify(keys)) {
        throw new Error(`${path} must require every property`);
      }
      propertyNames.push(...keys);
    }
    if (node.type === "array" && (!node.items || typeof node.items !== "object")) {
      throw new Error(`${path} is an array without items`);
    }
    if ("additionalProperties" in node && node.type !== "object") {
      throw new Error(`${path} declares additionalProperties on a non-object`);
    }
  });
  return propertyNames;
}

Deno.test("the Edge test run has no network permission, so no test can contact OpenAI", () => {
  const state = Deno.permissions.querySync({ name: "net" }).state;
  if (state === "granted") throw new Error("Edge tests must run without --allow-net");
});

Deno.test("the generated Structured Outputs format is strict, fixed, and authority-free", () => {
  const format = synthesisTextFormat();
  assertEquals(Object.keys(format), ["type", "name", "strict", "schema"], "format keys");
  assertEquals(format.type, "json_schema");
  assertEquals(format.name, "custodian_synthesis");
  assertEquals(format.strict, true);
  const schema = format.schema as SchemaNode;
  const names = assertStrictStructuredOutputSchema(schema);
  assertEquals(
    schema.required,
    ["summary", "findings", "requiresApproval", "approvalKind"],
    "root required",
  );
  const findings = (schema.properties as Record<string, SchemaNode>).findings;
  assertEquals(
    (findings.items as SchemaNode).required,
    [
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
    ],
    "finding required",
  );
  assertEquals(
    ((schema.properties as Record<string, SchemaNode>).approvalKind as SchemaNode).enum,
    [...APPROVAL_KINDS],
    "approval kinds",
  );
  for (const forbidden of ["proposedDiff", "toolAction", "action", "tool", "command", "execute"]) {
    if (names.includes(forbidden)) throw new Error(`schema grants ${forbidden}`);
  }
  const serialized = JSON.stringify(format);
  for (const keyword of ["maxLength", "minLength", "patternProperties", "propertyNames"]) {
    if (serialized.includes(`"${keyword}"`)) throw new Error(`schema emits ${keyword}`);
  }
  if (serialized.length > 120_000) throw new Error("schema exceeds the documented size budget");
});

Deno.test("the guardrail rejects the legacy property-less action objects", () => {
  const legacy: SchemaNode = {
    type: "object",
    additionalProperties: false,
    required: ["toolAction"],
    properties: { toolAction: { type: "object", additionalProperties: false } },
  };
  let rejected = false;
  try {
    assertStrictStructuredOutputSchema(legacy);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true, "legacy schema rejected");
  let recordRejected = false;
  try {
    assertStrictStructuredOutputSchema({
      type: "object",
      additionalProperties: false,
      required: ["map"],
      properties: { map: { type: "object", additionalProperties: { type: "string" } } },
    });
  } catch {
    recordRejected = true;
  }
  assertEquals(recordRejected, true, "record schema rejected");
});

Deno.test("the official helper keeps nullable fields required and refuses omitted fields", () => {
  const nullable = zodTextFormat(z.strictObject({ note: z.string().nullable() }), "probe");
  const schema = nullable.schema as SchemaNode;
  assertEquals(schema.required, ["note"], "nullable stays required");
  const note = (schema.properties as Record<string, SchemaNode>).note;
  assertEquals(note.anyOf, [{ type: "string" }, { type: "null" }], "nullable union");
  assertStrictStructuredOutputSchema(schema);
  let optionalRejected = false;
  try {
    zodTextFormat(z.strictObject({ note: z.string().optional() }), "probe");
  } catch {
    optionalRejected = true;
  }
  assertEquals(optionalRejected, true, "optional omitted field refused");
});

Deno.test("synthesis params are stored-off, bounded, and carry the Zod format", () => {
  const request = params(4096);
  assertEquals(request.model, "gpt-5.6-luna");
  assertEquals(request.store, false);
  assertEquals(request.max_output_tokens, 4096);
  assertEquals(JSON.stringify(request.text), JSON.stringify({ format: synthesisTextFormat() }));
  for (const key of ["background", "reasoning", "stream", "tools", "previous_response_id"]) {
    if (key in request) throw new Error(`unexpected ${key}`);
  }
  const input = request.input as Array<{ role: string; content: Array<{ text: string }> }>;
  assertEquals(
    input.map((item) => item.role),
    ["system", "user"],
  );
  if (!input[0].content[0].text.includes(UNTRUSTED_EVIDENCE_SYSTEM_GUARD)) {
    throw new Error("system message must carry the untrusted-evidence guard");
  }
  if (input[0].content[0].text.includes(EVIDENCE_SENTINEL)) {
    throw new Error("evidence must stay out of the system message");
  }
  for (const bad of ["   ", "x".repeat(8_001)]) {
    let rejected = false;
    try {
      buildSynthesisParams({
        model: "gpt-5.6-luna",
        systemPrompt: bad,
        untrustedEvidence: {},
        maxOutputTokens: 64,
      });
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, "invalid system prompt");
  }
  for (const maxOutputTokens of [0, 1, 15, 16.5]) {
    let rejected = false;
    try {
      params(maxOutputTokens);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, `max_output_tokens ${maxOutputTokens}`);
  }
  assertEquals(params(16).max_output_tokens, 16);
});

Deno.test("the SDK client is pinned to one attempt, the OpenAI origin, and no logging", () => {
  const client = createOpenAiClient({ apiKey, fetch: () => Promise.reject(), timeoutMs: 1234 });
  assertEquals(client.maxRetries, 0);
  assertEquals(client.baseURL, OPENAI_BASE_URL);
  assertEquals(client.timeout, 1234);
  assertEquals(client.logLevel, "off");
  assertEquals(client.organization, null);
  assertEquals(client.project, null);
});

Deno.test("the SDK sends exactly the counted request body to the Responses endpoint", async () => {
  const fake = transport(() =>
    Promise.resolve(Response.json(successBody(), { headers: { "x-request-id": "req_success01" } })),
  );
  const request = params();
  const exchange = await sendSynthesisRequest({
    apiKey,
    fetch: fake.fetch,
    timeoutMs: 5_000,
    params: request,
  });
  assertEquals(fake.calls.length, 1, "one fetch");
  const [call] = fake.calls;
  assertEquals(call.url, OPENAI_RESPONSES_URL);
  assertEquals(call.init.method, "POST");
  assertEquals(new Headers(call.init.headers).get("authorization"), `Bearer ${apiKey}`);
  const body = String(call.init.body);
  assertEquals(new TextEncoder().encode(body).byteLength, serializedRequestBytes(request));
  const sent = JSON.parse(body);
  assertEquals(sent.store, false);
  assertEquals(sent.max_output_tokens, 512);
  assertEquals(sent.text, JSON.parse(JSON.stringify({ format: synthesisTextFormat() })));
  assertEquals(exchange.kind, "response");
  if (exchange.kind !== "response") return;
  assertEquals(exchange.diagnostic, { httpStatus: 200, requestId: "req_success01" });
  const read = interpretSynthesisResponse(exchange.body);
  assertEquals(read.kind === "read" && read.usage?.tokens, 15);
  assertEquals(read.kind === "read" && read.output.kind, "json");
});

Deno.test("every retryable-looking HTTP failure makes exactly one fetch", async () => {
  const cases: Array<[number, unknown, string]> = [
    [
      400,
      { error: { type: "invalid_request_error", code: "invalid_json_schema" } },
      "openai_request_rejected",
    ],
    [400, "<html>bad request</html>", "openai_request_rejected"],
    [
      401,
      { error: { type: "invalid_request_error", code: "invalid_api_key" } },
      "openai_authentication_failed",
    ],
    [
      403,
      { error: { type: "permission_error", code: "unsupported_country" } },
      "openai_permission_denied",
    ],
    [
      403,
      { error: { type: "insufficient_quota", code: "insufficient_quota" } },
      "openai_quota_exceeded",
    ],
    [
      404,
      { error: { type: "invalid_request_error", code: "model_not_found" } },
      "openai_model_unavailable",
    ],
    [408, { error: { type: "timeout", code: null } }, "openai_request_rejected"],
    [409, { error: { type: "conflict", code: null } }, "openai_request_rejected"],
    [
      429,
      { error: { type: "rate_limit_error", code: "rate_limit_exceeded" } },
      "openai_rate_limited",
    ],
    [
      429,
      { error: { type: "insufficient_quota", code: "insufficient_quota" } },
      "openai_quota_exceeded",
    ],
    [500, { error: { type: "server_error", code: "server_error" } }, "openai_server_error"],
    [502, "bad gateway", "openai_unavailable"],
    [
      503,
      { error: { type: "service_unavailable_error", code: "server_is_overloaded" } },
      "openai_unavailable",
    ],
  ];
  for (const [status, body, code] of cases) {
    const fake = transport(() =>
      Promise.resolve(errorResponse(status, body, { "x-request-id": `req_${status}` })),
    );
    const exchange = await send(fake);
    assertEquals(fake.calls.length, 1, `${status} fetches`);
    assertEquals(exchange.kind, "failure", `${status} kind`);
    if (exchange.kind !== "failure") continue;
    assertEquals(exchange.code, code, `${status} code`);
    assertEquals(exchange.diagnostic.contact_state, "contacted", `${status} contact`);
    assertEquals(exchange.diagnostic.http_status, status, `${status} http`);
    assertEquals(exchange.diagnostic.request_id, `req_${status}`, `${status} request id`);
    assertEquals(exchange.diagnostic.classification, code, `${status} classification`);
    assertNoLeak(exchange);
  }
});

Deno.test(
  "control: this fake transport does observe retries from a default SDK client",
  async () => {
    // Proves the one-fetch assertions above are not vacuous: an SDK client with
    // its default retry policy retries the same 503 through the same transport.
    const fake = transport(() =>
      Promise.resolve(errorResponse(503, { error: { type: "server_error", code: null } })),
    );
    const defaultClient = new OpenAI({
      apiKey,
      baseURL: OPENAI_BASE_URL,
      organization: null,
      project: null,
      webhookSecret: null,
      fetch: fake.fetch,
      logLevel: "off",
    });
    let failed = false;
    try {
      await defaultClient.responses.create(params());
    } catch {
      failed = true;
    }
    assertEquals(failed, true, "default client failed");
    assertEquals(fake.calls.length, 3, "default client retried twice");

    const pinned = transport(() =>
      Promise.resolve(errorResponse(503, { error: { type: "server_error", code: null } })),
    );
    await send(pinned);
    assertEquals(pinned.calls.length, 1, "Custodian adapter did not retry");
  },
);

Deno.test("network failure and timeouts make at most one fetch and stay uncertain", async () => {
  const network = transport(() => Promise.reject(new TypeError(LEAKED_MESSAGE)));
  const failed = await send(network);
  assertEquals(network.calls.length, 1, "network fetches");
  assertEquals(failed.kind === "failure" && failed.code, "openai_unavailable");
  assertEquals(failed.kind === "failure" && failed.diagnostic.contact_state, "contact_uncertain");
  assertEquals(failed.kind === "failure" && failed.diagnostic.http_status, null);
  assertNoLeak(failed);

  const hanging = transport(
    (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  );
  const timedOut = await send(hanging, 30);
  assertEquals(hanging.calls.length, 1, "timeout fetches");
  assertEquals(timedOut.kind === "failure" && timedOut.code, "openai_timeout");
  assertEquals(
    timedOut.kind === "failure" && timedOut.diagnostic.contact_state,
    "contact_uncertain",
  );

  const stalled = transport((init) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () =>
              controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req_stall" },
        },
      ),
    ),
  );
  const stalledResult = await send(stalled, 30);
  assertEquals(stalled.calls.length, 1, "stalled fetches");
  assertEquals(stalledResult.kind === "failure" && stalledResult.code, "openai_timeout");
  assertEquals(
    stalledResult.kind === "failure" && stalledResult.diagnostic.contact_state,
    "contacted",
  );
  assertEquals(stalledResult.kind === "failure" && stalledResult.diagnostic.http_status, 200);
  assertEquals(
    stalledResult.kind === "failure" && stalledResult.diagnostic.request_id,
    "req_stall",
  );
});

Deno.test("a malformed 2xx body is an invalid response after one fetch", async () => {
  const fake = transport(() =>
    Promise.resolve(new Response("{", { headers: { "content-type": "application/json" } })),
  );
  const exchange = await send(fake);
  assertEquals(fake.calls.length, 1);
  assertEquals(exchange.kind === "failure" && exchange.code, "openai_invalid_response");
  assertEquals(exchange.kind === "failure" && exchange.diagnostic.http_status, 200);
});

Deno.test("the transport refuses a second request before reaching the network", async () => {
  let underlying = 0;
  const guarded = singleRequestTransport(() => {
    underlying += 1;
    return Promise.resolve(new Response("{}", { headers: { "x-request-id": "req_once" } }));
  });
  await guarded.fetch(OPENAI_RESPONSES_URL, { method: "POST" });
  let refused = false;
  try {
    await guarded.fetch(OPENAI_RESPONSES_URL, { method: "POST" });
  } catch {
    refused = true;
  }
  assertEquals(refused, true, "second request refused");
  assertEquals(underlying, 1, "underlying transport calls");
  assertEquals(guarded.observed(), { httpStatus: 200, requestId: "req_once" });
});

Deno.test("diagnostics keep safe tokens and discard unsafe or free-text values", async () => {
  const rejected = transport(() =>
    Promise.resolve(
      errorResponse(
        400,
        {
          error: {
            message: LEAKED_MESSAGE,
            type: "invalid_request_error",
            code: "invalid_json_schema",
            param: "text.format.schema.properties.findings.items[0]",
          },
        },
        { "x-request-id": "req_0123456789abcdef" },
      ),
    ),
  );
  const exchange = await send(rejected);
  assertEquals(exchange.kind === "failure" && exchange.diagnostic, {
    provider: "openai",
    contact_state: "contacted",
    classification: "openai_request_rejected",
    http_status: 400,
    request_id: "req_0123456789abcdef",
    error_type: "invalid_request_error",
    error_code: "invalid_json_schema",
    error_param: "text.format.schema.properties.findings.items[0]",
    incomplete_reason: null,
  });
  assertNoLeak(exchange);

  const unsafe = transport(() =>
    Promise.resolve(
      errorResponse(
        400,
        {
          error: {
            message: LEAKED_MESSAGE,
            type: "Invalid Request",
            code: "x".repeat(81),
            param: `text.format ${LEAKED_MESSAGE}`,
          },
        },
        { "x-request-id": "req with spaces" },
      ),
    ),
  );
  const unsafeExchange = await send(unsafe);
  if (unsafeExchange.kind !== "failure") throw new Error("expected failure");
  assertEquals(unsafeExchange.diagnostic.error_type, null);
  assertEquals(unsafeExchange.diagnostic.error_code, null);
  assertEquals(unsafeExchange.diagnostic.error_param, null);
  assertEquals(unsafeExchange.diagnostic.request_id, null);
  assertNoLeak(unsafeExchange);

  assertEquals(safeErrorParam("input[0].content[1].text"), "input[0].content[1].text");
  assertEquals(safeErrorParam("x".repeat(201)), null);
  assertEquals(safeErrorParam('text.format"'), null);
  assertEquals(safeRequestId(`req_${"a".repeat(124)}`), `req_${"a".repeat(124)}`);
  assertEquals(safeRequestId(`req_${"a".repeat(125)}`), null);
  assertEquals(Object.keys(providerDiagnostic({ classification: "openai_timeout" })).sort(), [
    "classification",
    "contact_state",
    "error_code",
    "error_param",
    "error_type",
    "http_status",
    "incomplete_reason",
    "provider",
    "request_id",
  ]);
});

Deno.test("output classification separates refusal, incomplete, malformed, and JSON", () => {
  const message = (content: unknown[]) => [{ type: "message", role: "assistant", content }];
  assertEquals(
    classifySynthesisOutput({
      status: "completed",
      output: message([{ type: "refusal", refusal: "no" }]),
    }),
    { kind: "refusal" },
  );
  assertEquals(
    classifySynthesisOutput({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: message([{ type: "output_text", text: '{"summary":' }]),
    }),
    { kind: "incomplete", reason: "max_output_tokens" },
  );
  assertEquals(
    classifySynthesisOutput({
      status: "incomplete",
      incomplete_details: { reason: LEAKED_MESSAGE },
      output: [],
    }),
    { kind: "incomplete", reason: null },
  );
  assertEquals(
    classifySynthesisOutput({
      status: "completed",
      output: message([{ type: "output_text", text: 7 }]),
    }),
    { kind: "malformed" },
  );
  assertEquals(
    classifySynthesisOutput({
      status: "completed",
      output: message([{ type: "output_text", text: "[1]" }]),
    }),
    { kind: "malformed" },
  );
  assertEquals(classifySynthesisOutput({ status: "failed", output: [] }), { kind: "malformed" });
  assertEquals(classifySynthesisOutput("text"), { kind: "malformed" });
  assertEquals(interpretSynthesisResponse("plain text body"), { kind: "unreadable" });
  const noUsage = interpretSynthesisResponse({ ...successBody(), usage: undefined });
  assertEquals(noUsage.kind === "read" && noUsage.usage, null);
});
