export const DOCUMENT_FETCH_MAX_BYTES = 10_000_000;
export const DOCUMENT_FETCH_MAX_REDIRECTS = 2;
export const DOCUMENT_FETCH_MAX_HEADER_BYTES = 64 * 1024;
export const DOCUMENT_FETCH_TIMEOUT_MS = 20_000;

type DnsRecordType = "A" | "AAAA";

export type DocumentFetchInput = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

export type DocumentFetchResult = {
  bytes: Uint8Array;
  contentType: string | null;
};

export type DocumentFetchErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "rejected_address"
  | "dns_resolution_failure"
  | "network_failure"
  | "tls_failure"
  | "http_failure"
  | "malformed_response"
  | "response_too_large"
  | "timeout";

export class DocumentFetchError extends Error {
  constructor(readonly code: DocumentFetchErrorCode) {
    super(code);
    this.name = "DocumentFetchError";
  }
}

type Connection = {
  read: (buffer: Uint8Array) => Promise<number | null>;
  write: (buffer: Uint8Array) => Promise<number>;
  close: () => void;
  remoteAddr?: { hostname?: string; port?: number; transport?: string };
};

export type DocumentFetchRuntime = {
  resolveDns: (
    hostname: string,
    recordType: DnsRecordType,
    options: { signal: AbortSignal },
  ) => Promise<string[]>;
  connect: (options: {
    hostname: string;
    port: number;
    transport: "tcp";
    signal: AbortSignal;
  }) => Promise<Connection>;
  startTls: (connection: Connection, options: { hostname: string }) => Promise<Connection>;
};

const defaultRuntime: DocumentFetchRuntime = {
  resolveDns: (hostname, recordType, options) => Deno.resolveDns(hostname, recordType, options),
  connect: (options) => Deno.connect(options),
  startTls: (connection, options) => Deno.startTls(connection as Deno.TcpConn, options),
};

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const CRLF = new Uint8Array([13, 10]);
const HEADER_END = new Uint8Array([13, 10, 13, 10]);

const UNSAFE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc01fc400, 0xc01fc4ff],
  [0xc058c100, 0xc058c1ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6120000, 0xc613ffff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xc034c100, 0xc034c1ff],
  [0xc0af3000, 0xc0af30ff],
  [0xc0586300, 0xc05863ff],
  [0xe0000000, 0xffffffff],
];

const UNSAFE_IPV6_RANGES: ReadonlyArray<readonly [bigint, bigint]> = [
  [0n, 0xffn << 120n],
  [1n, 1n],
  [0xfc00n << 112n, 0xfdffn << 112n],
  [0xfe80n << 112n, 0xfebfn << 112n],
  [0xfec0n << 112n, 0xfecfn << 112n],
  [0xffn << 120n, (1n << 128n) - 1n],
  [0x2001_0000_0000_0000_0000_0000_0000_0000n, 0x2001_0000_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0002_0000_0000_0000_0000_0000_0000n, 0x2001_0002_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0004_0112_0000_0000_0000_0000_0000n, 0x2001_0004_0112_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0010_0000_0000_0000_0000_0000_0000n, 0x2001_001f_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0020_0000_0000_0000_0000_0000_0000n, 0x2001_002f_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0030_0000_0000_0000_0000_0000_0000n, 0x2001_003f_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2001_0db8_0000_0000_0000_0000_0000_0000n, 0x2001_0db8_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x2002_0000_0000_0000_0000_0000_0000_0000n, 0x2002_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x3fff_0000_0000_0000_0000_0000_0000_0000n, 0x3fff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x5f00_0000_0000_0000_0000_0000_0000_0000n, 0x5fff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn],
  [0x0064_ff9b_0000_0000_0000_0000_0000_0000n, 0x0064_ff9b_0000_0000_0000_0000_ffff_ffffn],
  [0x0064_ff9b_0001_0000_0000_0000_0000_0000n, 0x0064_ff9b_0001_ffff_ffff_ffff_ffff_ffffn],
];

