import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { LoginScreen } from "./login-screen";
import { AppShell } from "./app-shell";

export function AuthGate({ children }: { children: ReactNode }) {
  const s = useSession();
  const qc = useQueryClient();
  const prevUserRef = useRef<string | null>(null);

  const currentUserId = s.status === "signed-in" ? s.session.user.id : null;

  // Clear every cached query whenever the authenticated user id changes
  // (including sign-in from null, sign-out to null, and switching between
  // accounts). This runs before children render new data, so previous-user
  // rows cannot flash on screen.
  //
  // A single subscriber is enough: the session store in src/lib/session.ts
  // ensures useSession re-renders on every real auth transition.
  if (prevUserRef.current !== currentUserId) {
    qc.removeQueries();
    prevUserRef.current = currentUserId;
  }

  // Belt-and-braces: if the auth listener fires between paints, guarantee
  // the cache is empty for the newly authenticated user before their data
  // is fetched.
  useEffect(() => {
    return () => {
      // No cleanup needed; the ref+removeQueries above owns the transition.
    };
  }, [currentUserId]);

  if (s.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (s.status === "signed-out") {
    return <LoginScreen />;
  }
  return <AppShell email={s.session.user.email ?? null}>{children}</AppShell>;
}
