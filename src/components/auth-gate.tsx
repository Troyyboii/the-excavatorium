import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { LoginScreen } from "./login-screen";
import { AppShell } from "./app-shell";

export function AuthGate({ children }: { children: ReactNode }) {
  const s = useSession();
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
