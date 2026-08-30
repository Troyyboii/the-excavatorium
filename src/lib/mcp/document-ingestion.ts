import {
  DOCUMENT_MAX_FILE_BYTES,
  documentDraftSchema,
  fingerprintFile,
  validateSelectedDocumentFile,
  type DocumentDraft,
} from "../document";
import type { DocumentData, RecordType } from "../types";

const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_REDIRECTS = 2;
const MAX_CANDIDATE_RECORDS = 75;
const SUPPORTED_RECORD_TYPES: readonly RecordType[] = [
  "tool",
  "repository",
  "conversation",
  "decision",
  "document",
];

export type ChatGptFileReference = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

export type DocumentIngestionErrorCode =
  | "FILE_UNAVAILABLE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "QUOTA_EXCEEDED"
  | "EXTRACTION_FAILED"
  | "SAVE_FAILED"
  | "DATA_UNAVAILABLE";

export type DocumentIngestionDiagnostic =
  | "invalid_file_reference"
  | "invalid_url"
  | "rejected_address"
  | "dns_resolution_failure"
  | "redirect_rejected"
  | "network_fetch_failure"
  | "http_non_success"
  | "body_read_failure"
  | "candidate_lookup_failure"
  | "document_extract_failure"
  | "document_save_failure"
  | "unexpected_failure";

const SAFE_MESSAGES: Record<DocumentIngestionErrorCode, string> = {
  FILE_UNAVAILABLE: "The uploaded file is unavailable. Attach it again and retry.",
  FILE_TOO_LARGE: "The uploaded file exceeds the 10 MB document limit.",
  UNSUPPORTED_FILE: "Supported files are PDF, Markdown (.md), and plain text (.txt).",
  QUOTA_EXCEEDED: "Document excavation is temporarily rate limited. Please retry later.",
  EXTRACTION_FAILED: "The document could not be excavated.",
  SAVE_FAILED: "The excavated document could not be saved.",
  DATA_UNAVAILABLE: "Archive data is temporarily unavailable.",
};

const DOCUMENT_INGESTION_DIAGNOSTICS: ReadonlySet<string> = new Set([
  "invalid_file_reference",
  "invalid_url",
  "rejected_address",
  "dns_resolution_failure",
  "redirect_rejected",
  "network_fetch_failure",
  "http_non_success",
  "body_read_failure",
  "candidate_lookup_failure",
  "document_extract_failure",
  "document_save_failure",
  "unexpected_failure",
]);

export class DocumentIngestionError extends Error {
  constructor(
    readonly code: DocumentIngestionErrorCode,
    message = SAFE_MESSAGES[code],
    readonly diagnostic: DocumentIngestionDiagnostic = "unexpected_failure",
  ) {
    super(message);
    this.name = "DocumentIngestionError";
  }
}

export function safeDocumentIngestionDiagnostic(value: unknown): DocumentIngestionDiagnostic {
  return DOCUMENT_INGESTION_DIAGNOSTICS.has(String(value))
    ? (String(value) as DocumentIngestionDiagnostic)
    : "unexpected_failure";
}

export function documentIngestionErrorMessage(
  code: DocumentIngestionErrorCode,
  diagnostic: unknown,
): string {
  return `${SAFE_MESSAGES[code]} [diagnostic: ${safeDocumentIngestionDiagnostic(diagnostic)}]`;
}

export type DocumentCandidate = {
  id: string;
  title: string;
  recordType: RecordType;
};

type CandidateRow = { id: unknown; title: unknown; record_type: unknown };

