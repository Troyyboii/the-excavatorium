import { useLayoutEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
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
    void qc.cancelQueries({ queryKey: ["app_metadata"] });
    qc.removeQueries({ queryKey: ["archive"] });
    qc.removeQueries({ queryKey: ["app_metadata"] });

    setAcknowledgedUserId(currentUserId);
  }, [s.status, currentUserId, acknowledgedUserId, qc]);

  if (s.status === "loading" || transitioning) {
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
