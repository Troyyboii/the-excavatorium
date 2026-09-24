// Centralized session hook. Reads the current Supabase session and stays in
// sync with sign-in / sign-out / user-change events via one shared subscriber
// so per-page listeners are unnecessary.
import { useSyncExternalStore } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "restore-error" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

export type SessionAuthClient = {
  getSession(): Promise<{
    data: { session: Session | null };
    error: unknown;
  }>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): unknown;
};

const SERVER_STATE: SessionState = { status: "loading" };

export function createSessionStore(auth: SessionAuthClient) {
  let currentState: SessionState = { status: "loading" };
  const listeners = new Set<() => void>();
  let started = false;
  let authEventRevision = 0;
  let restoreRequestRevision = 0;
  // True between a PASSWORD_RECOVERY auth event and the owner either setting a
  // new password or signing out. It is in-memory only; a reload of the
  // recovery session falls back to the normal signed-in shell, where Settings
  // offers the ordinary change-password form.
  let recoveryPending = false;

  function emit() {
    for (const listener of listeners) listener();
  }

  function setState(next: SessionState, force = false) {
    const prev = currentState;
    if (
      !force &&
      prev.status === next.status &&
      (prev.status !== "signed-in" ||
        (next.status === "signed-in" &&
          prev.session.user.id === next.session.user.id &&
          prev.session.access_token === next.session.access_token))
    ) {
      return;
    }
    currentState = next;
    emit();
  }

  async function restoreSession(eventRevision = authEventRevision) {
    const requestRevision = ++restoreRequestRevision;
    if (currentState.status !== "signed-in") {
      setState({ status: "loading" });
    }

    try {
      const { data, error } = await auth.getSession();

      // An auth event is newer and authoritative. This prevents a slow
      // initial getSession() result from overwriting a later sign-in,
      // sign-out, token refresh, or account change.
      if (requestRevision !== restoreRequestRevision || eventRevision !== authEventRevision) {
        return;
      }

      if (error) {
        setState({ status: "restore-error" });
        return;
      }

      setState(
        data.session ? { status: "signed-in", session: data.session } : { status: "signed-out" },
      );
    } catch {
      if (requestRevision === restoreRequestRevision && eventRevision === authEventRevision) {
        setState({ status: "restore-error" });
      }
    }
  }

  function ensureStarted() {
    if (started) return;
    started = true;

    // Subscribe first so every later auth event can invalidate an older
    // asynchronous restoration result.
    const preSubscriptionRevision = authEventRevision;
    auth.onAuthStateChange((event, session) => {
      authEventRevision += 1;
      if (event === "PASSWORD_RECOVERY") recoveryPending = true;
      if (event === "SIGNED_OUT") recoveryPending = false;
      // USER_UPDATED can retain both the user id and token while changing
      // profile/email metadata. It is still authoritative and must reach
      // subscribers so account-dependent UI does not remain stale.
      setState(
        session ? { status: "signed-in", session } : { status: "signed-out" },
        event === "USER_UPDATED",
      );
    });
    void restoreSession(preSubscriptionRevision);
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureStarted();
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    subscribe,
    getSnapshot: () => currentState,
    getServerSnapshot: () => SERVER_STATE,
    retry: restoreSession,
    isRecoveryPending: () => recoveryPending,
    clearRecovery: () => {
      if (!recoveryPending) return;
      recoveryPending = false;
      emit();
    },
  };
}

const sessionStore = createSessionStore(supabase.auth);

export function useSession(): SessionState {
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
}

/** True while the owner arrived through a password-reset link and has not yet chosen a new password. */
export function usePasswordRecoveryPending(): boolean {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.isRecoveryPending, () => false);
}

export function finishPasswordRecovery(): void {
  sessionStore.clearRecovery();
}

export function retrySessionRestoration(): Promise<void> {
  return sessionStore.retry();
}

export function useCurrentUserId(): string | null {
  const s = useSession();
  return s.status === "signed-in" ? s.session.user.id : null;
}
