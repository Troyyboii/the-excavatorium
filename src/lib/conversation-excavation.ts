import { supabase } from "./supabase";
import type { ArchiveRecord, ProjectRoute } from "./types";
import { z } from "zod";

export const MAX_CONVERSATION_TRANSCRIPT_CHARS = 24_000;

const PROJECT_ROUTES = [
  "The Forge",
  "The Chamber",
  "The Book",
  "General",
  "Do not preserve",
] as const;

const ConversationExtractionSchema = z
  .object({
    title: z.string().max(240),
    summary: z.string().max(2_000),
    tags: z.array(z.string().max(48)).max(12),
    projectRoute: z.enum(PROJECT_ROUTES),
    highSignalFindings: z.string().max(5_000),
    decisionsMade: z.string().max(5_000),
    openLoops: z.string().max(5_000),
    reusablePrompts: z.string().max(5_000),
    memoryCandidates: z.string().max(5_000),
    suggestedRecordIds: z
      .array(z.string().uuid())
      .max(12)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

export type ConversationExtraction = z.infer<typeof ConversationExtractionSchema> & {
  projectRoute: ProjectRoute;
};

type CandidateRecord = Pick<ArchiveRecord, "id" | "title" | "recordType">;

export async function excavateConversation(
  rawConversationText: string,
  records: CandidateRecord[],
  signal?: AbortSignal,
): Promise<ConversationExtraction> {
  if (rawConversationText.trim().length === 0) {
    throw new Error("Paste a conversation before starting an excavation.");
  }
  if (rawConversationText.length > MAX_CONVERSATION_TRANSCRIPT_CHARS) {
    throw new Error(
      `Conversation text must be ${MAX_CONVERSATION_TRANSCRIPT_CHARS.toLocaleString()} characters or fewer.`,
    );
  }

  const { data, error } = await supabase.functions.invoke("conversation-extract", {
    body: {
      transcript: rawConversationText,
      candidateRecords: records.slice(0, 75).map(({ id, title, recordType }) => ({
        id,
        title,
        recordType,
      })),
    },
    signal,
  });

  if (error) {
    if (signal?.aborted) throw new DOMException("Excavation cancelled.", "AbortError");
    throw new Error("Excavation could not be completed. Please retry.");
  }

  const parsed = ConversationExtractionSchema.safeParse(data);
  if (!parsed.success) throw new Error("Excavation could not be completed. Please retry.");
  return parsed.data;
}
