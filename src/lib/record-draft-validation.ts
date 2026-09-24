import { documentDataSchema, formatDocumentValidationIssues } from "./document";
import type {
  ConversationData,
  DecisionData,
  DocumentData,
  RecordType,
  RepositoryData,
  ToolData,
} from "./types";

/**
 * Client-side checks run before a record form is saved. Each record type has
 * its own branch; a type must never fall through to another type's validation
 * (a conversation was once validated as a document). The database remains the
 * authority on record shape.
 */
export function validateRecordDraft(
  recordType: RecordType,
  title: string,
  data: ToolData | RepositoryData | ConversationData | DecisionData | DocumentData,
  existingId?: string | null,
): string[] {
  if (title.trim() === "") return ["Title is required."];
  switch (recordType) {
    case "tool": {
      const d = data as ToolData;
      if (!d.category.trim()) return ["Category is required."];
      if (!d.status) return ["Status is required."];
      if (d.replacementToolId && d.replacementToolId === existingId)
        return ["Replacement tool cannot be the current record."];
      return [];
    }
    case "repository": {
      const d = data as RepositoryData;
      return d.githubUrl.trim() ? [] : ["GitHub URL is required."];
    }
    case "decision": {
      const d = data as DecisionData;
      if (!d.reason.trim()) return ["Reason is required."];
      if (!d.decisionDate) return ["Decision date is required."];
      if (!d.status) return ["Status is required."];
      if (!d.confidence) return ["Confidence is required."];
      if (d.supersedesDecisionId && d.supersedesDecisionId === existingId)
        return ["Supersedes cannot reference the current record."];
      return [];
    }
    case "conversation":
      // Title is the only required field; project route is optional metadata.
      return [];
    case "document": {
      const result = documentDataSchema.safeParse(data as DocumentData);
      return result.success ? [] : formatDocumentValidationIssues(result.error.issues);
    }
  }
}
