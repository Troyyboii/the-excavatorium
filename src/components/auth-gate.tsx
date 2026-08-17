import { useLayoutEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { retrySessionRestoration, useSession } from "@/lib/session";
import { LoginScreen } from "./login-screen";
import { AppShell } from "./app-shell";

/**
 * Render-safe account-transition gate.
 *
 * The single centralized Supabase auth subscription lives in
 * src/lib/session.ts. This component observes the derived session and
 * gates rendering so that:
 *
 *   - null → user, user → null, and user → different-user transitions
 *     never let previous-user data flash on screen;
 *   - cache mutations (cancel + remove of archive / app_metadata queries)
 *     happen in a layout effect, never during render;
 *   - the signed-in shell only mounts after the previous user's user-scoped
 *     queries have been evicted.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const s = useSession();
  const qc = useQueryClient();

  const currentUserId = s.status === "signed-in" ? s.session.user.id : null;

  // acknowledgedUserId lags currentUserId by one layout-effect tick whenever
  // the authenticated identity changes. While they disagree, we render a
  // neutral transition screen instead of the old-user shell so no stale
  // rows can paint.
  const [acknowledgedUserId, setAcknowledgedUserId] = useState<string | null>(currentUserId);

  const transitioning = s.status !== "loading" && acknowledgedUserId !== currentUserId;

  useLayoutEffect(() => {
    if (s.status === "loading") return;
    if (acknowledgedUserId === currentUserId) return;

    // Evict the previous account's user-scoped caches BEFORE the new
    // shell can mount and issue fetches. Only archive- and
    // app_metadata-scoped keys are user-owned; unrelated caches (routing,
    // static config) are left alone.
    void qc.cancelQueries({ queryKey: ["archive"] });
    void qc.cancelQueries({ queryKey: ["archive-records"] });
    void qc.cancelQueries({ queryKey: ["archive-links"] });
    void qc.cancelQueries({ queryKey: ["app_metadata"] });
    void qc.cancelQueries({ queryKey: ["custodian"] });
    qc.removeQueries({ queryKey: ["archive"] });
    qc.removeQueries({ queryKey: ["archive-records"] });
    qc.removeQueries({ queryKey: ["archive-links"] });
    qc.removeQueries({ queryKey: ["app_metadata"] });
    qc.removeQueries({ queryKey: ["custodian"] });

    setAcknowledgedUserId(currentUserId);
  }, [s.status, currentUserId, acknowledgedUserId, qc]);

  if (s.status === "loading" || transitioning) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (s.status === "restore-error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="font-serif text-2xl text-foreground">Session restoration paused</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The saved session could not be checked. No new sign-in is required; reconnect and retry.
          </p>
          <button
            type="button"
            onClick={() => void retrySessionRestoration()}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)]"
          >
            Retry session restoration
          </button>
        </section>
      </main>
    );
  }
  if (s.status === "signed-out") {
    return <LoginScreen />;
  }
  return <AppShell email={s.session.user.email ?? null}>{children}</AppShell>;
}