export function isUnsafeAddress(value: string): boolean {
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) return UNSAFE_IPV4_RANGES.some(([start, end]) => ipv4 >= start && ipv4 <= end);

  const ipv6 = parseIpv6(value);
  if (ipv6 === null) return true;
  if (ipv6 >> 32n === 0xffffn) return true;
  return UNSAFE_IPV6_RANGES.some(([start, end]) => ipv6 >= start && ipv6 <= end);
}

export function isIpLiteral(value: string): boolean {
  return parseIpv4(value) !== null || parseIpv6(value) !== null;
}

export function validateDocumentFetchInput(value: unknown): DocumentFetchInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DocumentFetchError("invalid_request");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["download_url", "file_id", "mime_type", "file_name"].includes(key)))
    throw new DocumentFetchError("invalid_request");
  if (
    typeof record.download_url !== "string" ||
    record.download_url.length === 0 ||
    record.download_url.length > 16_384 ||
    typeof record.file_id !== "string" ||
    record.file_id.trim().length === 0 ||
    record.file_id.length > 512 ||
    (record.mime_type !== undefined &&
      (typeof record.mime_type !== "string" || record.mime_type.length > 120)) ||
    (record.file_name !== undefined &&
      (typeof record.file_name !== "string" ||
        record.file_name.trim().length === 0 ||
        record.file_name.length > 240))
  )
    throw new DocumentFetchError("invalid_request");

  return {
    download_url: record.download_url,
    file_id: record.file_id,
    ...(record.mime_type === undefined ? {} : { mime_type: record.mime_type }),
    ...(record.file_name === undefined ? {} : { file_name: record.file_name }),
  };
}

export async function fetchTemporaryDocument(
  input: DocumentFetchInput,
  options: { runtime?: DocumentFetchRuntime; timeoutMs?: number } = {},
): Promise<DocumentFetchResult> {
  const runtime = options.runtime ?? defaultRuntime;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DOCUMENT_FETCH_TIMEOUT_MS,
  );
  const deadline = Date.now() + (options.timeoutMs ?? DOCUMENT_FETCH_TIMEOUT_MS);

  try {
    let url = validateUrl(input.download_url);
    for (let redirect = 0; redirect <= DOCUMENT_FETCH_MAX_REDIRECTS; redirect += 1) {
      const response = await fetchOne(url, runtime, controller.signal, deadline);
      try {
        if (isRedirect(response.status)) {
          if (redirect === DOCUMENT_FETCH_MAX_REDIRECTS || !response.location)
            throw new DocumentFetchError("http_failure");
          url = validateUrl(new URL(response.location, url).toString());
          continue;
        }
        if (response.status < 200 || response.status > 299)
          throw new DocumentFetchError("http_failure");
        const bytes = await readResponseBody(response.reader, response.headers, deadline);
        return { bytes, contentType: response.headers.get("content-type") ?? null };
      } finally {
        response.connection.close();
      }
    }
    throw new DocumentFetchError("http_failure");
  } catch (error) {
    if (error instanceof DocumentFetchError) throw error;
    if (controller.signal.aborted) throw new DocumentFetchError("timeout");
    throw new DocumentFetchError("network_failure");
  } finally {
    clearTimeout(timeout);
  }
}

type ParsedResponse = {
  status: number;
  headers: Map<string, string>;
  location: string | null;
  reader: BufferedReader;
  connection: Connection;
};

