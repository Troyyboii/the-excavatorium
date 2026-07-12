import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

// Spec §3: no account creation. Password sign-in is the primary path;
// magic-link is kept as a fallback for the authorized user. Neither path
// calls signUp.
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [linkSending, setLinkSending] = useState(false);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwSubmitting(true);
    setPwError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setPwError(error.message);
    } else {
      // Do not retain the password in component state after a successful
      // sign-in. AuthGate will unmount this screen on the session change.
      setPassword("");
    }
    setPwSubmitting(false);
  }

  async function onMagicLink() {
    if (email.trim().length === 0) {
      setLinkStatus("Enter the authorized email address first.");
      return;
    }
    setLinkSending(true);
    setLinkStatus(null);
    const emailRedirectTo =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo },
    });
    if (error) console.warn("signInWithOtp error", error);
    setLinkStatus("If this address is authorized, a sign-in link has been sent.");
    setLinkSending(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-4xl tracking-tight text-foreground">
            The Excavatorium
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Private technical judgment archive.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the authorized email and password.
          </p>
        </header>
        <form
          onSubmit={onPasswordSubmit}
          className="rounded-lg border border-border bg-card p-6"
        >
          <label htmlFor="email" className="block text-sm text-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />

          <label htmlFor="password" className="mt-4 block text-sm text-foreground">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />

          <button
            type="submit"
            disabled={
              pwSubmitting || email.trim().length === 0 || password.length === 0
            }
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color:var(--primary)]/90 disabled:opacity-60"
          >
            {pwSubmitting ? "Signing in…" : "Sign in"}
          </button>

          {pwError ? (
            <p
              role="alert"
              className="mt-3 text-sm text-[color:var(--destructive-foreground)]"
            >
              {pwError}
            </p>
          ) : null}
        </form>

        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <h2 className="font-serif text-base text-foreground">
            Trouble signing in?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Send a one-time sign-in link to the authorized email as a fallback.
          </p>
          <button
            type="button"
            onClick={onMagicLink}
            disabled={linkSending}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)] disabled:opacity-60"
          >
            {linkSending ? "Sending…" : "Email me a sign-in link"}
          </button>
          {linkStatus ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {linkStatus}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
