import { describe, expect, test } from "bun:test";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createSessionStore, type SessionAuthClient } from "./session";

function session(userId: string, accessToken: string): Session {
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1_800_000_000,
    refresh_token: `refresh-${userId}`,
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-17T00:00:00.000Z",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function authClient(getSession: SessionAuthClient["getSession"]): SessionAuthClient & {
  emit: (event: AuthChangeEvent, next: Session | null) => void;
} {
  let callback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
  return {
    getSession,
    onAuthStateChange(nextCallback) {
      callback = nextCallback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    emit(event, next) {
      if (!callback) throw new Error("Session store has not subscribed.");
      callback(event, next);
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("session restoration ordering", () => {
  test("does not let a stale initial read overwrite a newer sign-in event", async () => {
    const initial = deferred<{
      data: { session: Session | null };
      error: unknown;
    }>();
    const auth = authClient(() => initial.promise);
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    const signedIn = session("user-a", "token-a");

    auth.emit("SIGNED_IN", signedIn);
    initial.resolve({ data: { session: null }, error: null });
    await settle();

    expect(store.getSnapshot()).toEqual({ status: "signed-in", session: signedIn });
    unsubscribe();
  });

  test("does not let a stale initial read overwrite an explicit sign-out", async () => {
    const initial = deferred<{
      data: { session: Session | null };
      error: unknown;
    }>();
    const auth = authClient(() => initial.promise);
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});

    auth.emit("SIGNED_OUT", null);
    initial.resolve({ data: { session: session("user-a", "old-token") }, error: null });
    await settle();

    expect(store.getSnapshot()).toEqual({ status: "signed-out" });
    unsubscribe();
  });

  test("preserves an auth event emitted synchronously during registration", async () => {
    const signedIn = session("user-a", "token-a");
    const auth: SessionAuthClient = {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      onAuthStateChange(callback) {
        callback("INITIAL_SESSION", signedIn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    };
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    await settle();

    expect(store.getSnapshot()).toEqual({ status: "signed-in", session: signedIn });
    unsubscribe();
  });

  test("uses token refresh and account-change events as the latest state", async () => {
    const first = session("user-a", "token-a");
    const refreshed = session("user-a", "token-b");
    const otherUser = session("user-b", "token-c");
    const auth = authClient(async () => ({ data: { session: first }, error: null }));
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    await settle();

    auth.emit("TOKEN_REFRESHED", refreshed);
    expect(store.getSnapshot()).toEqual({ status: "signed-in", session: refreshed });

    auth.emit("SIGNED_IN", otherUser);
    expect(store.getSnapshot()).toEqual({ status: "signed-in", session: otherUser });
    unsubscribe();
  });
});

describe("session restoration failures", () => {
  test("keeps a getSession error distinct from a definitive signed-out state", async () => {
    const auth = authClient(async () => ({
      data: { session: null },
      error: new Error("temporary network failure"),
    }));
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    await settle();

    expect(store.getSnapshot()).toEqual({ status: "restore-error" });
    unsubscribe();
  });

  test("recovers the saved session on retry without another sign-in", async () => {
    const saved = session("user-a", "token-a");
    let attempts = 0;
    const auth = authClient(async () => {
      attempts += 1;
      return attempts === 1
        ? { data: { session: null }, error: new Error("offline") }
        : { data: { session: saved }, error: null };
    });
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    await settle();
    expect(store.getSnapshot()).toEqual({ status: "restore-error" });

    await store.retry();

    expect(store.getSnapshot()).toEqual({ status: "signed-in", session: saved });
    expect(attempts).toBe(2);
    unsubscribe();
  });

  test("treats a rejected restoration promise as recoverable", async () => {
    const auth = authClient(async () => {
      throw new Error("network unavailable");
    });
    const store = createSessionStore(auth);
    const unsubscribe = store.subscribe(() => {});
    await settle();

    expect(store.getSnapshot()).toEqual({ status: "restore-error" });
    unsubscribe();
  });
});
