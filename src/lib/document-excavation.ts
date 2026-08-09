import { supabase } from "./supabase";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import {
  documentDraftSchema,
  fingerprintFile,
  validateSelectedDocumentFile,
  type DocumentDraft,
} from "./document";
import type { ArchiveRecord } from "./types";

export type DocumentCandidateRecord = Pick<ArchiveRecord, "id" | "title" | "recordType">;

const GENERIC_EXCAVATION_ERROR = "File excavation could not be completed. Please retry.";

async function excavationErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context?.json();
      if (
        body &&
        typeof body === "object" &&
        typeof body.error === "string" &&
        body.error.length > 0 &&
        body.error.length <= 240
      ) {
        return body.error;
      }
    } catch {
      // The response body may already be consumed or not be valid JSON.
    }
    return GENERIC_EXCAVATION_ERROR;
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return "The excavation service could not be reached. Please retry.";
  }
  return GENERIC_EXCAVATION_ERROR;
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
    throw new Error(await excavationErrorMessage(error));
  }
  const parsed = documentDraftSchema.safeParse(data);
  if (!parsed.success) throw new Error("File excavation returned an incomplete draft.");
  if (parsed.data.contentHash !== fingerprint) {
    throw new Error("The selected file changed while it was being excavated.");
  }
  return parsed.data;
}
