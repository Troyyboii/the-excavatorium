import {
  authorizeDocumentFetchClient,
  authorizeDocumentFetchRequest,
  parseDocumentFetchClientAllowlist,
} from "./authorization.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPROVED_CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT = "33333333-3333-4333-8333-333333333333";

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ typ: "JWT" })}.${encode(claims)}.signature`;
}

function access(claims: Record<string, unknown>, allowlist?: string) {
  const authorization = token({ sub: USER_ID, ...claims });
  return authorizeDocumentFetchClient(
    `Bearer ${authorization}`,
    USER_ID,
    allowlist === undefined ? APPROVED_CLIENT : allowlist,
  );
}

Deno.test("fails closed for missing, malformed, and ordinary app authentication", () => {
  if (authorizeDocumentFetchClient(null, USER_ID, APPROVED_CLIENT) !== "client_missing")
    throw new Error("missing authorization was accepted");
  if (
    authorizeDocumentFetchClient("Basic not-a-token", USER_ID, APPROVED_CLIENT) !==
    "client_malformed"
  )
    throw new Error("malformed authorization was accepted");
  if (access({}) !== "client_malformed") throw new Error("ordinary app token was accepted");
  if (authorizeDocumentFetchClient("Bearer bad", USER_ID, APPROVED_CLIENT) !== "client_malformed")
    throw new Error("invalid token was accepted");
});

Deno.test("requires a verified token identity and an approved client claim", () => {
  if (access({ client_id: "not-a-uuid" }) !== "client_malformed")
    throw new Error("malformed client id was accepted");
  if (access({ client_id: OTHER_CLIENT }) !== "client_unapproved")
    throw new Error("unapproved client was accepted");
  if (access({ client_id: APPROVED_CLIENT }) !== "allowed")
    throw new Error("approved client was rejected");
  if (access({ azp: APPROVED_CLIENT }) !== "allowed") throw new Error("approved azp was rejected");
  const mismatched = token({ sub: OTHER_CLIENT, client_id: APPROVED_CLIENT });
  if (
    authorizeDocumentFetchClient(`Bearer ${mismatched}`, USER_ID, APPROVED_CLIENT) !==
    "client_malformed"
  )
    throw new Error("token for another user was accepted");
});

Deno.test("fails closed for missing or malformed allowlists and parses multiple IDs", () => {
  if (
    authorizeDocumentFetchClient(
      `Bearer ${token({ sub: USER_ID, client_id: APPROVED_CLIENT })}`,
      USER_ID,
      undefined,
    ) !== "configuration_invalid"
  )
    throw new Error("missing allowlist was accepted");
  if (access({ client_id: APPROVED_CLIENT }, "not-a-uuid") !== "configuration_invalid")
    throw new Error("malformed allowlist was accepted");
  const parsed = parseDocumentFetchClientAllowlist(` ${OTHER_CLIENT},${APPROVED_CLIENT} `);
  if (!parsed?.has(OTHER_CLIENT) || !parsed.has(APPROVED_CLIENT) || parsed.size !== 2)
    throw new Error("multiple allowlist IDs were not parsed");
});

Deno.test("ignores caller-supplied client ID headers", () => {
  const realToken = token({ sub: USER_ID, client_id: OTHER_CLIENT });
  const result = authorizeDocumentFetchRequest(
    new Request("https://example.test", {
      headers: { authorization: `Bearer ${realToken}`, "x-client-id": APPROVED_CLIENT },
    }),
    USER_ID,
    APPROVED_CLIENT,
  );
  if (result !== "client_unapproved") throw new Error("fake header could bypass token identity");
});
