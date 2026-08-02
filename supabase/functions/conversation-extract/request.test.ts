import {
  MAX_REQUEST_BYTES,
  readJsonObjectBody,
} from "./request.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("reads a valid JSON object", async () => {
  const request = new Request("https://example.test/extract", {
    method: "POST",
    body: JSON.stringify({ transcript: "hello", candidateRecords: [] }),
  });

  const result = await readJsonObjectBody(request);
  assert(result.ok, "expected a valid JSON object");
  assert(result.value.transcript === "hello", "expected transcript to be preserved");
});

Deno.test("rejects an oversized body even when the declared length is forged", async () => {
  const request = new Request("https://example.test/extract", {
    method: "POST",
    headers: { "content-length": "1" },
    body: new Uint8Array(MAX_REQUEST_BYTES + 1),
  });

  const result = await readJsonObjectBody(request);
  assert(!result.ok, "expected an oversized request to fail");
  assert(result.status === 413, "expected a 413 response");
});

Deno.test("rejects malformed JSON", async () => {
  const request = new Request("https://example.test/extract", {
    method: "POST",
    body: "{not json}",
  });

  const result = await readJsonObjectBody(request);
  assert(!result.ok, "expected malformed JSON to fail");
  assert(result.status === 400, "expected a 400 response");
});
