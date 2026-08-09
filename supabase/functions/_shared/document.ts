import { getDocument } from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

export const DOCUMENT_MAX_FILE_BYTES = 10_000_000;
export const DOCUMENT_MAX_REQUEST_BYTES = 12_000_000;
export const DOCUMENT_MAX_EXTRACTED_CHARS = 400_000;
export const DOCUMENT_MAX_CHUNKS = 16;
export const DOCUMENT_MAX_CHUNK_CHARS = 7_000;
export const DOCUMENT_MAX_PAGE_COUNT = 1_000;
export const DOCUMENT_MAX_NORMALIZED_BYTES = 1_000_000;
export const DOCUMENT_MAX_OUTPUT_BYTES = 45_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const SOURCE_REFERENCE_RE = /^ref_[0-9a-f]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STORAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(original|extracted)\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/i;
const PROJECT_ROUTES = [
  "The Forge",
  "The Chamber",
  "The Book",
  "General",
  "Do not preserve",
] as const;
const EXTENSIONS = [".pdf", ".md", ".txt"] as const;
const MIME_TYPES = new Set(["application/pdf", "text/markdown", "text/plain"]);

export type DocumentKind = "pdf" | "markdown" | "text";

export type SourceUnit = {
  id: string;
  order: number;
  locator: string;
  label: string;
  text: string;
};

export type NormalizedDocument = {
  version: 1;
  kind: DocumentKind;
  contentHash: string;
  pageCount: number | null;
  extractedCharacterCount: number;
  units: SourceUnit[];
};

export type DocumentInsight = {
  text: string;
  sourceReferenceIds: string[];
};

export type DocumentRecordData = {
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  documentDate: string | null;
  pageCount: number | null;
  storagePath: string | null;
  extractedContentPath: string | null;
  contentHash: string | null;
  highSignalFindings: DocumentInsight[];
  keyClaims: DocumentInsight[];
  contradictions: DocumentInsight[];
  uncertainties: DocumentInsight[];
  sourceReferences: Array<{ id: string; locator: string; label: string; note: string }>;
  projectRoute: (typeof PROJECT_ROUTES)[number] | null;
};

export type DocumentRecordPayload = {
  id?: string;
  recordType: "document";
  title: string;
  summary: string;
  tags: string[];
  recordData: DocumentRecordData;
};

export type CandidateRecord = { id: string; title: string; recordType: string };

export function jsonSafeFileName(name: string): string {
  const basename = name.trim().split(/[\\/]/).pop() ?? "document";
  const withoutControls = Array.from(basename, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? "_" : char;
  }).join("");
  const replaced = withoutControls.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+$/, "document");
  return (replaced || "document").slice(0, 180);
}

export function displayFileName(name: string): string {
  return jsonSafeFileName(name);
}

export function extensionFor(name: string): string {
  const safe = name.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = safe.lastIndexOf(".");
  return dot === -1 ? "" : safe.slice(dot);
}

