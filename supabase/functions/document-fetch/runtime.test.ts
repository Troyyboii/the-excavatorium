import {
  DOCUMENT_FETCH_MAX_BYTES,
  fetchTemporaryDocument,
  isIpLiteral,
  isUnsafeAddress,
  type DocumentFetchRuntime,
} from "./runtime.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function assertRejects(
  operation: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof Error);
    assertEquals(error.message, expectedMessage);
    return;
  }
  throw new Error(`Expected rejection: ${expectedMessage}`);
}

class FakeConnection {
  readonly writes: string[] = [];
  closed = false;
  private readonly encoder = new TextEncoder();
  private readonly chunks: Uint8Array[];

  constructor(
    response: string | Uint8Array,
    readonly remoteAddr = { hostname: "93.184.216.34", port: 443, transport: "tcp" },
  ) {
    this.chunks = [typeof response === "string" ? this.encoder.encode(response) : response];
  }

  async write(value: Uint8Array): Promise<number> {
    this.writes.push(new TextDecoder().decode(value));
    return value.length;
  }

  async read(target: Uint8Array): Promise<number | null> {
    const chunk = this.chunks[0];
    if (!chunk) return null;
    const count = Math.min(target.length, chunk.length);
    target.set(chunk.subarray(0, count));
    if (count === chunk.length) this.chunks.shift();
    else this.chunks[0] = chunk.slice(count);
    return count;
  }

  close(): void {
    this.closed = true;
  }
}

function response(
  body: string,
  headers = "Content-Type: text/markdown\r\nContent-Length: 11\r\n",
  status = "200 OK",
): string {
  return `HTTP/1.1 ${status}\r\n${headers}\r\n${body}`;
}

function runtimeFor(
  dns: Record<string, string[]> = { "public.example": ["93.184.216.34"] },
  connections: FakeConnection[] = [new FakeConnection(response("hello world"))],
): DocumentFetchRuntime {
  return {
    resolveDns: async (hostname, type) => {
      if (type === "AAAA") throw new Error("no AAAA record");
      return dns[hostname] ?? [];
    },
    connect: async (options) => {
      const connection = connections.shift();
      if (!connection) throw new Error("no fake connection");
      return connection;
    },
    startTls: async (connection, options) => {
      (connection as FakeConnection & { tlsHostname?: string }).tlsHostname = options.hostname;
      return connection;
    },
  };
}

Deno.test("address policy rejects special-use, mapped, and malformed addresses", () => {
  for (const value of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.1",
    "192.52.193.1",
    "192.88.99.1",
    "192.175.48.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001:20::1",
    "2001:30::1",
    "64:ff9b::1",
    "64:ff9b:1::1",
    "not-an-ip",
  ]) {
    assert(isUnsafeAddress(value), value);
  }
  assert(isIpLiteral("93.184.216.34"));
  assert(isIpLiteral("2001:4860:4860::8888"));
  assert(!isUnsafeAddress("93.184.216.34"));
});

Deno.test(
  "pins the TCP destination while retaining the original hostname for TLS and Host",
  async () => {
    const connection = new FakeConnection(response("hello world"));
    const runtime = runtimeFor(undefined, [connection]);
    const result = await fetchTemporaryDocument(
      { download_url: "https://public.example/file?x=1", file_id: "file_1" },
      { runtime },
    );

    assertEquals(new TextDecoder().decode(result.bytes), "hello world");
    assertEquals(
      (connection as FakeConnection & { tlsHostname?: string }).tlsHostname,
      "public.example",
    );
    assert(connection.writes[0]?.includes("GET /file?x=1 HTTP/1.1\r\n"));
    assert(connection.writes[0]?.includes("Host: public.example\r\n"));
    assert(!connection.writes[0]?.includes("Authorization"));
    assert(!connection.writes[0]?.includes("x-excavatorium-fetch-secret"));
  },
);

Deno.test("rejects a mixed public and private DNS answer before connecting", async () => {
  let connects = 0;
  const runtime = runtimeFor({ "mixed.example": ["93.184.216.34", "10.0.0.1"] });
  runtime.connect = async () => {
    connects += 1;
    throw new Error("must not connect");
  };
  await assertRejects(
    () =>
      fetchTemporaryDocument(
        { download_url: "https://mixed.example/file", file_id: "file_1" },
        { runtime },
      ),
    "rejected_address",
  );
  assertEquals(connects, 0);
});

Deno.test("revalidates and repins a safe cross-origin redirect", async () => {
  const first = new FakeConnection(
    response("", "Location: https://second.example/final\r\n", "302 Found"),
  );
  const second = new FakeConnection(response("hello world"), {
    hostname: "93.184.216.35",
    port: 443,
    transport: "tcp",
  });
  const connected: string[] = [];
  const tlsHosts: string[] = [];
  const runtime: DocumentFetchRuntime = {
    resolveDns: async (hostname, type) => {
      if (type === "AAAA") throw new Error("no AAAA record");
      return hostname === "first.example" ? ["93.184.216.34"] : ["93.184.216.35"];
    },
    connect: async (options) => {
      connected.push(options.hostname);
      return connected.length === 1 ? first : second;
    },
    startTls: async (connection, options) => {
      tlsHosts.push(options.hostname);
      return connection;
    },
  };
  const result = await fetchTemporaryDocument(
    { download_url: "https://first.example/start", file_id: "file_1" },
    { runtime },
  );
  assertEquals(new TextDecoder().decode(result.bytes), "hello world");
  assertEquals(connected, ["93.184.216.34", "93.184.216.35"]);
  assertEquals(tlsHosts, ["first.example", "second.example"]);
});

