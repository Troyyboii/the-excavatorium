import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

// Spec §3: magic-link only, no account creation, neutral copy regardless
// of outcome to avoid revealing whether an email address exists.
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    const emailRedirectTo =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo },
    });
    if (error) console.warn("signInWithOtp error", error);
    setStatus("If this address is authorized, a sign-in link has been sent.");
    setSending(false);
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
            Enter the authorized email address to receive a secure sign-in link.
          </p>
        </header>
        <form
          onSubmit={onSubmit}
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
          <button
            type="submit"
            disabled={sending || email.trim().length === 0}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color:var(--primary)]/90 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send sign-in link"}
          </button>
          {status ? (
            <p
              role="status"
              className="mt-3 text-sm text-muted-foreground"
            >
              {status}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