export function kindFor(name: string, mimeType: string): DocumentKind | null {
  const extension = extensionFor(name);
  if (
    extension === ".pdf" &&
    ["application/pdf", "", "application/octet-stream"].includes(mimeType)
  )
    return "pdf";
  if (
    extension === ".md" &&
    ["text/markdown", "text/plain", "", "application/octet-stream"].includes(mimeType)
  )
    return "markdown";
  if (extension === ".txt" && ["text/plain", "", "application/octet-stream"].includes(mimeType))
    return "text";
  return null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

export function isSourceReferenceId(value: unknown): value is string {
  return typeof value === "string" && SOURCE_REFERENCE_RE.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isStoragePath(value: unknown): value is string {
  return typeof value === "string" && STORAGE_PATH_RE.test(value);
}

/**
 * Returns a standalone ArrayBuffer copy of the supplied bytes.
 *
 * Web Crypto and PDFJS both accept a BufferSource and may retain or detach the
 * backing buffer. Copying keeps every caller safe from detached-buffer
 * failures and satisfies the ArrayBufferLike typing of Uint8Array views.
 */
export function toBinaryData(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Reads an uploaded file into an owned, independently backed byte array. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBinaryData(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readBoundedBody(
  request: Request,
  maxBytes = DOCUMENT_MAX_REQUEST_BYTES,
): Promise<Uint8Array> {
  if (!request.body) throw new DocumentInputError("Request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DocumentInputError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function declaredLengthTooLarge(
  value: string | null,
  maxBytes = DOCUMENT_MAX_REQUEST_BYTES,
): boolean {
  if (value === null) return false;
  if (!/^\d+$/.test(value)) return true;
  const parsed = Number(value);
  return !Number.isSafeInteger(parsed) || parsed > maxBytes;
}

export async function normalizeDocumentFile(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  expectedHash?: string,
): Promise<NormalizedDocument> {
  if (fileBytes.byteLength === 0) throw new DocumentInputError("The selected file is empty.", 400);
  if (fileBytes.byteLength > DOCUMENT_MAX_FILE_BYTES)
    throw new DocumentInputError("The selected file is too large.", 413);
  const kind = kindFor(fileName, mimeType);
  if (!kind)
    throw new DocumentInputError(
      "The file type is not supported or does not match its extension.",
      400,
    );
  const contentHash = await sha256(fileBytes);
  if (expectedHash !== undefined && (!isHash(expectedHash) || expectedHash !== contentHash)) {
    throw new DocumentInputError("The selected file changed before it was processed.", 400);
  }

  let normalized: NormalizedDocument;
  if (kind === "pdf") {
    normalized = await normalizePdf(fileBytes, contentHash);
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
    } catch {
      throw new DocumentInputError("The text file is not valid UTF-8.", 400);
    }
    if (text.includes("\u0000"))
      throw new DocumentInputError("The document contains unsupported binary content.", 400);
    normalized = normalizeText(text.replace(/\r\n?/g, "\n"), kind, contentHash);
  }
  if (normalized.extractedCharacterCount === 0) {
    throw new DocumentInputError(
      "No usable text was found. Scanned or image-only PDFs are not supported.",
      422,
    );
  }
  if (normalized.extractedCharacterCount > DOCUMENT_MAX_EXTRACTED_CHARS) {
    throw new DocumentInputError("The extracted document text exceeds the supported limit.", 413);
  }
  if (normalized.units.length === 0 || normalized.units.length > DOCUMENT_MAX_CHUNKS * 8) {
    throw new DocumentInputError(
      "The document has too many source sections for bounded excavation.",
      413,
    );
  }
  return normalized;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).every((key) => expected.includes(key)) &&
    expected.every((key) => key in value)
  );
}

export function validateNormalizedDocument(value: unknown): value is NormalizedDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  if (
    !hasExactKeys(document, [
      "version",
      "kind",
      "contentHash",
      "pageCount",
      "extractedCharacterCount",
      "units",
    ]) ||
    document.version !== 1 ||
    !["pdf", "markdown", "text"].includes(document.kind as string) ||
    !isHash(document.contentHash) ||
    !Array.isArray(document.units) ||
    document.units.length === 0 ||
    document.units.length > DOCUMENT_MAX_CHUNKS * 8 ||
    !Number.isInteger(document.extractedCharacterCount) ||
    (document.extractedCharacterCount as number) < 1 ||
    (document.extractedCharacterCount as number) > DOCUMENT_MAX_EXTRACTED_CHARS
  )
    return false;
  if (
    document.pageCount !== null &&
    (!Number.isInteger(document.pageCount) ||
      (document.pageCount as number) < 1 ||
      (document.pageCount as number) > DOCUMENT_MAX_PAGE_COUNT)
  )
    return false;
  if (document.kind !== "pdf" && document.pageCount !== null) return false;

  let characterCount = 0;
  for (let index = 0; index < document.units.length; index += 1) {
    const value = document.units[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const unit = value as Record<string, unknown>;
    if (
      !hasExactKeys(unit, ["id", "order", "locator", "label", "text"]) ||
      !isSourceReferenceId(unit.id) ||
      unit.order !== index ||
      typeof unit.locator !== "string" ||
      unit.locator.length < 1 ||
      unit.locator.length > 120 ||
      typeof unit.label !== "string" ||
      unit.label.length < 1 ||
      unit.label.length > 200 ||
      typeof unit.text !== "string" ||
      unit.text.length < 1 ||
      unit.text.length > DOCUMENT_MAX_CHUNK_CHARS
    )
      return false;
    characterCount += unit.text.length;
    if (characterCount > DOCUMENT_MAX_EXTRACTED_CHARS) return false;
  }
  return characterCount === document.extractedCharacterCount;
}

function normalizeText(
  text: string,
  kind: "markdown" | "text",
  contentHash: string,
): NormalizedDocument {
  const lines = text.split("\n");
  const units: SourceUnit[] = [];
  let currentHeading = kind === "markdown" ? "Document" : "Text document";
  let sectionStart = 1;
  let sectionLines: string[] = [];
  const flush = (endLine: number) => {
    if (sectionLines.join("\n").trim()) {
      addBoundedUnits(units, sectionLines.join("\n"), currentHeading, sectionStart, endLine);
    }
    sectionLines = [];
    sectionStart = endLine + 1;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const heading = kind === "markdown" ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]) : null;
    if (heading) {
      flush(lineNumber - 1);
      currentHeading = heading[2].trim().slice(0, 160) || "Untitled section";
      sectionStart = lineNumber;
    }
    sectionLines.push(lines[index]);
    if (sectionLines.join("\n").length >= DOCUMENT_MAX_CHUNK_CHARS) flush(lineNumber);
  }
  flush(lines.length);
  return {
    version: 1,
    kind,
    contentHash,
    pageCount: null,
    extractedCharacterCount: units.reduce((sum, unit) => sum + unit.text.length, 0),
    units,
  };
}

