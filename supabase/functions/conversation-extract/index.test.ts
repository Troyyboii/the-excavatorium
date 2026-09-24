import { handleConversationExtract } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ownerId = "11111111-1111-4111-8111-111111111111";

function authClient(modelName: string | null = "gpt-5.6-terra") {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: ownerId } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: modelName ? { model_name: modelName } : null,
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc: async () => ({
      data: { allowed: true, remaining: 9, retryAfterSeconds: 0 },
      error: null,
    }),
  };
}

Deno.test("refuses conversation excavation when the owner key is missing", async () => {
  let fetched = false;
  const response = await handleConversationExtract(
    new Request("https://example.test/extract", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ transcript: "hello archive", candidateRecords: [] }),
    }),
    {
      getEnv: () => undefined,
      createUserClient: () => authClient() as never,
      resolveFunding: async () => ({ ok: false, reason: "provider_key_missing" }),
      fetchProvider: async () => {
        fetched = true;
        return new Response("should not run");
      },
    },
  );
  const body = await response.json();
  assert(response.status === 409, "expected conflict when key is missing");
  assert(body.code === "provider_key_missing", "expected provider_key_missing code");
  assert(
    typeof body.error === "string" && body.error.includes("Settings"),
    "expected clear Settings message",
  );
  assert(!fetched, "must not contact the provider");
  assert(!JSON.stringify(body).includes("OPENAI_API_KEY"), "must not mention operator key");
});

Deno.test("refuses conversation excavation when no model is selected", async () => {
  let fetched = false;
  const response = await handleConversationExtract(
    new Request("https://example.test/extract", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ transcript: "hello archive", candidateRecords: [] }),
    }),
    {
      getEnv: () => undefined,
      createUserClient: () => authClient(null) as never,
      resolveFunding: async () => ({ ok: false, reason: "model_not_selected" }),
      fetchProvider: async () => {
        fetched = true;
        return new Response("should not run");
      },
    },
  );
  const body = await response.json();
  assert(response.status === 409, "expected conflict when model is missing");
  assert(body.code === "model_not_selected", "expected model_not_selected code");
  assert(!fetched, "must not contact the provider");
});

Deno.test("uses the owner's key and model with store:false when funded", async () => {
  const apiKey = "sk-proj-TESTKEYTESTKEYTESTKEY1234";
  const captured: { authorization: string | null; body: Record<string, unknown> } = {
    authorization: null,
    body: {},
  };
  const response = await handleConversationExtract(
    new Request("https://example.test/extract", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ transcript: "hello archive", candidateRecords: [] }),
    }),
    {
      getEnv: () => undefined,
      createUserClient: () => authClient("gpt-5.6-sol") as never,
      resolveFunding: async () => ({ ok: true, apiKey, model: "gpt-5.6-sol" }),
      fetchProvider: async (_url, init) => {
        // Deno's fetch init type is a RequestInit union; narrow to the fields we assert.
        const options = (init ?? {}) as { headers?: HeadersInit; body?: BodyInit | null };
        const headers = new Headers(options.headers);
        captured.authorization = headers.get("Authorization");
        captured.body = JSON.parse(String(options.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      title: "Draft",
                      summary: "Summary",
                      tags: [],
                      projectRoute: "General",
                      highSignalFindings: "",
                      decisionsMade: "",
                      openLoops: "",
                      reusablePrompts: "",
                      memoryCandidates: "",
                      suggestedRecordIds: [],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    },
  );
  assert(response.status === 200, "expected a successful draft");
  assert(captured.authorization === `Bearer ${apiKey}`, "must use the owner key");
  assert(captured.body.model === "gpt-5.6-sol", "must use the owner model preference");
  assert(captured.body.store === false, "must keep store:false");
});
