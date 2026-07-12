// Centralized session hook. Reads the current Supabase session and stays in
// sync with sign-in / sign-out / user-change events via one shared subscriber
// so per-page listeners are unnecessary.
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

let currentState: SessionState = { status: "loading" };
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function setState(next: SessionState) {
  const prev = currentState;
  // Reference-equality is fine: Supabase emits fresh session objects on change.
  if (
    prev.status === next.status &&
    (prev.status !== "signed-in" ||
      (next.status === "signed-in" &&
        prev.session.user.id ===
          (next as { session: Session }).session.user.id &&
        prev.session.access_token ===
          (next as { session: Session }).session.access_token))
  ) {
    return;
  }
  currentState = next;
  emit();
}

function ensureStarted() {
  if (started) return;
  started = true;
  supabase.auth.getSession().then(({ data }) => {
    setState(
      data.session
        ? { status: "signed-in", session: data.session }
        : { status: "signed-out" },
    );
  });
  supabase.auth.onAuthStateChange((_evt, session) => {
    setState(
      session ? { status: "signed-in", session } : { status: "signed-out" },
    );
  });
}

function subscribe(fn: () => void): () => void {
  ensureStarted();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): SessionState {
  return currentState;
}

function getServerSnapshot(): SessionState {
  return { status: "loading" };
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCurrentUserId(): string | null {
  const s = useSession();
  return s.status === "signed-in" ? s.session.user.id : null;
}