function addBoundedUnits(
  units: SourceUnit[],
  text: string,
  heading: string,
  lineStart: number,
  lineEnd: number,
) {
  const bounded = text.trim();
  const trimOffset = text.indexOf(bounded);
  const lineAt = (offset: number) =>
    lineStart + (text.slice(0, Math.max(0, offset)).match(/\n/g)?.length ?? 0);
  for (let offset = 0; offset < bounded.length; offset += DOCUMENT_MAX_CHUNK_CHARS) {
    const part = bounded.slice(offset, offset + DOCUMENT_MAX_CHUNK_CHARS);
    const absoluteStart = trimOffset + offset;
    const absoluteEnd = trimOffset + offset + part.length;
    const partStart = lineAt(absoluteStart);
    const partEnd = Math.min(lineEnd, lineAt(absoluteEnd));
    const id = `ref_${(units.length + 1).toString(16).padStart(8, "0")}`;
    units.push({
      id,
      order: units.length,
      locator: `Heading: ${heading.slice(0, 60)} (Lines ${partStart}-${partEnd})`.slice(0, 120),
      label: heading.slice(0, 160),
      text: part,
    });
  }
}

async function normalizePdf(bytes: Uint8Array, contentHash: string): Promise<NormalizedDocument> {
  let pdf: { numPages: number; getPage: (pageNumber: number) => Promise<unknown> };
  try {
    pdf = await getDocument({
      data: new Uint8Array(toBinaryData(bytes)),
      // `disableWorker` is honoured at runtime but missing from the published
      // parameter typings, so it is supplied through a narrow cast.
      ...({ disableWorker: true } as Record<string, unknown>),
      isEvalSupported: false,
    }).promise;
  } catch {
    throw new DocumentInputError(
      "The PDF could not be read. It may be malformed or encrypted.",
      422,
    );
  }
  if (
    !Number.isInteger(pdf.numPages) ||
    pdf.numPages < 1 ||
    pdf.numPages > DOCUMENT_MAX_PAGE_COUNT
  ) {
    throw new DocumentInputError("The PDF has too many pages for bounded excavation.", 413);
  }
  const units: SourceUnit[] = [];
  let extractedCharacterCount = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = (await pdf.getPage(pageNumber)) as {
      getTextContent: () => Promise<{ items: unknown[] }>;
    };
    const content = await page.getTextContent();
    const text = content.items
      .map((item) =>
        item && typeof item === "object" && "str" in item && typeof item.str === "string"
          ? item.str
          : "",
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    extractedCharacterCount += text.length;
    addPdfUnits(units, text, pageNumber);
    if (extractedCharacterCount > DOCUMENT_MAX_EXTRACTED_CHARS) break;
  }
  return {
    version: 1,
    kind: "pdf",
    contentHash,
    pageCount: pdf.numPages,
    extractedCharacterCount,
    units,
  };
}

function addPdfUnits(units: SourceUnit[], text: string, pageNumber: number) {
  for (let offset = 0; offset < text.length; offset += DOCUMENT_MAX_CHUNK_CHARS) {
    const id = `ref_${(units.length + 1).toString(16).padStart(8, "0")}`;
    const part = text.slice(offset, offset + DOCUMENT_MAX_CHUNK_CHARS);
    units.push({
      id,
      order: units.length,
      locator: `p. ${pageNumber}${offset ? ` (part ${Math.floor(offset / DOCUMENT_MAX_CHUNK_CHARS) + 1})` : ""}`,
      label: `Page ${pageNumber}`,
      text: part,
    });
  }
}

export function chunkUnits(
  units: SourceUnit[],
): Array<{ sourceReferenceIds: string[]; text: string }> {
  const chunks: Array<{ sourceReferenceIds: string[]; text: string }> = [];
  let ids: string[] = [];
  let text = "";
  for (const unit of units) {
    const nextText = text ? `${text}\n\n[${unit.id}] ${unit.text}` : `[${unit.id}] ${unit.text}`;
    if (text && nextText.length > DOCUMENT_MAX_CHUNK_CHARS) {
      chunks.push({ sourceReferenceIds: ids, text });
      ids = [];
      text = "";
    }
    ids.push(unit.id);
    text = text ? `${text}\n\n[${unit.id}] ${unit.text}` : `[${unit.id}] ${unit.text}`;
  }
  if (text) chunks.push({ sourceReferenceIds: ids, text });
  return chunks;
}

