export const MAX_REQUEST_BYTES = 110_000;

export type JsonObjectReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

export function declaredContentLengthExceedsLimit(
  contentLength: string | null,
  maxBytes = MAX_REQUEST_BYTES,
): boolean {
  if (contentLength === null) return false;
  if (!/^\d+$/.test(contentLength)) return true;

  const parsed = Number(contentLength);
  return !Number.isSafeInteger(parsed) || parsed > maxBytes;
}

export async function readJsonObjectBody(
  request: Request,
  maxBytes = MAX_REQUEST_BYTES,
): Promise<JsonObjectReadResult> {
  if (!request.body) {
    return { ok: false, status: 400, error: "Request must be valid JSON." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: "Request is too large." };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, status: 400, error: "Request must be valid JSON." };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: "Request must be a JSON object." };
  }

  return { ok: true, value: value as Record<string, unknown> };
}