export type DocumentIngestionClient = {
  listRecentCandidates: () => Promise<{ data: CandidateRow[] | null; error: unknown }>;
  invoke: (
    functionName: "document-extract" | "document-save",
    body: FormData,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export type DocumentDraftRecord = {
  title: string;
  summary: string;
  tags: string[];
  recordData: DocumentData;
  selectedTargetIds: string[];
};

export type DocumentDraftMapper = (
  draft: DocumentDraft,
  ownerCandidateIds: ReadonlySet<string>,
) => DocumentDraftRecord;

export type ExcavatedDocumentResult = {
  id: string;
  isNew: boolean;
  title: string;
  recordType: "document";
  originalFileName: string;
  contentHash: string;
};

export type DocumentIngestionDependencies = {
  client: DocumentIngestionClient;
  mapDraft: DocumentDraftMapper;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Fetches a short-lived ChatGPT file reference without forwarding caller
 * credentials. The resulting File is intentionally in-memory only and can be
 * appended to both existing document function requests without a second GET.
 */
export async function downloadChatGptDocument(
  reference: ChatGptFileReference,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<File> {
  if (!isFileReference(reference)) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "invalid_file_reference");
  }

  const requestUrl = validateDownloadUrl(reference.download_url);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);

  try {
    let url = requestUrl;
    for (let redirects = 0; redirects <= MAX_DOWNLOAD_REDIRECTS; redirects += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            Accept: "application/pdf, text/markdown, text/plain, application/octet-stream",
          },
        });
      } catch {
        throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "network_fetch_failure");
      }

      if (isRedirect(response.status)) {
        if (redirects === MAX_DOWNLOAD_REDIRECTS) {
          throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
        }
        try {
          url = validateRedirectUrl(location, url);
        } catch (error) {
          if (error instanceof DocumentIngestionError) throw error;
          throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
        }
        continue;
      }
      if (!response.ok) {
        throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "http_non_success");
      }

      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && declaredLengthTooLarge(declaredLength)) {
        throw new DocumentIngestionError("FILE_TOO_LARGE");
      }
      const bytes = await readBoundedResponse(response, controller);
      const fileBytes = new Uint8Array(bytes.byteLength);
      fileBytes.set(bytes);
      const file = new File(
        [fileBytes.buffer],
        fileNameFor(reference, response.headers.get("content-type")),
        {
          type: fileMimeTypeFor(reference, response.headers.get("content-type")),
        },
      );
      const validationError = validateSelectedDocumentFile(file);
      if (validationError) {
        throw new DocumentIngestionError(
          validationError.includes("10 MB") ? "FILE_TOO_LARGE" : "UNSUPPORTED_FILE",
        );
      }
      return file;
    }
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Composes the existing authenticated document-extract and document-save
 * contracts. It never writes archive tables or Storage directly.
 */
export async function excavateAndSaveChatGptDocument(
  reference: ChatGptFileReference,
  dependencies: DocumentIngestionDependencies,
): Promise<ExcavatedDocumentResult> {
  const file = await downloadChatGptDocument(reference, dependencies);
  const contentHash = await fingerprintFile(file);
  const candidates = await loadOwnerCandidates(dependencies.client);

  const extractionBody = new FormData();
  extractionBody.append("file", file, file.name);
  extractionBody.append("contentHash", contentHash);
  extractionBody.append("candidateRecords", JSON.stringify(candidates));
  let extraction: { data: unknown; error: unknown };
  try {
    extraction = await dependencies.client.invoke("document-extract", extractionBody);
  } catch {
    throw new DocumentIngestionError("EXTRACTION_FAILED", undefined, "document_extract_failure");
  }
  if (extraction.error) throw classifyExtractionFailure(extraction.error);
  const draft = documentDraftSchema.safeParse(extraction.data);
  if (!draft.success || draft.data.contentHash !== contentHash) {
    throw new DocumentIngestionError("EXTRACTION_FAILED", undefined, "document_extract_failure");
  }

  const ownerCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  let mapped: DocumentDraftRecord;
  try {
    mapped = dependencies.mapDraft(draft.data, ownerCandidateIds);
  } catch {
    throw new DocumentIngestionError("EXTRACTION_FAILED", undefined, "document_extract_failure");
  }
  if (!validMappedDraft(mapped, ownerCandidateIds))
    throw new DocumentIngestionError("EXTRACTION_FAILED", undefined, "document_extract_failure");

  const saveBody = new FormData();
  saveBody.append(
    "record",
    JSON.stringify({
      recordType: "document",
      title: mapped.title,
      summary: mapped.summary,
      tags: mapped.tags,
      recordData: mapped.recordData,
    }),
  );
  saveBody.append("selectedTargetIds", JSON.stringify(mapped.selectedTargetIds));
  saveBody.append("removeFile", "false");
  saveBody.append("contentHash", contentHash);
  saveBody.append("file", file, file.name);
  let saved: { data: unknown; error: unknown };
  try {
    saved = await dependencies.client.invoke("document-save", saveBody);
  } catch {
    throw new DocumentIngestionError("SAVE_FAILED", undefined, "document_save_failure");
  }
  if (saved.error) {
    throw new DocumentIngestionError("SAVE_FAILED", undefined, "document_save_failure");
  }
  if (!isSaveResult(saved.data)) {
    throw new DocumentIngestionError("SAVE_FAILED", undefined, "document_save_failure");
  }

  return {
    id: saved.data.id,
    isNew: saved.data.isNew,
    title: mapped.title,
    recordType: "document",
    originalFileName: draft.data.originalFileName,
    contentHash,
  };
}