export function validateDocumentRecordData(value: unknown): value is DocumentRecordData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const expected = [
    "originalFileName",
    "mimeType",
    "fileSizeBytes",
    "documentDate",
    "pageCount",
    "storagePath",
    "extractedContentPath",
    "contentHash",
    "highSignalFindings",
    "keyClaims",
    "contradictions",
    "uncertainties",
    "sourceReferences",
    "projectRoute",
  ];
  if (
    Object.keys(data).some((key) => !expected.includes(key)) ||
    expected.some((key) => !(key in data))
  )
    return false;
  if (
    data.originalFileName !== null &&
    (typeof data.originalFileName !== "string" ||
      data.originalFileName.length > 240 ||
      /[\\/]/.test(data.originalFileName))
  )
    return false;
  if (
    data.mimeType !== null &&
    (typeof data.mimeType !== "string" || !MIME_TYPES.has(data.mimeType))
  )
    return false;
  if (
    data.fileSizeBytes !== null &&
    (!Number.isInteger(data.fileSizeBytes) ||
      (data.fileSizeBytes as number) < 0 ||
      (data.fileSizeBytes as number) > DOCUMENT_MAX_FILE_BYTES)
  )
    return false;
  if (data.documentDate !== null && !isIsoDate(data.documentDate)) return false;
  if (
    data.pageCount !== null &&
    (!Number.isInteger(data.pageCount) ||
      (data.pageCount as number) < 1 ||
      (data.pageCount as number) > DOCUMENT_MAX_PAGE_COUNT)
  )
    return false;
  if (data.storagePath !== null && !isStoragePath(data.storagePath)) return false;
  if (data.extractedContentPath !== null && !isStoragePath(data.extractedContentPath)) return false;
  if (data.contentHash !== null && !isHash(data.contentHash)) return false;
  if ((data.storagePath === null) !== (data.extractedContentPath === null)) return false;
  if (data.storagePath !== null && data.contentHash === null) return false;
  if (
    data.projectRoute !== null &&
    !PROJECT_ROUTES.includes(data.projectRoute as (typeof PROJECT_ROUTES)[number])
  )
    return false;
  if (!Array.isArray(data.sourceReferences) || data.sourceReferences.length > 64) return false;
  const references = data.sourceReferences as unknown[];
  const referenceIds = new Set<string>();
  for (const value of references) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const reference = value as Record<string, unknown>;
    if (Object.keys(reference).some((key) => !["id", "locator", "label", "note"].includes(key)))
      return false;
    if (
      !isSourceReferenceId(reference.id) ||
      typeof reference.locator !== "string" ||
      typeof reference.label !== "string" ||
      typeof reference.note !== "string"
    )
      return false;
    if (
      reference.locator.length < 1 ||
      reference.locator.length > 120 ||
      reference.label.length < 1 ||
      reference.label.length > 200 ||
      reference.note.length > 500
    )
      return false;
    if (referenceIds.has(reference.id)) return false;
    referenceIds.add(reference.id);
  }
  for (const key of ["highSignalFindings", "keyClaims", "contradictions", "uncertainties"]) {
    const maxItems = key === "keyClaims" ? 16 : 12;
    if (!Array.isArray(data[key]) || (data[key] as unknown[]).length > maxItems) return false;
    for (const item of data[key] as unknown[]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const insight = item as Record<string, unknown>;
      if (
        Object.keys(insight).some((field) => !["text", "sourceReferenceIds"].includes(field)) ||
        typeof insight.text !== "string" ||
        insight.text.trim().length === 0 ||
        insight.text.length > 2_000 ||
        !Array.isArray(insight.sourceReferenceIds)
      )
        return false;
      if (
        insight.sourceReferenceIds.length > 4 ||
        !(insight.sourceReferenceIds as unknown[]).every(
          (id) => isSourceReferenceId(id) && referenceIds.has(id as string),
        )
      )
        return false;
    }
  }
  return true;
}

export class DocumentInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 422,
  ) {
    super(message);
  }
}

export function pathIsOwnerScoped(path: unknown, userId: string): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${userId}/documents/`) &&
    path.length <= 700 &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

export function projectRoutes(): readonly string[] {
  return PROJECT_ROUTES;
}

export function supportedExtensions(): readonly string[] {
  return EXTENSIONS;
}
