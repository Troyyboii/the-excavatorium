import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  applyDocumentDraft,
  mergeDocumentSuggestedRecordIds,
  type DocumentDraft,
} from "../../document";
import { normalizeTags } from "../../format";
import { emptyDocumentData } from "../../types";
import {
  createDocumentIngestionClient,
  DocumentIngestionError,
  documentIngestionErrorMessage,
  downloadChatGptDocument,
  excavateAndSaveFile,
  fileFromText,
  fileReferenceForUrl,
  safeDocumentIngestionDiagnostic,
  type ChatGptFileReference,
  type ExcavatedDocumentResult,
} from "../document-ingestion";
import { authResult, errorResult, jsonResult, type JsonToolResult } from "../mcp-utils";
import { supabaseForUser } from "../supabase";

const fileSchema = z
  .object({
    download_url: z.string().url(),
    file_id: z.string().trim().min(1).max(512),
    mime_type: z.string().trim().min(1).max(120).optional(),
    file_name: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export type ExcavateDocumentInput = {
  file?: ChatGptFileReference;
  url?: string;
  text?: string;
  fileName?: string;
};

type ExcavationRunner = (file: File, ctx: ToolContext) => Promise<ExcavatedDocumentResult>;

type DocumentDownloader = (reference: ChatGptFileReference, ctx: ToolContext) => Promise<File>;

async function defaultExcavationRunner(
  file: File,
  ctx: ToolContext,
): Promise<ExcavatedDocumentResult> {
  const client = createDocumentIngestionClient(supabaseForUser(ctx));
  return excavateAndSaveFile(file, {
    client,
    mapDraft: mapDraftForSave,
  });
}

async function defaultDownloader(reference: ChatGptFileReference, ctx: ToolContext): Promise<File> {
  const client = createDocumentIngestionClient(supabaseForUser(ctx));
  return downloadChatGptDocument(reference, { fetchDocument: client.fetchDocument });
}

export function mapDraftForSave(draft: DocumentDraft, ownerCandidateIds: ReadonlySet<string>) {
  const applied = applyDocumentDraft(emptyDocumentData, draft);
  return {
    title: applied.title,
    summary: applied.summary,
    tags: normalizeTags(applied.tags),
    recordData: applied.data,
    selectedTargetIds: mergeDocumentSuggestedRecordIds(
      [],
      draft.suggestedRecordIds,
      ownerCandidateIds,
    ),
  };
}

function isTextFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 4 && trimmed.length <= 240 && /\.md$|\.txt$/i.test(trimmed);
}

export async function handleExcavateDocument(
  { file, url, text, fileName }: ExcavateDocumentInput,
  ctx: ToolContext,
  run: ExcavationRunner = defaultExcavationRunner,
  download: DocumentDownloader = defaultDownloader,
): Promise<JsonToolResult> {
  const errorOptions = { includeStructuredContent: false } as const;
  const authError = await authResult(ctx, errorOptions);
  if (authError) return authError;
  const modes = [file !== undefined, url !== undefined, text !== undefined].filter(Boolean).length;
  if (modes !== 1) return errorResult("INVALID_INPUT", undefined, errorOptions);
  try {
    if (file !== undefined) return jsonResult(await run(await download(file, ctx), ctx));
    if (url !== undefined) {
      const reference = await fileReferenceForUrl(url);
      return jsonResult(await run(await download(reference, ctx), ctx));
    }
    const name = (fileName ?? "").trim();
    if (text === undefined || !isTextFileName(name)) {
      return errorResult("INVALID_INPUT", undefined, errorOptions);
    }
    return jsonResult(await run(fileFromText(text, name), ctx));
  } catch (error) {
    if (error instanceof DocumentIngestionError) {
      const diagnostic = safeDocumentIngestionDiagnostic(error.diagnostic);
      console.warn("mcp.excavate_document.failure", {
        code: error.code,
        diagnostic,
      });
      return errorResult(
        error.code,
        documentIngestionErrorMessage(error.code, error.diagnostic, error.retryAfterSeconds),
        {
          ...errorOptions,
          diagnostic,
          ...(error.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      );
    }
    console.warn("mcp.excavate_document.failure", {
      code: "DATA_UNAVAILABLE",
      diagnostic: "unexpected_failure",
    });
    return errorResult("DATA_UNAVAILABLE", undefined, errorOptions);
  }
}

export default defineTool({
  name: "excavate_document",
  title: "Excavate and save document",
  description:
    "Use to archive a document from exactly one source per call: file for a ChatGPT-supplied file reference (download_url, file_id, optional mime_type/file_name); url for a public https URL up to 2048 chars, fetched server-side through the guarded document-fetch path (10 MB cap, no private hosts); text for pasting up to 60,000 UTF-8 bytes directly with a required fileName ending .md or .txt (max 240 chars). Every mode spends the owner's extraction quota, and already-archived content (matched by content hash) returns the existing document with isNew false instead of re-excavating. Returns id, isNew, title, recordType document, originalFileName, and contentHash. This is the only mutation; every other tool is read-only.",
  inputSchema: {
    file: fileSchema.optional(),
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => value.startsWith("https://"), "Only https URLs are supported.")
      .optional()
      .describe("Public https URL of a PDF, Markdown, or text document to fetch and archive."),
    text: z
      .string()
      .optional()
      .describe("Raw Markdown or plain-text content to archive (max 60,000 UTF-8 bytes)."),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional()
      .describe("File name for text, must end .md or .txt."),
  },
  outputSchema: {
    id: z.string().uuid(),
    isNew: z.boolean(),
    title: z.string().min(1).max(240),
    recordType: z.literal("document"),
    originalFileName: z.string().min(1).max(240),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: false,
  },
  handler: handleExcavateDocument,
});
