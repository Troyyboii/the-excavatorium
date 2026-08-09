import { z } from "zod";
import type { DocumentData, DocumentInsight, DocumentSourceReference } from "./types";

export const DOCUMENT_MAX_FILE_BYTES = 10_000_000;
export const DOCUMENT_MAX_REQUEST_BYTES = 12_000_000;
export const DOCUMENT_MAX_PAGE_COUNT = 1_000;
export const DOCUMENT_EXTENSIONS = [".pdf", ".md", ".txt"] as const;
const DOCUMENT_PROJECT_ROUTES = [
  "The Forge",
  "The Chamber",
  "The Book",
  "General",
  "Do not preserve",
] as const;

function isValidDocumentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const documentDateSchema = z
  .string()
  .refine(isValidDocumentDate, "Document date must be a real YYYY-MM-DD date.")
  .nullable();

const insightSchema = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    sourceReferenceIds: z.array(z.string().regex(/^ref_[0-9a-f]{8}$/)).max(4),
  })
  .strict();

const sourceReferenceSchema = z
  .object({
    id: z.string().regex(/^ref_[0-9a-f]{8}$/),
    locator: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(200),
    note: z.string().max(500),
  })
  .strict();

export const documentDataSchema = z
  .object({
    originalFileName: z.string().max(240).nullable(),
    mimeType: z.string().max(120).nullable(),
    fileSizeBytes: z.number().int().nonnegative().max(DOCUMENT_MAX_FILE_BYTES).nullable(),
    documentDate: documentDateSchema,
    pageCount: z.number().int().positive().max(DOCUMENT_MAX_PAGE_COUNT).nullable(),
    storagePath: z.string().max(500).nullable(),
    extractedContentPath: z.string().max(500).nullable(),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    highSignalFindings: z.array(insightSchema).max(12),
    keyClaims: z.array(insightSchema).max(16),
    contradictions: z.array(insightSchema).max(12),
    uncertainties: z.array(insightSchema).max(12),
    sourceReferences: z.array(sourceReferenceSchema).max(64),
    projectRoute: z.enum(DOCUMENT_PROJECT_ROUTES).nullable(),
  })
  .strict()
  .superRefine(validateSourceReferenceLinks);

export type DocumentDataInput = z.input<typeof documentDataSchema>;

export const documentDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    summary: z.string().max(2_000),
    tags: z.array(z.string().trim().min(1).max(48)).max(12),
    documentDate: documentDateSchema,
    pageCount: z.number().int().positive().max(DOCUMENT_MAX_PAGE_COUNT).nullable(),
    highSignalFindings: z.array(insightSchema).max(12),
    keyClaims: z.array(insightSchema).max(16),
    contradictions: z.array(insightSchema).max(12),
    uncertainties: z.array(insightSchema).max(12),
    sourceReferences: z.array(sourceReferenceSchema).max(64),
    suggestedRecordIds: z.array(z.string().uuid()).max(12),
    originalFileName: z.string().max(240),
    mimeType: z.string().max(120),
    fileSizeBytes: z.number().int().positive().max(DOCUMENT_MAX_FILE_BYTES),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine(validateSourceReferenceLinks);

export type DocumentDraft = z.infer<typeof documentDraftSchema>;

const documentValidationSectionLabels: Record<string, string> = {
  highSignalFindings: "High-signal findings",
  keyClaims: "Key claims",
  contradictions: "Contradictions",
  uncertainties: "Uncertainties",
  sourceReferences: "Source references",
};

const documentValidationFieldLabels: Record<string, string> = {
  documentDate: "Document date",
  pageCount: "Page count",
  sourceReferenceIds: "Citations",
  id: "Reference ID",
  text: "Text",
  label: "Label",
  locator: "Locator",
  note: "Note",
};

function formatDocumentValidationPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "Document";
  const section = typeof path[0] === "string" ? path[0] : "Document";
  const sectionLabel = documentValidationSectionLabels[section] ?? section;
  const index = typeof path[1] === "number" ? ` ${path[1] + 1}` : "";
  const field = typeof path[2] === "string" ? path[2] : null;
  const fieldLabel = field ? (documentValidationFieldLabels[field] ?? field) : null;
  return `${sectionLabel}${index}${fieldLabel ? ` · ${fieldLabel}` : ""}`;
}

export function formatDocumentValidationIssues(
  issues: ReadonlyArray<{
    path: readonly (string | number)[];
    message: string;
  }>,
): string[] {
  return [
    ...new Set(
      issues.map((issue) => `${formatDocumentValidationPath(issue.path)}: ${issue.message}`),
    ),
  ];
}

function validateSourceReferenceLinks(
  value: {
    sourceReferences: DocumentSourceReference[];
    highSignalFindings: DocumentInsight[];
    keyClaims: DocumentInsight[];
    contradictions: DocumentInsight[];
    uncertainties: DocumentInsight[];
  },
  ctx: z.RefinementCtx,
) {
  const ids = new Set<string>();
  for (const [index, reference] of value.sourceReferences.entries()) {
    if (ids.has(reference.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceReferences", index, "id"],
        message: "Source reference IDs must be unique.",
      });
    }
    ids.add(reference.id);
  }
  for (const key of [
    "highSignalFindings",
    "keyClaims",
    "contradictions",
    "uncertainties",
  ] as const) {
    for (const [index, insight] of value[key].entries()) {
      for (const referenceId of insight.sourceReferenceIds) {
        if (!ids.has(referenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, index, "sourceReferenceIds"],
            message: "Every source reference ID must identify a source reference.",
          });
        }
      }
    }
  }
}

export function validateDocumentData(value: unknown): DocumentData {
  return documentDataSchema.parse(value) as DocumentData;
}

export function cloneDocumentData(value: DocumentData): DocumentData {
  return {
    ...value,
    highSignalFindings: value.highSignalFindings.map(cloneInsight),
    keyClaims: value.keyClaims.map(cloneInsight),
    contradictions: value.contradictions.map(cloneInsight),
    uncertainties: value.uncertainties.map(cloneInsight),
    sourceReferences: value.sourceReferences.map(cloneReference),
  };
}

function cloneInsight(value: DocumentInsight): DocumentInsight {
  return { text: value.text, sourceReferenceIds: [...value.sourceReferenceIds] };
}

function cloneReference(value: DocumentSourceReference): DocumentSourceReference {
  return { ...value };
}

export function fileExtension(name: string): string {
  const last = name.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot === -1 ? "" : last.slice(dot);
}

export function isSupportedDocumentFile(file: Pick<File, "name" | "type" | "size">): boolean {
  const extension = fileExtension(file.name);
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return false;
  if (file.size <= 0 || file.size > DOCUMENT_MAX_FILE_BYTES) return false;
  if (extension === ".pdf")
    return (
      file.type === "application/pdf" ||
      file.type === "" ||
      file.type === "application/octet-stream"
    );
  if (extension === ".md")
    return ["text/markdown", "text/plain", "application/octet-stream", ""].includes(file.type);
  return ["text/plain", "application/octet-stream", ""].includes(file.type);
}

export function validateSelectedDocumentFile(file: File): string | null {
  const extension = fileExtension(file.name);
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return "Supported files are PDF, Markdown (.md), and plain text (.txt).";
  }
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > DOCUMENT_MAX_FILE_BYTES) {
    return `The selected file must be ${Math.round(DOCUMENT_MAX_FILE_BYTES / 1_000_000)} MB or smaller.`;
  }
  if (!isSupportedDocumentFile(file)) return "The file extension and MIME type do not agree.";
  return null;
}

export async function fingerprintFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
