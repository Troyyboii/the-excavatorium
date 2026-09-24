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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ownerId = "123e4567-e89b-12d3-a456-426614174000";
const otherOwnerId = "223e4567-e89b-12d3-a456-426614174099";
const ownerEmail = "owner@example.test";

type Call = { kind: string; detail?: unknown };
type StorageEntry = { name: string; id: string | null };

function parentAndName(fullPath: string): { parent: string; name: string } {
  const lastSlash = fullPath.lastIndexOf("/");
  if (lastSlash < 0) return { parent: "", name: fullPath };
  return { parent: fullPath.slice(0, lastSlash), name: fullPath.slice(lastSlash + 1) };
}

/** Mutable Storage listing map that shifts after removes (real pagination behavior). */
function createMutableStorage(
  initial: Map<string, StorageEntry[]>,
  calls: Call[],
  options: { storageError?: boolean; removeError?: boolean } = {},
) {
  const storageObjects = new Map(
    [...initial.entries()].map(([key, entries]) => [key, entries.map((e) => ({ ...e }))]),
  );

  const storageClient = {
    storage: {
      from(_bucket: string) {
        return {
          list(path = "", listOptions?: { limit?: number; offset?: number }) {
            calls.push({ kind: "storage.list", detail: { path, options: listOptions } });
            if (options.storageError) {
              return Promise.resolve({ data: null, error: { message: "list failed" } });
            }
            const all = storageObjects.get(path) ?? [];
            const offset = listOptions?.offset ?? 0;
            const limit = listOptions?.limit ?? 100;
            return Promise.resolve({ data: all.slice(offset, offset + limit), error: null });
          },
          remove(paths: string[]) {
            calls.push({ kind: "storage.remove", detail: paths });
            if (options.removeError) {
              return Promise.resolve({ error: { message: "remove failed" } });
            }
            for (const fullPath of paths) {
              const { parent, name } = parentAndName(fullPath);
              const entries = storageObjects.get(parent);
              if (!entries) continue;
              storageObjects.set(
                parent,
                entries.filter((entry) => entry.name !== name),
              );
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };

  return { storageClient, storageObjects };
}

function harness(
  options: {
    signedIn?: boolean;
    email?: string | null;
    purgeError?: boolean;
    storageError?: boolean;
    removeError?: boolean;
    deleteError?: boolean;
    trusted?: boolean;
    passwordOk?: boolean;
    storageSeed?: Map<string, StorageEntry[]>;
  } = {},
) {
  const calls: Call[] = [];
  const defaultSeed = new Map<string, StorageEntry[]>([
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

  const { storageClient, storageObjects } = createMutableStorage(
    options.storageSeed ?? defaultSeed,
    calls,
    { storageError: options.storageError, removeError: options.removeError },
  );

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
    verifyPassword: (email, password, expectedOwnerId) => {
      calls.push({
        kind: "verifyPassword",
        detail: { email, passwordLength: password.length, expectedOwnerId },
      });
      return Promise.resolve(options.passwordOk !== false && expectedOwnerId === ownerId);
    },
  };

  return {
    calls,
    handler: createAccountDeleteHandler(dependencies),
    storageClient,
    storageObjects,
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

function remainingFileCount(storageObjects: Map<string, StorageEntry[]>, prefix: string): number {
  let count = 0;
  for (const [path, entries] of storageObjects) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      count += entries.filter((entry) => entry.id !== null).length;
    }
  }
  return count;
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
    calls.some((c) => c.kind === "trusted.rpc" || c.kind === "storage.remove"),
    false,
  );
});

Deno.test(
  "re-auths, purges Storage, then structured rows via service_role, then auth.users",
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
    const verify = calls.find((c) => c.kind === "verifyPassword");
    assertEquals((verify?.detail as { expectedOwnerId: string }).expectedOwnerId, ownerId);
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
    const storageIdx = kinds.indexOf("storage.remove");
    const purgeIdx = kinds.indexOf("trusted.rpc");
    const deleteIdx = kinds.indexOf("auth.admin.deleteUser");
    assertEquals(storageIdx >= 0 && purgeIdx > storageIdx && deleteIdx > purgeIdx, true);
    assertEquals(
      calls.some((c) => c.kind === "auth.admin.deleteUser" && c.detail === ownerId),
      true,
    );
  },
);

Deno.test("aborts before DB purge and auth delete when Storage listing fails", async () => {
  const { calls, handler } = harness({ storageError: true });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 503);
  assertEquals(
    calls.some((c) => c.kind === "trusted.rpc" || c.kind === "auth.admin.deleteUser"),
    false,
  );
});

Deno.test("aborts before DB purge and auth delete when Storage remove fails", async () => {
  const { calls, handler } = harness({ removeError: true });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 503);
  assertEquals(
    calls.some((c) => c.kind === "trusted.rpc" || c.kind === "auth.admin.deleteUser"),
    false,
  );
});

Deno.test("does not delete auth identity when structured purge fails after Storage", async () => {
  const { calls, handler } = harness({ purgeError: true });
  const response = await handler(post(validBody()));
  assertEquals(response.status, 503);
  assertEquals(
    calls.some((c) => c.kind === "storage.remove"),
    true,
  );
  assertEquals(
    calls.some((c) => c.kind === "trusted.rpc"),
    true,
  );
  assertEquals(
    calls.some((c) => c.kind === "auth.admin.deleteUser"),
    false,
  );
});

Deno.test("purgeOwnerDocumentFiles walks nested owner prefixes only", async () => {
  const { storageClient, storageObjects } = harness();
  const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
  assertEquals(removed, 2);
  assertEquals(remainingFileCount(storageObjects, ownerId), 0);
});

Deno.test(
  "purgeOwnerDocumentFiles removes more than 100 objects under one owner prefix",
  async () => {
    const files: StorageEntry[] = Array.from({ length: 150 }, (_, i) => ({
      name: `file-${String(i).padStart(3, "0")}.bin`,
      id: `obj-${i}`,
    }));
    const seed = new Map<string, StorageEntry[]>([[ownerId, files]]);
    const calls: Call[] = [];
    const { storageClient, storageObjects } = createMutableStorage(seed, calls);
    const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
    assertEquals(removed, 150);
    assertEquals(remainingFileCount(storageObjects, ownerId), 0);
    // Must re-list from offset 0 after deletes (never rely on advancing offset alone).
    const listOffsets = calls
      .filter((c) => c.kind === "storage.list")
      .map((c) => (c.detail as { options?: { offset?: number } }).options?.offset ?? 0);
    assert(
      listOffsets.every((offset) => offset === 0),
      `expected all list offsets to be 0, got ${JSON.stringify(listOffsets)}`,
    );
    assert(listOffsets.length >= 2, "expected multiple list pages for 150 objects");
  },
);

Deno.test("purgeOwnerDocumentFiles clears nested multi-page folders completely", async () => {
  const folderA = Array.from({ length: 120 }, (_, i) => ({
    name: `a-${String(i).padStart(3, "0")}.bin`,
    id: `a-${i}`,
  }));
  const folderB = Array.from({ length: 110 }, (_, i) => ({
    name: `b-${String(i).padStart(3, "0")}.bin`,
    id: `b-${i}`,
  }));
  const seed = new Map<string, StorageEntry[]>([
    [ownerId, [{ name: "docs", id: null }]],
    [
      `${ownerId}/docs`,
      [
        { name: "batch-a", id: null },
        { name: "batch-b", id: null },
      ],
    ],
    [`${ownerId}/docs/batch-a`, folderA],
    [`${ownerId}/docs/batch-b`, folderB],
  ]);
  const { storageClient, storageObjects } = createMutableStorage(seed, []);
  const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
  assertEquals(removed, 230);
  assertEquals(remainingFileCount(storageObjects, ownerId), 0);
});

Deno.test("purgeOwnerDocumentFiles never lists or removes another owner's prefix", async () => {
  const seed = new Map<string, StorageEntry[]>([
    [ownerId, [{ name: "mine.bin", id: "mine-1" }]],
    [otherOwnerId, [{ name: "theirs.bin", id: "theirs-1" }]],
  ]);
  const calls: Call[] = [];
  const { storageClient, storageObjects } = createMutableStorage(seed, calls);
  const removed = await purgeOwnerDocumentFiles(storageClient, ownerId);
  assertEquals(removed, 1);
  assertEquals(remainingFileCount(storageObjects, ownerId), 0);
  assertEquals(remainingFileCount(storageObjects, otherOwnerId), 1);
  const listedPaths = calls
    .filter((c) => c.kind === "storage.list")
    .map((c) => (c.detail as { path: string }).path);
  assert(
    listedPaths.every((path) => path === ownerId || path.startsWith(`${ownerId}/`)),
    `listed foreign prefix: ${JSON.stringify(listedPaths)}`,
  );
  const removedPaths = calls
    .filter((c) => c.kind === "storage.remove")
    .flatMap((c) => c.detail as string[]);
  assert(
    removedPaths.every((path) => path.startsWith(`${ownerId}/`) || path === `${ownerId}/mine.bin`),
    `removed foreign path: ${JSON.stringify(removedPaths)}`,
  );
});