export function createDocumentIngestionClient(supabase: {
  from: (table: "records") => {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => PromiseLike<{ data: CandidateRow[] | null; error: unknown }>;
      };
    };
  };
  functions: {
    invoke: (
      functionName: "document-extract" | "document-save",
      options: { body: FormData },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}): DocumentIngestionClient {
  return {
    listRecentCandidates: async () =>
      await supabase
        .from("records")
        .select("id,title,record_type")
        .order("updated_at", { ascending: false })
        .limit(MAX_CANDIDATE_RECORDS),
    invoke: (functionName, body) => supabase.functions.invoke(functionName, { body }),
  };
}

function isFileReference(value: ChatGptFileReference): boolean {
  return (
    isObject(value) &&
    typeof value.download_url === "string" &&
    value.download_url.length > 0 &&
    typeof value.file_id === "string" &&
    value.file_id.length > 0 &&
    (value.mime_type === undefined || typeof value.mime_type === "string") &&
    (value.file_name === undefined || typeof value.file_name === "string")
  );
}

function validateDownloadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "invalid_url");
  }
  // Apps SDK fileParams intentionally does not promise a hostname family for
  // temporary URLs. Keep the URL as a network capability, not as a domain
  // allowlist, and retain the SSRF checks that do not depend on provenance.
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isUnsafeLiteralAddress(hostname)
  ) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "rejected_address");
  }
  return url.toString();
}

function validateRedirectUrl(location: string, currentUrl: string): string {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
  }

  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
  }
  if (target.origin !== current.origin) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
  }

  try {
    return validateDownloadUrl(target.toString());
  } catch {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "redirect_rejected");
  }
}

function isUnsafeLiteralAddress(hostname: string): boolean {
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ? hostname.split(".").map(Number) : null;
  if (ipv4) {
    if (ipv4.some((part) => part > 255)) return true;
    return isUnsafeIpv4Parts(ipv4[0]!, ipv4[1]!, ipv4[2]!, ipv4[3]!);
  }
  const ipv6 = parseIpv6(hostname);
  if (ipv6 === null) return false;

  const mappedIpv4 = ipv4FromMappedIpv6(ipv6);
  if (mappedIpv4) return isUnsafeLiteralAddress(mappedIpv4);

  return [
    [0n, 0n],
    [1n, 1n],
    [0xfc000000000000000000000000000000n, 0xfdffffffffffffffffffffffffffffffn],
    [0xfe800000000000000000000000000000n, 0xfebfffffffffffffffffffffffffffffn],
    [0xff000000000000000000000000000000n, 0xffffffffffffffffffffffffffffffffn],
    [0x20010db8000000000000000000000000n, 0x20010db8ffffffffffffffffffffffffn],
    [0x20010000000000000000000000000000n, 0x20010000ffffffffffffffffffffffffn],
    [0x20010002000000000000000000000000n, 0x20010002ffffffffffffffffffffffffn],
    [0x20010010000000000000000000000000n, 0x2001001fffffffffffffffffffffffffn],
    [0x20020000000000000000000000000000n, 0x2002ffffffffffffffffffffffffffffn],
  ].some(([start, end]) => ipv6 >= start && ipv6 <= end);
}

function isUnsafeIpv4Parts(first: number, second: number, third: number, fourth: number): boolean {
  const value = (((first * 256 + second) * 256 + third) * 256 + fourth) >>> 0;
  return [
    [0x00000000, 0x00ffffff], // "this" network
    [0x0a000000, 0x0affffff], // private use
    [0x64400000, 0x647fffff], // shared address space / CGNAT
    [0x7f000000, 0x7fffffff], // loopback
    [0xa9fe0000, 0xa9feffff], // link local
    [0xac100000, 0xac1fffff], // private use
    [0xc0000000, 0xc00000ff], // IETF protocol assignments
    [0xc0000200, 0xc00002ff], // TEST-NET-1
    [0xc01fc400, 0xc01fc4ff], // AS112-v4
    [0xc058c100, 0xc058c1ff], // deprecated 6to4 relay anycast
    [0xc0a80000, 0xc0a8ffff], // private use
    [0xc6120000, 0xc613ffff], // benchmarking
    [0xc6336400, 0xc63364ff], // TEST-NET-2
    [0xcb007100, 0xcb0071ff], // TEST-NET-3
    [0xe0000000, 0xffffffff], // multicast and reserved
  ].some(([start, end]) => value >= start && value <= end);
}

