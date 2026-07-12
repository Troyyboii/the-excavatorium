import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase";

export const Route = createFileRoute("/")({
  component: Index,
  ssr: false,
});

type ConnectivityState =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

function Index() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState<null | { email: string | null }>(null);
  const [conn, setConn] = useState<ConnectivityState>({ kind: "checking" });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ? { email: data.session.user.email ?? null } : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? { email: s.user.email ?? null } : null);
    });

    // Minimal read-only connectivity probe: hit the Supabase Auth
    // settings endpoint using the publishable key. Success proves the
    // browser can reach the configured project. No archive tables are
    // read here.
    fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: {
        apikey: (
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
        ) ?? "",
      },
    })
      .then((r) => {
        if (!mounted) return;
        if (r.ok) setConn({ kind: "ok" });
        else setConn({ kind: "error", message: `HTTP ${r.status}` });
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setConn({
          kind: "error",
          message: e instanceof Error ? e.message : "Network error",
        });
      });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    const emailRedirectTo =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });
    // Neutral copy regardless of outcome to avoid revealing whether
    // the address exists. Real errors (network, misconfiguration) are
    // logged for the operator only.
    if (error) console.warn("signInWithOtp error", error);
    setStatus("If this address is authorized, a sign-in link has been sent.");
    setSending(false);
  }

  async function onSignOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            The Excavatorium
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Private technical judgment archive.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the authorized email address to receive a secure sign-in link.
          </p>
        </header>

        {session ? (
          <section className="rounded-md border border-border bg-card p-6">
            <p className="text-sm text-foreground">
              Signed in as{" "}
              <span className="font-mono">{session.email ?? "(no email)"}</span>
            </p>
            <button
              onClick={onSignOut}
              className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              Sign out
            </button>
          </section>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-md border border-border bg-card p-6"
          >
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground"
            >
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
              className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send sign-in link"}
            </button>
            {status ? (
              <p className="mt-3 text-sm text-muted-foreground">{status}</p>
            ) : null}
          </form>
        )}

        <section className="mt-8 rounded-md border border-border bg-card/50 p-4 text-xs">
          <h2 className="mb-2 font-medium text-foreground">
            Foundation status
          </h2>
          <dl className="space-y-1 text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>Supabase project</dt>
              <dd className="font-mono truncate max-w-[60%]" title={SUPABASE_URL}>
                {new URL(SUPABASE_URL).host}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Auth reachability</dt>
              <dd>
                {conn.kind === "checking"
                  ? "checking…"
                  : conn.kind === "ok"
                    ? "reachable"
                    : `unreachable (${conn.message})`}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Session</dt>
              <dd>{session ? "authenticated" : "signed out"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-muted-foreground">
            Phase A foundation. Product interface stops here until the manual
            verification gate is recorded.
          </p>
        </section>
      </div>
    </main>
  );
}