async function fetchOne(
  url: string,
  runtime: DocumentFetchRuntime,
  signal: AbortSignal,
  deadline: number,
): Promise<ParsedResponse> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const addresses = await resolveAllowedAddresses(hostname, runtime, signal, deadline);
  let lastError: DocumentFetchError = new DocumentFetchError("network_failure");

  for (const address of addresses) {
    let connection: Connection | undefined;
    let phase: "connect" | "tls" | "http" = "connect";
    try {
      connection = await withDeadline(
        runtime.connect({
          hostname: formatConnectHostname(address),
          port: 443,
          transport: "tcp",
          signal,
        }),
        deadline,
        () => connection?.close(),
      );
      if (!connection || !sameAddress(connection.remoteAddr?.hostname, address)) {
        connection?.close();
        throw new DocumentFetchError("network_failure");
      }
      phase = "tls";
      const tls = await withDeadline(runtime.startTls(connection, { hostname }), deadline, () =>
        connection?.close(),
      );
      connection = tls;
      phase = "http";
      await writeRequest(tls, parsed, deadline);
      const reader = new BufferedReader(tls, deadline);
      const response = await parseResponse(reader);
      return { ...response, reader, connection: tls };
    } catch (error) {
      connection?.close();
      lastError =
        error instanceof DocumentFetchError
          ? error
          : signal.aborted
            ? new DocumentFetchError("timeout")
            : new DocumentFetchError(
                phase === "connect" || phase === "http" ? "network_failure" : "tls_failure",
              );
    }
  }
  throw lastError;
}

async function resolveAllowedAddresses(
  hostname: string,
  runtime: DocumentFetchRuntime,
  signal: AbortSignal,
  deadline: number,
): Promise<string[]> {
  if (isIpLiteral(hostname)) {
    if (isUnsafeAddress(hostname)) throw new DocumentFetchError("rejected_address");
    return [hostname];
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.length === 0 ||
    hostname.length > 253
  )
    throw new DocumentFetchError("rejected_address");

  const addresses = new Set<string>();
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const values = await withDeadline(
        runtime.resolveDns(hostname, recordType, { signal }),
        deadline,
        undefined,
      );
      for (const value of values) {
        if (typeof value !== "string" || !isIpLiteral(value))
          throw new DocumentFetchError("dns_resolution_failure");
        addresses.add(value);
      }
    } catch (error) {
      if (error instanceof DocumentFetchError) throw error;
    }
  }
  if (addresses.size === 0) throw new DocumentFetchError("dns_resolution_failure");
  if ([...addresses].some((address) => isUnsafeAddress(address)))
    throw new DocumentFetchError("rejected_address");
  return [...addresses];
}

