import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-messages";
import { finishPasswordRecovery } from "@/lib/session";

const inputClass =
  "mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";

// Shown by AuthGate after the owner opens a password-reset link (the
// PASSWORD_RECOVERY auth event). The recovery link has already signed them in,
// so the only remaining step is choosing the new password.
export function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(
        updateError.code === "weak_password"
          ? "That password is too weak. Use a longer or less common password."
          : "The password could not be updated. Request a new reset link and try again.",
      );
      return;
    }
    setPassword("");
    setConfirm("");
    finishPasswordRecovery();
  }

  async function onCancel() {
    await supabase.auth.signOut();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-4xl tracking-tight text-foreground">The Excavatorium</h1>
          <h2 className="mt-4 font-serif text-xl text-foreground">Choose a new password</h2>
        </header>
        <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-6">
          <label htmlFor="reset-password" className="block text-sm text-foreground">
            New password
          </label>
          <input
            id="reset-password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <label htmlFor="reset-password-confirm" className="mt-4 block text-sm text-foreground">
            Confirm new password
          </label>
          <input
            id="reset-password-confirm"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={saving || password.length === 0 || confirm.length === 0}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save password"}
          </button>
          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 inline-flex min-h-11 items-center px-1 text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
          >
            Cancel and sign out
          </button>
        </form>
      </div>
    </main>
  );
}
