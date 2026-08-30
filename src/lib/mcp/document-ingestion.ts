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

const SAFE_MESSAGES: Record<DocumentIngestionErrorCode, string> = {
  FILE_UNAVAILABLE: "The uploaded file is unavailable. Attach it again and retry.",
  FILE_TOO_LARGE: "The uploaded file exceeds the 10 MB document limit.",
  UNSUPPORTED_FILE: "Supported files are PDF, Markdown (.md), and plain text (.txt).",
  QUOTA_EXCEEDED: "Document excavation is temporarily rate limited. Please retry later.",
  EXTRACTION_FAILED: "The document could not be excavated.",
  SAVE_FAILED: "The excavated document could not be saved.",
  DATA_UNAVAILABLE: "Archive data is temporarily unavailable.",
};

export class DocumentIngestionError extends Error {
  constructor(
    readonly code: DocumentIngestionErrorCode,
    message = SAFE_MESSAGES[code],
  ) {
    super(message);
    this.name = "DocumentIngestionError";
  }
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
  resolveHostname?: HostnameResolver;
  timeoutMs?: number;
};

export type HostnameResolver = (hostname: string, signal: AbortSignal) => Promise<string[]>;

/**
 * Fetches a short-lived ChatGPT file reference without forwarding caller
 * credentials. The resulting File is intentionally in-memory only and can be
 * appended to both existing document function requests without a second GET.
 */
export async function downloadChatGptDocument(
  reference: ChatGptFileReference,
  options: {
    fetch?: typeof fetch;
    resolveHostname?: HostnameResolver;
    timeoutMs?: number;
  } = {},
): Promise<File> {
  if (!isFileReference(reference)) throw new DocumentIngestionError("FILE_UNAVAILABLE");

  const requestUrl = validateDownloadUrl(reference.download_url);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const resolveHostname = options.resolveHostname ?? resolveHostnameWithDnsOverHttps;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);

  try {
    let url = requestUrl;
    for (let redirects = 0; redirects <= MAX_DOWNLOAD_REDIRECTS; redirects += 1) {
      await assertPublicHostnameResolution(url, resolveHostname, controller.signal);
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
        throw new DocumentIngestionError("FILE_UNAVAILABLE");
      }

      if (isRedirect(response.status)) {
        if (redirects === MAX_DOWNLOAD_REDIRECTS) {
          throw new DocumentIngestionError("FILE_UNAVAILABLE");
        }
        const location = response.headers.get("location");
        if (!location) throw new DocumentIngestionError("FILE_UNAVAILABLE");
        try {
          url = validateDownloadUrl(new URL(location, url).toString());
        } catch (error) {
          if (error instanceof DocumentIngestionError) throw error;
          throw new DocumentIngestionError("FILE_UNAVAILABLE");
        }
        continue;
      }
      if (!response.ok) throw new DocumentIngestionError("FILE_UNAVAILABLE");

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
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
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
  const extraction = await dependencies.client.invoke("document-extract", extractionBody);
  if (extraction.error) throw classifyExtractionFailure(extraction.error);
  const draft = documentDraftSchema.safeParse(extraction.data);
  if (!draft.success || draft.data.contentHash !== contentHash) {
    throw new DocumentIngestionError("EXTRACTION_FAILED");
  }

  const ownerCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  let mapped: DocumentDraftRecord;
  try {
    mapped = dependencies.mapDraft(draft.data, ownerCandidateIds);
  } catch {
    throw new DocumentIngestionError("EXTRACTION_FAILED");
  }
  if (!validMappedDraft(mapped, ownerCandidateIds))
    throw new DocumentIngestionError("EXTRACTION_FAILED");

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
  const saved = await dependencies.client.invoke("document-save", saveBody);
  if (saved.error) throw new DocumentIngestionError("SAVE_FAILED");
  if (!isSaveResult(saved.data)) throw new DocumentIngestionError("SAVE_FAILED");

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
    Boolean(value) &&
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
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isUnsafeLiteralAddress(hostname)
  ) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
  }
  return url.toString();
}

async function assertPublicHostnameResolution(
  value: string,
  resolveHostname: HostnameResolver,
  signal: AbortSignal,
): Promise<void> {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIpAddressLiteral(hostname)) return;
  let addresses: string[];
  try {
    addresses = await resolveHostname(hostname, signal);
  } catch {
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isIpAddressLiteral(address) || isUnsafeLiteralAddress(address))
  ) {
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
  }
}

async function resolveHostnameWithDnsOverHttps(
  hostname: string,
  signal: AbortSignal,
): Promise<string[]> {
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    const response = await globalThis.fetch(url, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      signal,
      headers: { Accept: "application/dns-json" },
    });
    if (!response.ok) throw new Error("DNS lookup failed");
    const payload = (await response.json()) as {
      Status?: unknown;
      Answer?: Array<{ type?: unknown; data?: unknown }>;
    };
    if (payload.Status !== 0) throw new Error("DNS lookup failed");
    const expectedType = type === "A" ? 1 : 28;
    for (const answer of payload.Answer ?? []) {
      if (answer.type === expectedType && typeof answer.data === "string") {
        addresses.push(answer.data.toLowerCase());
      }
    }
  }
  return addresses;
}

function isIpAddressLiteral(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  if (!value.includes(":")) return false;
  try {
    new URL(`https://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

function isUnsafeLiteralAddress(hostname: string): boolean {
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ? hostname.split(".").map(Number) : null;
  if (ipv4) {
    if (ipv4.some((part) => part > 255)) return true;
    return isUnsafeIpv4Parts(ipv4[0]!, ipv4[1]!, ipv4[2]!, ipv4[3]!);
  }
  if (isIpv4MappedUnsafeAddress(hostname)) return true;
  const normalized = hostname.replace(/^::ffff:/i, "");
  if (normalized !== hostname && isUnsafeLiteralAddress(normalized)) return true;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab][0-9a-f]:/i.test(normalized) ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
}

function isIpv4MappedUnsafeAddress(hostname: string): boolean {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
  if (!match) return false;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return isUnsafeIpv4Parts(high >>> 8, high & 0xff, low >>> 8, low & 0xff);
}

function isUnsafeIpv4Parts(
  first: number,
  second: number,
  _third: number,
  _fourth: number,
): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
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
  if (!response.body) throw new DocumentIngestionError("FILE_UNAVAILABLE");
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
    throw new DocumentIngestionError("FILE_UNAVAILABLE");
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
    throw new DocumentIngestionError("DATA_UNAVAILABLE");
  }
  if (result.error || !result.data) throw new DocumentIngestionError("DATA_UNAVAILABLE");
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
  if (status === 429) return new DocumentIngestionError("QUOTA_EXCEEDED");
  if (status === 413) return new DocumentIngestionError("FILE_TOO_LARGE");
  return new DocumentIngestionError("EXTRACTION_FAILED");
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
