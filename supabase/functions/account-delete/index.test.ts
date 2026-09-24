import {
  CONFIRMATION_PHRASE,
  createAccountDeleteHandler,
  purgeOwnerDocumentFiles,
  type AccountDeleteDependencies,
} from "./index.ts";
import type { AuthenticatedSupabase } from "../_shared/http.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ownerId = "123e4567-e89b-12d3-a456-426614174000";

type Call = { kind: string; detail?: unknown };

function harness(
  options: {
    signedIn?: boolean;
    confirmation?: string;
    purgeError?: boolean;
    deleteError?: boolean;
    trusted?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const storageObjects = new Map<string, Array<{ name: string; id: string | null }>>([
    [ownerId, [{ name: "documents", id: null }]],
    [`${ownerId}/documents`, [{ name: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id: null }]],
    [
      `${ownerId}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      [
        { name: "original", id: null },
        { name: "extracted", id: null },
      ],
    ],
    [
      `${ownerId}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original`,
      [{ name: "source.pdf", id: "obj-1" }],
    ],
    [
      `${ownerId}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extracted`,
      [{ name: "normalized.json", id: "obj-2" }],
    ],
  ]);

  const storageClient = {
    storage: {
      from(_bucket: string) {
        return {
          list(path = "", options?: { limit?: number; offset?: number }) {
            calls.push({ kind: "storage.list", detail: { path, options } });
            const all = storageObjects.get(path) ?? [];
            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? 100;
            return Promise.resolve({ data: all.slice(offset, offset + limit), error: null });
          },
          remove(paths: string[]) {
            calls.push({ kind: "storage.remove", detail: paths });
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };

  const userClient = {
    ...storageClient,
    rpc(fn: string) {
      calls.push({ kind: "rpc", detail: fn });
      if (options.purgeError) {
        return Promise.resolve({ data: null, error: { message: "purge failed" } });
      }
      return Promise.resolve({
        data: { purged: true, deleted_records: 2, deleted_cases: 1 },
        error: null,
      });
    },
  };

  const trustedClient = {
    ...storageClient,
    auth: {
      admin: {
        deleteUser(id: string) {
          calls.push({ kind: "auth.admin.deleteUser", detail: id });
          if (options.deleteError) {
            return Promise.resolve({ data: null, error: { message: "delete failed" } });
          }
          return Promise.resolve({ data: { user: null }, error: null });
        },
      },
    },
  };

  const dependencies: AccountDeleteDependencies = {
    authenticate: () =>
      Promise.resolve(
        options.signedIn === false
          ? null
          : ({
              client: userClient,
              user: { id: ownerId },
              authorization: "Bearer jwt",
            } as unknown as AuthenticatedSupabase),
      ),
    trustedClient: () =>
      options.trusted === false
        ? null
        : (trustedClient as unknown as AuthenticatedSupabase["client"]),
  };

  return {
    calls,
    handler: createAccountDeleteHandler(dependencies),
    storageClient,
  };
}

function post(body: unknown): Request {
  return new Request("https://example.test/account-delete", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("refuses unauthenticated callers before any purge", async () => {
  const { calls, handler } = harness({ signedIn: false });
  const response = await handler(post({ confirmation: CONFIRMATION_PHRASE }));
  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("requires the exact confirmation phrase", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ confirmation: "delete" }));
  assertEquals(response.status, 400);
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser"),
    false,
  );
});

Deno.test("purges Storage, structured rows, then auth.users", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ confirmation: CONFIRMATION_PHRASE }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.deleted, true);
  assertEquals(body.storageObjectsRemoved, 2);
  const removedPaths = calls
    .filter((c) => c.kind === "storage.remove")
    .flatMap((c) => c.detail as string[])
    .sort();
  assertEquals(removedPaths, [
    `${ownerId}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extracted/normalized.json`,
    `${ownerId}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original/source.pdf`,
  ]);
  assertEquals(
    calls.some((c) => c.kind === "rpc" && c.detail === "purge_owner_account_data"),
    true,
  );
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser" && c.detail === ownerId),
    true,
  );
});

Deno.test("does not delete auth identity when structured purge fails", async () => {
  const { calls, handler } = harness({ purgeError: true });
  const response = await handler(post({ confirmation: CONFIRMATION_PHRASE }));
  assertEquals(response.status, 503);
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser"),
    false,
  );
});

Deno.test("purgeOwnerDocumentFiles walks nested owner prefixes only", async () => {
  const { storageClient } = harness();
  const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
  assertEquals(removed, 2);
});