async function writeRequest(connection: Connection, url: URL, deadline: number): Promise<void> {
  const target = `${url.pathname || "/"}${url.search}`;
  const host = url.host;
  const request =
    `GET ${target} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    "Accept: application/pdf, text/markdown, text/plain, application/octet-stream\r\n" +
    "Connection: close\r\n\r\n";
  const bytes = TEXT_ENCODER.encode(request);
  let offset = 0;
  while (offset < bytes.length) {
    const written = await withDeadline(connection.write(bytes.subarray(offset)), deadline, () =>
      connection.close(),
    );
    if (!Number.isInteger(written) || written <= 0) throw new DocumentFetchError("network_failure");
    offset += written;
  }
}

async function parseResponse(
  reader: BufferedReader,
): Promise<{ status: number; headers: Map<string, string>; location: string | null }> {
  const rawHeaders = await reader.readUntil(HEADER_END, DOCUMENT_FETCH_MAX_HEADER_BYTES);
  let text: string;
  try {
    text = TEXT_DECODER.decode(rawHeaders);
  } catch {
    throw new DocumentFetchError("malformed_response");
  }
  const lines = text.slice(0, -4).split("\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift() ?? "")?.[1];
  if (!status) throw new DocumentFetchError("malformed_response");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*(.*)$/.exec(line);
    if (!match || hasForbiddenHeaderCharacters(match[2]!))
      throw new DocumentFetchError("malformed_response");
    const name = match[1]!.toLowerCase();
    if (headers.has(name)) throw new DocumentFetchError("malformed_response");
    headers.set(name, match[2]!);
  }
  const transferEncoding = headers.get("transfer-encoding");
  const contentLength = headers.get("content-length");
  if (transferEncoding && contentLength) throw new DocumentFetchError("malformed_response");
  if (transferEncoding && transferEncoding.trim().toLowerCase() !== "chunked")
    throw new DocumentFetchError("malformed_response");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      !Number.isSafeInteger(Number(contentLength)) ||
      Number(contentLength) > DOCUMENT_FETCH_MAX_BYTES)
  )
    throw new DocumentFetchError("response_too_large");
  return {
    status: Number(status),
    headers,
    location: headers.get("location") ?? null,
  };
}

async function readResponseBody(
  reader: BufferedReader,
  headers: Map<string, string>,
  deadline: number,
): Promise<Uint8Array> {
  const contentLength = headers.get("content-length");
  if (contentLength) return reader.readExact(Number(contentLength));
  if (headers.get("transfer-encoding")?.trim().toLowerCase() === "chunked") {
    const body = new BoundedByteAccumulator(DOCUMENT_FETCH_MAX_BYTES);
    while (true) {
      const line = await reader.readLine(8_192);
      const sizeText = line.split(";", 1)[0]!.trim();
      if (!/^[0-9a-fA-F]+$/.test(sizeText)) throw new DocumentFetchError("malformed_response");
      const size = Number.parseInt(sizeText, 16);
      if (!Number.isSafeInteger(size)) throw new DocumentFetchError("response_too_large");
      if (size === 0) {
        let trailerBytes = 0;
        while (true) {
          const trailer = await reader.readLine(8_192);
          trailerBytes += trailer.length + 2;
          if (trailerBytes > DOCUMENT_FETCH_MAX_HEADER_BYTES)
            throw new DocumentFetchError("malformed_response");
          if (trailer === "") break;
          if (!isValidTrailerLine(trailer)) throw new DocumentFetchError("malformed_response");
        }
        return body.finish();
      }
      const chunk = await reader.readExact(size);
      if (await reader.readExact(2).then((value) => value[0] !== 13 || value[1] !== 10))
        throw new DocumentFetchError("malformed_response");
      body.append(chunk);
    }
  }
  return reader.readToEnd(DOCUMENT_FETCH_MAX_BYTES, deadline);
}

class BoundedByteAccumulator {
  private buffer = new Uint8Array(0);
  private length = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Uint8Array): void {
    const nextLength = this.length + chunk.byteLength;
    if (!Number.isSafeInteger(nextLength) || nextLength > this.maxBytes)
      throw new DocumentFetchError("response_too_large");
    if (nextLength > this.buffer.byteLength) {
      const nextCapacity = Math.min(
        this.maxBytes,
        Math.max(nextLength, Math.max(8_192, this.buffer.byteLength * 2)),
      );
      const next = new Uint8Array(nextCapacity);
      next.set(this.buffer.subarray(0, this.length));
      this.buffer = next;
    }
    this.buffer.set(chunk, this.length);
    this.length = nextLength;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

class BufferedReader {
  private buffered = new Uint8Array();
  private eof = false;

  constructor(
    private readonly connection: Connection,
    private readonly deadline: number,
  ) {}

  async readUntil(delimiter: Uint8Array, maxBytes: number): Promise<Uint8Array> {
    while (true) {
      const index = findBytes(this.buffered, delimiter);
      if (index >= 0) {
        const end = index + delimiter.length;
        if (end > maxBytes) throw new DocumentFetchError("malformed_response");
        return this.consume(end);
      }
      if (this.buffered.length >= maxBytes) throw new DocumentFetchError("malformed_response");
      await this.fill();
    }
  }

  async readLine(maxBytes: number): Promise<string> {
    const line = await this.readUntil(CRLF, maxBytes);
    try {
      return TEXT_DECODER.decode(line.subarray(0, -2));
    } catch {
      throw new DocumentFetchError("malformed_response");
    }
  }

  async readExact(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0 || length > DOCUMENT_FETCH_MAX_BYTES)
      throw new DocumentFetchError("response_too_large");
    while (this.buffered.length < length) await this.fill();
    return this.consume(length);
  }

  async readToEnd(maxBytes: number, deadline: number): Promise<Uint8Array> {
    const body = new BoundedByteAccumulator(maxBytes);
    while (true) {
      if (this.buffered.length > 0) {
        body.append(this.consume(this.buffered.length));
      }
      if (this.eof) return body.finish();
      await withDeadline(this.fill(), deadline, () => this.connection.close());
    }
  }

  private async fill(): Promise<void> {
    if (this.eof) throw new DocumentFetchError("malformed_response");
    const chunk = new Uint8Array(8_192);
    const count = await withDeadline(this.connection.read(chunk), this.deadline, () =>
      this.connection.close(),
    );
    if (count === null) {
      this.eof = true;
      return;
    }
    if (!Number.isInteger(count) || count <= 0 || count > chunk.length)
      throw new DocumentFetchError("malformed_response");
    const next = new Uint8Array(this.buffered.length + count);
    next.set(this.buffered);
    next.set(chunk.subarray(0, count), this.buffered.length);
    this.buffered = next;
  }

  private consume(length: number): Uint8Array {
    const result = this.buffered.slice(0, length);
    this.buffered = this.buffered.slice(length);
    return result;
  }
}

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  onTimeout?: () => void,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    onTimeout?.();
    throw new DocumentFetchError("timeout");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new DocumentFetchError("timeout"));
      }, remaining);
      promise.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DocumentFetchError("invalid_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443")
  )
    throw new DocumentFetchError("invalid_url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (isIpLiteral(hostname) && isUnsafeAddress(hostname))
  )
    throw new DocumentFetchError("rejected_address");
  return url.toString();
}

function sameAddress(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftV4 = parseIpv4(left);
  const rightV4 = parseIpv4(right);
  if (leftV4 !== null || rightV4 !== null) return leftV4 !== null && leftV4 === rightV4;
  const leftV6 = parseIpv6(left);
  const rightV6 = parseIpv6(right);
  return leftV6 !== null && rightV6 !== null && leftV6 === rightV6;
}

function formatConnectHostname(value: string): string {
  return value.includes(":") ? `[${value}]` : value;
}

function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part > 255)) return null;
  return (((numbers[0]! * 256 + numbers[1]!) * 256 + numbers[2]!) * 256 + numbers[3]!) >>> 0;
}

function parseIpv6(value: string): bigint | null {
  if (!value.includes(":") || value.includes("%")) return null;
  if ((value.match(/::/g) ?? []).length > 1) return null;
  const [left, right] = value.toLowerCase().split("::");
  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const result: number[] = [];
    for (const group of groups) {
      if (group.includes(".")) {
        const ipv4 = parseIpv4(group);
        if (ipv4 === null) return null;
        result.push(ipv4 >>> 16, ipv4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        result.push(Number.parseInt(group, 16));
      }
    }
    return result;
  };
  const leftGroups = parsePart(left ?? "");
  const rightGroups = parsePart(right ?? "");
  if (!leftGroups || !rightGroups) return null;
  const groups =
    right === undefined
      ? leftGroups
      : [
          ...leftGroups,
          ...Array(8 - leftGroups.length - rightGroups.length).fill(0),
          ...rightGroups,
        ];
  if (groups.length !== 8 || (right !== undefined && leftGroups.length + rightGroups.length >= 8))
    return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n);
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1)
      if (haystack[index + offset] !== needle[offset]) continue outer;
    return index;
  }
  return -1;
}

function hasForbiddenHeaderCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code <= 0x1f && code !== 0x09)) return true;
  }
  return false;
}

function isValidTrailerLine(value: string): boolean {
  const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*(.*)$/.exec(value);
  return Boolean(match && !hasForbiddenHeaderCharacters(match[2]!));
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
