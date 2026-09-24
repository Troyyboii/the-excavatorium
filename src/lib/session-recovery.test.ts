import { describe, expect, test } from "bun:test";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createSessionStore, type SessionAuthClient } from "./session";

const signedIn: Session = {
  access_token: "token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1_800_000_000,
  refresh_token: "refresh",
  user: {
    id: "user-a",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-24T00:00:00.000Z",
  },
};

function store() {
  let callback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
  const auth: SessionAuthClient = {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange(next) {
      callback = next;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };
  const s = createSessionStore(auth);
  let notified = 0;
  s.subscribe(() => {
    notified += 1;
  });
  return {
    s,
    emit: (e: AuthChangeEvent, x: Session | null) => callback?.(e, x),
    notified: () => notified,
  };
}

describe("password recovery state", () => {
  test("is off until a PASSWORD_RECOVERY event arrives", () => {
    const { s } = store();
    expect(s.isRecoveryPending()).toBe(false);
  });

  test("a recovery event marks recovery pending and finishing clears it", () => {
    const { s, emit, notified } = store();
    emit("PASSWORD_RECOVERY", signedIn);
    expect(s.isRecoveryPending()).toBe(true);
    const before = notified();
    s.clearRecovery();
    expect(s.isRecoveryPending()).toBe(false);
    expect(notified()).toBe(before + 1);
    // Clearing again is a no-op and does not re-notify.
    s.clearRecovery();
    expect(notified()).toBe(before + 1);
  });

  test("signing out abandons a pending recovery", () => {
    const { s, emit } = store();
    emit("PASSWORD_RECOVERY", signedIn);
    emit("SIGNED_OUT", null);
    expect(s.isRecoveryPending()).toBe(false);
    expect(s.getSnapshot()).toEqual({ status: "signed-out" });
  });

  test("an ordinary sign-in does not enter recovery", () => {
    const { s, emit } = store();
    emit("SIGNED_IN", signedIn);
    expect(s.isRecoveryPending()).toBe(false);
  });
});
