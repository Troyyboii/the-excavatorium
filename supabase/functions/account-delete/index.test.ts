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
const ownerEmail = "owner@example.test";

type Call = { kind: string; detail?: unknown };

function harness(
  options: {
    signedIn?: boolean;
    confirmation?: string;
    password?: string;
    email?: string | null;
    purgeError?: boolean;
    deleteError?: boolean;
    trusted?: boolean;
    passwordOk?: boolean;
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
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ kind: "user.rpc", detail: { fn, args } });
      return Promise.resolve({ data: null, error: { message: "authenticated must not purge" } });
    },
  };

  const trustedClient = {
    ...storageClient,
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ kind: "trusted.rpc", detail: { fn, args } });
      if (options.purgeError) {
        return Promise.resolve({ data: null, error: { message: "purge failed" } });
      }
      return Promise.resolve({
        data: { purged: true, deleted_records: 2, deleted_cases: 1, owner_id: ownerId },
        error: null,
      });
    },
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
              user: {
                id: ownerId,
                email: options.email === undefined ? ownerEmail : options.email,
              },
              authorization: "Bearer jwt",
            } as unknown as AuthenticatedSupabase),
      ),
    trustedClient: () =>
      options.trusted === false
        ? null
        : (trustedClient as unknown as AuthenticatedSupabase["client"]),
    verifyPassword: (email, password) => {
      calls.push({ kind: "verifyPassword", detail: { email, passwordLength: password.length } });
      return Promise.resolve(options.passwordOk !== false);
    },
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    confirmation: CONFIRMATION_PHRASE,
    password: "correct-horse-battery",
    ...overrides,
  };
}

Deno.test("refuses unauthenticated callers before any purge", async () => {
  const { calls, handler } = harness({ signedIn: false });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("requires the exact confirmation phrase and password", async () => {
  const { calls, handler } = harness();
  const response = await handler(post({ confirmation: "delete", password: "x" }));
  assertEquals(response.status, 400);
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser" || c.kind === "trusted.rpc"),
    false,
  );
});

Deno.test("rejects incorrect password before destructive work", async () => {
  const { calls, handler } = harness({ passwordOk: false });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 401);
  assertEquals(
    calls.some((c) => c.kind === "trusted.rpc" || c.kind === "storage.remove"),
    false,
  );
});

Deno.test("rejects accounts without an email login for password re-auth", async () => {
  const { calls, handler } = harness({ email: null });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 400);
  assertEquals(
    calls.some((c) => c.kind === "trusted.rpc"),
    false,
  );
});

Deno.test(
  "re-auths, purges structured rows via service_role, then Storage, then auth.users",
  async () => {
    const { calls, handler } = harness();
    const response = await handler(post(validBody()));
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.deleted, true);
    assertEquals(body.storageObjectsRemoved, 2);
    assertEquals(
      calls.some((c) => c.kind === "verifyPassword"),
      true,
    );
    const trustedPurge = calls.find(
      (c) =>
        c.kind === "trusted.rpc" && (c.detail as { fn: string }).fn === "purge_owner_account_data",
    );
    assertEquals(Boolean(trustedPurge), true);
    assertEquals((trustedPurge?.detail as { args: { runtime_owner_id: string } }).args, {
      runtime_owner_id: ownerId,
    });
    assertEquals(
      calls.some((c) => c.kind === "user.rpc"),
      false,
    );
    const kinds = calls.map((c) => c.kind);
    const purgeIdx = kinds.indexOf("trusted.rpc");
    const storageIdx = kinds.indexOf("storage.remove");
    const deleteIdx = kinds.indexOf("auth.admin.deleteUser");
    assertEquals(purgeIdx >= 0 && storageIdx > purgeIdx && deleteIdx > storageIdx, true);
    assertEquals(
      calls.some((c) => c.kind === "auth.admin.deleteUser" && c.detail === ownerId),
      true,
    );
  },
);

Deno.test("does not delete auth identity when structured purge fails", async () => {
  const { calls, handler } = harness({ purgeError: true });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 503);
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser" || c.kind === "storage.remove"),
    false,
  );
});

Deno.test("purgeOwnerDocumentFiles walks nested owner prefixes only", async () => {
  const { storageClient } = harness();
  const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
  assertEquals(removed, 2);
});
