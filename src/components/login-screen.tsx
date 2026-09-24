import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { authMessages, MIN_PASSWORD_LENGTH } from "@/lib/auth-messages";

type Mode = "sign-in" | "sign-up" | "forgot";

const inputClass =
  "mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const primaryButtonClass =
  "mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color:var(--primary)]/90 disabled:opacity-60";
const linkButtonClass =
  "inline-flex min-h-11 items-center px-1 text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground";

function redirectOrigin(): string | undefined {
  return typeof window !== "undefined" ? window.location.origin : undefined;
}

// Public account lifecycle: sign up, sign in, password reset. Every message
// is neutral about whether an address already has an account; see
// src/lib/auth-messages.ts. A new account starts as an empty private archive;
// no example content is installed and no AI provider key is needed.
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [linkSending, setLinkSending] = useState(false);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setLinkStatus(null);
    setPassword("");
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(authMessages.signIn(signInError));
    } else {
      // Do not retain the password in component state after a successful
      // sign-in. AuthGate will unmount this screen on the session change.
      setPassword("");
    }
    setSubmitting(false);
  }

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(authMessages.passwordTooShort);
      return;
    }
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectOrigin() },
    });
    if (signUpError) {
      const message = authMessages.signUp(signUpError);
      // Anything that could reveal an existing account is reported as the same
      // neutral notice a successful sign-up shows when confirmation is on.
      if (message.kind === "notice") setNotice(message.text);
      else setError(message.text);
    } else if (!data.session) {
      setNotice(authMessages.signUpCheckEmail);
    } else {
      setPassword("");
    }
    setSubmitting(false);
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectOrigin(),
    });
    if (resetError) console.warn("resetPasswordForEmail error", resetError.code ?? resetError.name);
    // Same message whether or not the address has an account.
    setNotice(authMessages.resetRequested);
    setSubmitting(false);
  }

  async function onMagicLink() {
    if (email.trim().length === 0) {
      setLinkStatus("Enter your email address first.");
      return;
    }
    setLinkSending(true);
    setLinkStatus(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: redirectOrigin() },
    });
    if (otpError) console.warn("signInWithOtp error", otpError.code ?? otpError.name);
    setLinkStatus(authMessages.magicLinkRequested);
    setLinkSending(false);
  }

  const heading =
    mode === "sign-up"
      ? "Create your archive"
      : mode === "forgot"
        ? "Reset your password"
        : "Sign in";
  const subheading =
    mode === "sign-up"
      ? "A private archive that starts empty. No AI provider key is needed to use it."
      : mode === "forgot"
        ? "Enter your email address and we will send a reset link if it can be used."
        : "Sign in to your private archive.";
  const onSubmit = mode === "sign-up" ? onSignUp : mode === "forgot" ? onForgot : onSignIn;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-4xl tracking-tight text-foreground">The Excavatorium</h1>
          <h2 className="mt-4 font-serif text-xl text-foreground">{heading}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>
        </header>
        <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-6">
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
            className={inputClass}
          />

          {mode !== "forgot" ? (
            <>
              <label htmlFor="password" className="mt-4 block text-sm text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "sign-up" ? MIN_PASSWORD_LENGTH : undefined}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              {mode === "sign-up" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              ) : null}
            </>
          ) : null}

          <button
            type="submit"
            disabled={
              submitting ||
              email.trim().length === 0 ||
              (mode !== "forgot" && password.length === 0)
            }
            className={primaryButtonClass}
          >
            {mode === "sign-up"
              ? submitting
                ? "Creating account…"
                : "Create account"
              : mode === "forgot"
                ? submitting
                  ? "Sending…"
                  : "Send reset link"
                : submitting
                  ? "Signing in…"
                  : "Sign in"}
          </button>

          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4">
            {mode === "sign-in" ? (
              <>
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={() => switchMode("forgot")}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={() => switchMode("sign-up")}
                >
                  Create an account
                </button>
              </>
            ) : (
              <button
                type="button"
                className={linkButtonClass}
                onClick={() => switchMode("sign-in")}
              >
                Back to sign in
              </button>
            )}
          </div>
        </form>

        {mode === "sign-in" ? (
          <div className="mt-6 rounded-lg border border-border bg-card p-6">
            <h2 className="font-serif text-base text-foreground">Trouble signing in?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Send a one-time sign-in link to your email address as a fallback.
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
        ) : null}
      </div>
    </main>
  );
}