function parseIpv6(value: string): bigint | null {
  if (!value.includes(":")) return null;
  const normalized = value.toLowerCase();
  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [left, right] = normalized.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right === undefined || right === "" ? [] : right.split(":");
  const parts = [...leftParts, ...rightParts];
  const expandedParts: string[] = [];
  for (const part of parts) {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
        return null;
      }
      expandedParts.push(
        `${((octets[0]! << 8) | octets[1]!).toString(16)}`,
        `${((octets[2]! << 8) | octets[3]!).toString(16)}`,
      );
    } else {
      expandedParts.push(part);
    }
  }
  const missing = 8 - expandedParts.length;
  if (
    missing < 0 ||
    (right === undefined && missing !== 0) ||
    (right !== undefined && missing < 1)
  ) {
    return null;
  }
  const groups =
    right === undefined
      ? expandedParts
      : [...leftParts.map((part) => part), ...Array(missing).fill("0"), ...rightParts].flatMap(
          (part) => {
            if (!part.includes(".")) return [part];
            const octets = part.split(".").map(Number);
            return [
              ((octets[0]! << 8) | octets[1]!).toString(16),
              ((octets[2]! << 8) | octets[3]!).toString(16),
            ];
          },
        );
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.reduce((result, part) => (result << 16n) | BigInt(Number.parseInt(part, 16)), 0n);
}

function ipv4FromMappedIpv6(value: bigint): string | null {
  if (value >> 32n !== 0xffffn) return null;
  const octets = [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn));
  return octets.join(".");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function declaredLengthTooLarge(value: string): boolean {
  if (!/^\d+$/.test(value)) return true;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > DOCUMENT_MAX_FILE_BYTES;
}

async function readBoundedResponse(
  response: Response,
  controller: AbortController,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "body_read_failure");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > DOCUMENT_MAX_FILE_BYTES) {
        controller.abort();
        await reader.cancel();
        throw new DocumentIngestionError("FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DocumentIngestionError) throw error;
    throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "body_read_failure");
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new DocumentIngestionError("UNSUPPORTED_FILE");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cleanMime(value: string | null | undefined): string | null {
  if (!value) return null;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mime || null;
}

function fileNameFor(reference: ChatGptFileReference, responseMime: string | null): string {
  const supplied = safeFileName(reference.file_name);
  if (supplied) return supplied;
  switch (cleanMime(reference.mime_type) ?? cleanMime(responseMime)) {
    case "application/pdf":
      return "uploaded-document.pdf";
    case "text/markdown":
      return "uploaded-document.md";
    case "text/plain":
      return "uploaded-document.txt";
    default:
      throw new DocumentIngestionError("UNSUPPORTED_FILE");
  }
}

function safeFileName(value: string | undefined): string | null {
  if (!value) return null;
  const name = value
    .split(/[\\/]/)
    .pop()
    ?.split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return name && name.length <= 240 ? name : null;
}

function fileMimeTypeFor(reference: ChatGptFileReference, responseMime: string | null): string {
  const supplied = cleanMime(reference.mime_type);
  const received = cleanMime(responseMime);
  const type = received && received !== "application/octet-stream" ? received : supplied;
  return type ?? "";
}

async function loadOwnerCandidates(client: DocumentIngestionClient): Promise<DocumentCandidate[]> {
  let result: { data: CandidateRow[] | null; error: unknown };
  try {
    result = await client.listRecentCandidates();
  } catch {
    throw new DocumentIngestionError("DATA_UNAVAILABLE", undefined, "candidate_lookup_failure");
  }
  if (result.error || !result.data) {
    throw new DocumentIngestionError("DATA_UNAVAILABLE", undefined, "candidate_lookup_failure");
  }
  return result.data
    .filter(
      (row): row is { id: string; title: string; record_type: RecordType } =>
        typeof row.id === "string" &&
        typeof row.title === "string" &&
        SUPPORTED_RECORD_TYPES.includes(row.record_type as RecordType),
    )
    .slice(0, MAX_CANDIDATE_RECORDS)
    .map((row) => ({ id: row.id, title: row.title, recordType: row.record_type }));
}

function classifyExtractionFailure(error: unknown): DocumentIngestionError {
  const status = responseStatus(error);
  if (status === 429)
    return new DocumentIngestionError("QUOTA_EXCEEDED", undefined, "document_extract_failure");
  if (status === 413)
    return new DocumentIngestionError("FILE_TOO_LARGE", undefined, "document_extract_failure");
  return new DocumentIngestionError("EXTRACTION_FAILED", undefined, "document_extract_failure");
}

function responseStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  return context &&
    typeof context === "object" &&
    typeof (context as { status?: unknown }).status === "number"
    ? (context as { status: number }).status
    : null;
}

function validMappedDraft(
  mapped: DocumentDraftRecord,
  ownerCandidateIds: ReadonlySet<string>,
): boolean {
  return (
    typeof mapped.title === "string" &&
    typeof mapped.summary === "string" &&
    Array.isArray(mapped.tags) &&
    mapped.selectedTargetIds.every((id) => ownerCandidateIds.has(id))
  );
}

function isSaveResult(value: unknown): value is { id: string; isNew: boolean } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      (value as { id: string }).id,
    ) &&
    typeof (value as { isNew?: unknown }).isNew === "boolean"
  );
}
