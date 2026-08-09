import { supabase } from "./supabase";
import {
  documentDraftSchema,
  fingerprintFile,
  validateSelectedDocumentFile,
  type DocumentDraft,
} from "./document";
import type { ArchiveRecord } from "./types";

export type DocumentCandidateRecord = Pick<ArchiveRecord, "id" | "title" | "recordType">;

const GENERIC_RELAY_MESSAGE =
  "File excavation could not be reached. Check your connection and retry.";
const GENERIC_FAILURE_MESSAGE = "File excavation could not be completed. Please retry.";
const GENERIC_TIMEOUT_MESSAGE = "File excavation timed out before completion. Please retry.";

/**
 * Extracts the Edge Function's sanitized `{ error }` message from a Supabase
 * FunctionsHttpError. The response body is read from the error context only;
 * nothing else about the failure is surfaced, so secrets, prompts, upstream
 * payloads, and document text can never reach the UI.
 */
export async function sanitizedFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const response = context as Partial<Response> & { json?: unknown };
  const fallback = response.status === 504 ? GENERIC_TIMEOUT_MESSAGE : null;
  if (typeof response.json !== "function" || typeof response.clone !== "function") return fallback;
  let body: unknown;
  try {
    body = await (response.clone() as Response).json();
  } catch {
    return fallback;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const message = (body as { error?: unknown }).error;
  if (typeof message !== "string") return fallback;
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return fallback;
  return trimmed;
}

export async function excavateDocument(
  file: File,
  records: DocumentCandidateRecord[],
  signal?: AbortSignal,
): Promise<DocumentDraft> {
  const fileError = validateSelectedDocumentFile(file);
  if (fileError) throw new Error(fileError);
  const fingerprint = await fingerprintFile(file);
  if (signal?.aborted) throw new DOMException("Excavation cancelled.", "AbortError");

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("contentHash", fingerprint);
  body.append(
    "candidateRecords",
    JSON.stringify(
      records.slice(0, 75).map(({ id, title, recordType }) => ({ id, title, recordType })),
    ),
  );

  const { data, error } = await supabase.functions.invoke("document-extract", {
    body,
    signal,
  });
  if (error) {
    if (signal?.aborted) throw new DOMException("Excavation cancelled.", "AbortError");
    const message = await sanitizedFunctionErrorMessage(error);
    // A parsed body means the function responded: surface its sanitized text.
    // Otherwise the failure was network or relay level and stays generic.
    throw new Error(message ?? GENERIC_RELAY_MESSAGE);
  }
  const parsed = documentDraftSchema.safeParse(data);
  if (!parsed.success) throw new Error("File excavation returned an incomplete draft.");
  if (parsed.data.contentHash !== fingerprint) {
    throw new Error("The selected file changed while it was being excavated.");
  }
  return parsed.data;
}

export { GENERIC_FAILURE_MESSAGE, GENERIC_RELAY_MESSAGE, GENERIC_TIMEOUT_MESSAGE };
