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
  excavateAndSaveChatGptDocument,
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

type ExcavationRunner = (
  reference: ChatGptFileReference,
  ctx: ToolContext,
) => Promise<ExcavatedDocumentResult>;

async function defaultExcavationRunner(
  reference: ChatGptFileReference,
  ctx: ToolContext,
): Promise<ExcavatedDocumentResult> {
  const client = createDocumentIngestionClient(supabaseForUser(ctx));
  return excavateAndSaveChatGptDocument(reference, {
    client,
    mapDraft: mapDraftForSave,
  });
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

export async function handleExcavateDocument(
  { file }: { file: ChatGptFileReference },
  ctx: ToolContext,
  run: ExcavationRunner = defaultExcavationRunner,
): Promise<JsonToolResult> {
  const errorOptions = { includeStructuredContent: false } as const;
  const authError = await authResult(ctx, errorOptions);
  if (authError) return authError;
  try {
    return jsonResult(await run(file, ctx));
  } catch (error) {
    if (error instanceof DocumentIngestionError) {
      console.warn("mcp.excavate_document.failure", {
        code: error.code,
        diagnostic: safeDocumentIngestionDiagnostic(error.diagnostic),
      });
      return errorResult(
        error.code,
        documentIngestionErrorMessage(error.code, error.diagnostic),
        errorOptions,
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
    "Take the user-supplied PDF, Markdown document, or UTF-8 text file, excavate it through The Excavatorium's existing File Excavation system, and save the resulting Document in the authenticated owner's archive.",
  inputSchema: { file: fileSchema },
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
