import { createDocumentSaveHandler } from "./index.ts";
import type { AuthenticatedSupabase } from "../_shared/http.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const userId = "123e4567-e89b-12d3-a456-426614174000";

function requestWithFile(): Request {
  const form = new FormData();
  form.append("file", new File(["A bounded document."], "notes.txt", { type: "text/plain" }));
  form.append(
    "record",
    JSON.stringify({
      recordType: "document",
      title: "Notes",
      summary: "",
      tags: [],
      recordData: {
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: null,
        documentDate: null,
        pageCount: null,
        storagePath: null,
        extractedContentPath: null,
        contentHash: null,
        highSignalFindings: [],
        keyClaims: [],
        contradictions: [],
        uncertainties: [],
        sourceReferences: [],
        projectRoute: null,
      },
    }),
  );
  form.append("selectedTargetIds", "[]");
  return new Request("https://example.test/document-save", { method: "POST", body: form });
}

function fakeAuth(options: { failExtractedUpload?: boolean; failSave?: boolean }) {
  const removals: string[][] = [];
  let uploads = 0;
  const auth = {
    client: {
      storage: {
        from() {
          return {
            async upload() {
              uploads += 1;
              return options.failExtractedUpload && uploads === 2
                ? { data: null, error: { message: "storage unavailable" } }
                : { data: {}, error: null };
            },
            async remove(paths: string[]) {
              removals.push(paths);
              return { data: [], error: null };
            },
          };
        },
      },
      async rpc() {
        return options.failSave
          ? { data: null, error: { message: "record save unavailable" } }
          : { data: { id: crypto.randomUUID(), isNew: true }, error: null };
      },
    },
    user: { id: userId },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
  return { auth, removals };
}

Deno.test(
  "document save removes both newly-uploaded objects when record persistence fails",
  async () => {
    const { auth, removals } = fakeAuth({ failSave: true });
    const handler = createDocumentSaveHandler(async () => auth);

    const response = await handler(requestWithFile());

    assert(response.status === 502, "expected a safe record-save failure");
    assert(removals.length === 1, "expected one cleanup request");
    assert(removals[0].length === 2, "expected both original and normalized objects to be removed");
    assert(
      removals[0].every((path) => path.startsWith(`${userId}/documents/`)),
      "expected cleanup to stay in the authenticated owner's document scope",
    );
  },
);

Deno.test("document save removes the original when normalized-object upload fails", async () => {
  const { auth, removals } = fakeAuth({ failExtractedUpload: true });
  const handler = createDocumentSaveHandler(async () => auth);

  const response = await handler(requestWithFile());

  assert(response.status === 502, "expected a safe storage failure");
  assert(removals.length === 1, "expected cleanup after the second upload fails");
  assert(removals[0].length === 1, "only the successfully-uploaded original should be removed");
});

Deno.test(
  "document save returns a safe 503 when authentication infrastructure throws",
  async () => {
    const handler = createDocumentSaveHandler(async () => {
      throw new Error("do not disclose auth backend details");
    });

    const response = await handler(
      new Request("https://example.test/document-save", { method: "POST" }),
    );

    assert(
      response.status === 503,
      "expected authentication infrastructure failures to be sanitized",
    );
    assert(
      (await response.json()).error === "Authentication is temporarily unavailable.",
      "expected a stable public authentication error",
    );
  },
);