Deno.test("rejects an unsafe redirect before opening its connection", async () => {
  const first = new FakeConnection(
    response("", "Location: https://private.example/final\r\n", "302 Found"),
  );
  let connects = 0;
  const runtime = runtimeFor(
    { "first.example": ["93.184.216.34"], "private.example": ["127.0.0.1"] },
    [first],
  );
  const originalConnect = runtime.connect;
  runtime.connect = async (options) => {
    connects += 1;
    return originalConnect(options);
  };
  await assertRejects(
    () =>
      fetchTemporaryDocument(
        { download_url: "https://first.example/start", file_id: "file_1" },
        { runtime },
      ),
    "rejected_address",
  );
  assertEquals(connects, 1);
});

Deno.test("supports bounded chunked bodies and rejects oversized bodies", async () => {
  const chunked = new FakeConnection(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n" +
      "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n",
  );
  const result = await fetchTemporaryDocument(
    { download_url: "https://public.example/file", file_id: "file_1" },
    { runtime: runtimeFor(undefined, [chunked]) },
  );
  assertEquals(new TextDecoder().decode(result.bytes), "hello world");

  const oversized = new FakeConnection(
    `HTTP/1.1 200 OK\r\nContent-Length: ${DOCUMENT_FETCH_MAX_BYTES + 1}\r\n\r\n`,
  );
  await assertRejects(
    () =>
      fetchTemporaryDocument(
        { download_url: "https://public.example/file", file_id: "file_1" },
        { runtime: runtimeFor(undefined, [oversized]) },
      ),
    "response_too_large",
  );
});

Deno.test("rejects a header block that crosses the hard header limit", async () => {
  const oversizedHeaders = new FakeConnection(
    `HTTP/1.1 200 OK\r\nX-Padding: ${"a".repeat(65_600)}\r\n\r\nhello world`,
  );
  await assertRejects(
    () =>
      fetchTemporaryDocument(
        { download_url: "https://public.example/file", file_id: "file_1" },
        { runtime: runtimeFor(undefined, [oversizedHeaders]) },
      ),
    "malformed_response",
  );
});

Deno.test("fails closed when the connected peer does not match the validated IP", async () => {
  const mismatched = new FakeConnection(response("hello world"), {
    hostname: "93.184.216.35",
    port: 443,
    transport: "tcp",
  });
  await assertRejects(
    () =>
      fetchTemporaryDocument(
        { download_url: "https://public.example/file", file_id: "file_1" },
        { runtime: runtimeFor(undefined, [mismatched]) },
      ),
    "network_failure",
  );
});

Deno.test(
  "classifies URL, DNS, TCP, TLS, and HTTP failures without opening unsafe targets",
  async () => {
    for (const download_url of [
      "http://public.example/file",
      "https://user:password@public.example/file",
      "not-a-url",
      "https://127.0.0.1/file",
    ]) {
      await assertRejects(
        () =>
          fetchTemporaryDocument({ download_url, file_id: "file_1" }, { runtime: runtimeFor() }),
        download_url === "https://127.0.0.1/file" ? "rejected_address" : "invalid_url",
      );
    }

    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://missing.example/file", file_id: "file_1" },
          { runtime: runtimeFor({}) },
        ),
      "dns_resolution_failure",
    );

    const tcpFailure = runtimeFor();
    tcpFailure.connect = async () => {
      throw new Error("tcp failure");
    };
    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://public.example/file", file_id: "file_1" },
          { runtime: tcpFailure },
        ),
      "network_failure",
    );

    const tlsFailure = runtimeFor();
    tlsFailure.startTls = async () => {
      throw new Error("tls failure");
    };
    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://public.example/file", file_id: "file_1" },
          { runtime: tlsFailure },
        ),
      "tls_failure",
    );

    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://public.example/file", file_id: "file_1" },
          {
            runtime: {
              ...runtimeFor(),
              connect: async () => await new Promise(() => undefined),
            },
            timeoutMs: 5,
          },
        ),
      "timeout",
    );

    const malformed = new FakeConnection("not HTTP");
    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://public.example/file", file_id: "file_1" },
          { runtime: runtimeFor(undefined, [malformed]) },
        ),
      "malformed_response",
    );

    const failed = new FakeConnection(response("nope", "Content-Length: 4\r\n", "404 Not Found"));
    await assertRejects(
      () =>
        fetchTemporaryDocument(
          { download_url: "https://public.example/file", file_id: "file_1" },
          { runtime: runtimeFor(undefined, [failed]) },
        ),
      "http_failure",
    );
  },
);

Deno.test("accepts a maximum content-length body without quadratic buffering", async () => {
  const header = new TextEncoder().encode(
    `HTTP/1.1 200 OK\r\nContent-Length: ${DOCUMENT_FETCH_MAX_BYTES}\r\n\r\n`,
  );
  const wire = new Uint8Array(header.length + DOCUMENT_FETCH_MAX_BYTES);
  wire.set(header);
  wire.fill(0x61, header.length);
  const result = await fetchTemporaryDocument(
    { download_url: "https://public.example/file", file_id: "file_1" },
    { runtime: runtimeFor(undefined, [new FakeConnection(wire)]) },
  );
  assertEquals(result.bytes.byteLength, DOCUMENT_FETCH_MAX_BYTES);
  assertEquals(result.bytes[0], 0x61);
  assertEquals(result.bytes[DOCUMENT_FETCH_MAX_BYTES - 1], 0x61);
});
