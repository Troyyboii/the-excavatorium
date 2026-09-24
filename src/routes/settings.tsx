import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/lib/session";
import {
  exportArchiveSnapshot,
  useArchive,
  useAppMetadata,
  useResetArchive,
  useRestoreArchive,
} from "@/lib/archive";
import { PageHeader, Banner, Toast } from "@/components/page-parts";
import { ProviderSection } from "@/components/provider-settings";
import {
  backupFilename,
  buildBackup,
  download,
  validateBackup,
  type BackupCounts,
} from "@/lib/format";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_EXPORT_LIMITATIONS,
  accountExportContainsSecretMaterial,
  accountExportFilename,
} from "@/lib/account-export";
import { deleteOwnerAccount, exportAccountSnapshot } from "@/lib/account-portability";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/settings")({ component: Page, ssr: false });

function Page() {
  const session = useSession();
  const email = session.status === "signed-in" ? (session.session.user.email ?? null) : null;
  const q = useArchive(true);
  const meta = useAppMetadata(true);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  return (
    <div>
      <PageHeader title="Settings" />
      {error ? (
        <div className="mb-4">
          <Banner kind="error" title="Something went wrong">
            {error}
          </Banner>
        </div>
      ) : null}

      {!online ? (
        <div className="mb-4">
          <Banner kind="warning" title="Offline">
            Settings that write to Supabase are disabled until the connection returns.
          </Banner>
        </div>
      ) : null}

      <fieldset disabled={!online} className="space-y-6 disabled:opacity-75">
        <AccountSection email={email} setToast={setToast} setError={setError} />
        <PasswordSection />
        <ProviderSection setToast={setToast} setError={setError} />
        <BackupSection q={q} online={online} setToast={setToast} setError={setError} />
        <StorageSection />
        <DestructiveSection setToast={setToast} setError={setError} />
        <DeleteAccountSection online={online} setToast={setToast} setError={setError} />
        <DiagnosticsSection
          email={email}
          meta={meta.data ?? null}
          qCount={q.data?.records.length ?? null}
          lCount={q.data?.links.length ?? null}
        />
      </fieldset>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function Card({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "destructive";
}) {
  return (
    <section
      className={
        tone === "destructive"
          ? "rounded-lg border border-destructive/55 bg-burgundy-muted/35 p-4 md:p-6"
          : "rounded-lg border border-border bg-card p-4 md:p-6"
      }
    >
      <h2
        className={`mb-3 font-serif text-lg ${tone === "destructive" ? "text-destructive" : "text-foreground"}`}
      >
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function AccountSection({
  email,
  setToast,
  setError,
}: {
  email: string | null;
  setToast: (m: string) => void;
  setError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  async function onSignOut() {
    try {
      // Cancel in-flight archive/metadata reads so they can't 401 into the
      // cache after signOut clears the session.
      await qc.cancelQueries();
      // Drop cached protected data BEFORE signOut so no stale render can
      // happen mid-teardown. AuthGate also clears on the user-id transition
      // that follows.
      qc.removeQueries();
      await supabase.auth.signOut();
      setToast("Signed out");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed.");
    }
  }

  return (
    <Card title="Account">
      <div className="text-sm text-muted-foreground">
        Signed in as <span className="font-mono text-foreground">{email ?? "—"}</span>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)]"
      >
        Sign out
      </button>
    </Card>
  );
}

function PasswordSection() {
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPw.length < 8) {
      setMsg({ kind: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setSaving(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
      return;
    }
    setNewPw("");
    setConfirmPw("");
    setMsg({ kind: "ok", text: "Password updated." });
  }

  return (
    <Card title="Set or change password">
      <p className="text-sm text-muted-foreground">
        Sets or replaces the password for your currently signed-in account.
      </p>
      <form onSubmit={onSubmit} className="space-y-3" autoComplete="off">
        <div>
          <label htmlFor="new-password" className="block text-sm text-foreground">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm text-foreground">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
        </div>
        <button
          type="submit"
          disabled={saving || newPw.length === 0 || confirmPw.length === 0}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save password"}
        </button>
        {msg ? (
          <p
            role={msg.kind === "err" ? "alert" : "status"}
            className={
              msg.kind === "err"
                ? "text-sm font-medium text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {msg.text}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function BackupSection({
  q,
  online,
  setToast,
  setError,
}: {
  q: ReturnType<typeof useArchive>;
  online: boolean;
  setToast: (m: string) => void;
  setError: (m: string | null) => void;
}) {
  const restore = useRestoreArchive();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    counts: BackupCounts;
    payload: ReturnType<typeof buildBackup>;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [exportingArchive, setExportingArchive] = useState(false);
  const [exportingAccount, setExportingAccount] = useState(false);

  // Import and restore need a complete locally loaded archive for their
  // destructive confirmation boundary. Export uses a separate fresh RPC.
  const archiveReady = q.isSuccess && !!q.data;
  const archiveColdOffline = q.state.isColdOffline;
  const linksColdOffline = q.state.linksColdOffline && !!q.data;
  const archiveError = q.isError
    ? q.error instanceof Error
      ? q.error.message
      : String(q.error)
    : null;

  async function onExportArchive() {
    setError(null);
    setExportingArchive(true);
    try {
      const snapshot = await exportArchiveSnapshot();
      // buildBackup intentionally detaches private document Storage paths;
      // validate only that detached, downloadable artifact.
      const data = buildBackup(snapshot.records, snapshot.links);
      // Validate the freshly built backup before offering it for download.
      const check = validateBackup(data);
      if (!check.ok) {
        setError(`Backup validation failed: ${check.error}`);
        return;
      }
      download(backupFilename(), JSON.stringify(data, null, 2), "application/json;charset=utf-8");
      setToast("Restorable archive backup downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportingArchive(false);
    }
  }

  async function onExportAll() {
    setError(null);
    setExportingAccount(true);
    try {
      const data = await exportAccountSnapshot();
      if (accountExportContainsSecretMaterial(data)) {
        setError("Account export aborted: unexpected secret-shaped material was detected.");
        return;
      }
      download(
        accountExportFilename(),
        JSON.stringify(data, null, 2),
        "application/json;charset=utf-8",
      );
      setToast("Full account export downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account export failed.");
    } finally {
      setExportingAccount(false);
    }
  }

  async function onFile(file: File) {
    setParseError(null);
    setError(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setParseError("File is not valid JSON.");
        return;
      }
      // Restore accepts schemaVersion 1 archive backups only (records+links).
      // Account exports (schemaVersion 2) are for portability, not in-app restore.
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as { exportKind?: unknown }).exportKind === "account"
      ) {
        setParseError(
          "This is a full account export. Import restore accepts only a restorable archive backup (records and links).",
        );
        return;
      }
      const res = validateBackup(parsed);
      if (!res.ok) {
        setParseError(res.error);
        return;
      }
      setPendingRestore({ counts: res.counts, payload: res.export });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not read file.");
    }
  }

  async function onConfirmRestore() {
    if (!pendingRestore) return;
    if (!archiveReady) {
      setError("Cannot confirm restore while the current archive state is unknown.");
      return;
    }
    try {
      await restore.mutateAsync(pendingRestore.payload);
      setPendingRestore(null);
      if (fileRef.current) fileRef.current.value = "";
      setToast("Archive restored");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed. Existing data was not changed.");
    }
  }

  return (
    <Card title="Backup and restore">
      {archiveError ? (
        <Banner kind="error" title="Archive failed to load">
          Import and restore are disabled until the archive loads. A fresh export remains available
          while online. {archiveError}
        </Banner>
      ) : null}
      {archiveColdOffline ? (
        <Banner kind="warning" title="Archive unavailable offline">
          This device has no cached archive. Reconnect before importing or restoring data. Export
          remains disabled offline because it creates a fresh server snapshot.
        </Banner>
      ) : null}
      {linksColdOffline ? (
        <Banner kind="warning" title="Cached archive has no link evidence">
          Cached records remain visible, but links were not cached. Reconnect before importing or
          restoring data.
        </Banner>
      ) : null}
      {!archiveReady && !archiveError && !archiveColdOffline && !linksColdOffline ? (
        <p className="text-sm text-muted-foreground">
          Loading the complete archive… Import and restore enable once it is ready.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Export all account data</span> downloads a
        structured JSON snapshot of your archive, Investigations (cases), evidence, findings,
        approvals/judgments, Custodian run history metadata, decision-review state, and non-secret
        provider preferences. It never includes plaintext API keys, encryption wrapping keys, or
        service-role secrets.
      </p>
      <p className="text-sm text-muted-foreground">{ACCOUNT_EXPORT_LIMITATIONS.storageNote}</p>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Export restorable archive</span> is
        records-and-links only (schema version 1) and is what Import restore accepts.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onExportAll()}
          disabled={!online || exportingAccount}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exportingAccount ? "Exporting…" : "Export all account data"}
        </button>
        <button
          type="button"
          onClick={() => void onExportArchive()}
          disabled={!online || exportingArchive}
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exportingArchive ? "Exporting…" : "Export restorable archive"}
        </button>
        <label
          className={`inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)] ${
            archiveReady ? "cursor-pointer" : "cursor-not-allowed opacity-60"
          }`}
        >
          Import JSON backup
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            disabled={!archiveReady}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
      </div>

      {parseError ? (
        <Banner kind="error" title="Backup rejected">
          {parseError}. Nothing was imported.
        </Banner>
      ) : null}
      {pendingRestore ? (
        <div className="rounded-md border border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10 p-3 text-sm">
          <div className="font-medium text-foreground">
            Replace current archive with imported file?
          </div>
          <p className="mt-1 text-muted-foreground">
            This deletes every current record and link and installs the imported archive atomically.
            It is strongly recommended to Export restorable archive first. Investigations, Findings,
            Custodian history, and Storage files are not restored from this file.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Schema version</dt>
            <dd>{pendingRestore.counts.schemaVersion}</dd>
            <dt className="text-muted-foreground">Total records</dt>
            <dd>{pendingRestore.counts.totalRecords}</dd>
            <dt className="text-muted-foreground">Tools</dt>
            <dd>{pendingRestore.counts.tool}</dd>
            <dt className="text-muted-foreground">Repositories</dt>
            <dd>{pendingRestore.counts.repository}</dd>
            <dt className="text-muted-foreground">Conversations</dt>
            <dd>{pendingRestore.counts.conversation}</dd>
            <dt className="text-muted-foreground">Decisions</dt>
            <dd>{pendingRestore.counts.decision}</dd>
            <dt className="text-muted-foreground">Documents</dt>
            <dd>{pendingRestore.counts.document}</dd>
            <dt className="text-muted-foreground">Links</dt>
            <dd>{pendingRestore.counts.links}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onExportArchive()}
              disabled={!online || exportingArchive}
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download current archive first
            </button>
            <button
              type="button"
              onClick={onConfirmRestore}
              disabled={restore.isPending || !archiveReady}
              className="inline-flex min-h-11 items-center rounded-md bg-[color:var(--destructive)] px-3 py-2 text-sm font-medium text-[color:var(--destructive-foreground)] disabled:opacity-60"
            >
              {restore.isPending ? "Restoring…" : "Confirm replace"}
            </button>

            <button
              type="button"
              onClick={() => setPendingRestore(null)}
              className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function StorageSection() {
  return (
    <Card title="Storage and privacy">
      <p className="text-sm text-muted-foreground">
        Your archive is stored in your private Supabase database and synchronized across devices
        where you sign in.
      </p>
      <p className="text-sm text-muted-foreground">
        The archive is not public. Use Export all account data before leaving, and remember that
        uploaded document binaries live in private Storage and are not inside the JSON export.
      </p>
    </Card>
  );
}

function DestructiveSection({
  setToast,
  setError,
}: {
  setToast: (m: string) => void;
  setError: (m: string | null) => void;
}) {
  const reset = useResetArchive();
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Card title="Reset archive data" tone="destructive">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center rounded-md border border-destructive bg-card px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          Reset all archive data
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            This deletes every record and link owned by your account. It does not delete your login,
            Investigations, Custodian history, provider settings, or Storage uploads. Type{" "}
            <span className="font-mono">DELETE</span> to confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            placeholder="Type DELETE"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={confirmText !== "DELETE" || reset.isPending}
              onClick={async () => {
                try {
                  await reset.mutateAsync();
                  setOpen(false);
                  setConfirmText("");
                  setToast("Archive reset");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Reset failed.");
                }
              }}
              className="inline-flex min-h-11 items-center rounded-md bg-[color:var(--destructive)] px-3 py-2 text-sm font-medium text-[color:var(--destructive-foreground)] disabled:opacity-60"
            >
              {reset.isPending ? "Resetting…" : "Confirm reset"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
              }}
              className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DeleteAccountSection({
  online,
  setToast,
  setError,
}: {
  online: boolean;
  setToast: (m: string) => void;
  setError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exportingFirst, setExportingFirst] = useState(false);

  async function onExportFirst() {
    setError(null);
    setExportingFirst(true);
    try {
      const data = await exportAccountSnapshot();
      if (accountExportContainsSecretMaterial(data)) {
        setError("Account export aborted: unexpected secret-shaped material was detected.");
        return;
      }
      download(
        accountExportFilename(),
        JSON.stringify(data, null, 2),
        "application/json;charset=utf-8",
      );
      setToast("Full account export downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account export failed.");
    } finally {
      setExportingFirst(false);
    }
  }

  async function onConfirmDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteOwnerAccount(confirmText, password);
      await qc.cancelQueries();
      qc.removeQueries();
      await supabase.auth.signOut();
      setToast("Account deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account deletion failed.");
    } finally {
      setDeleting(false);
      setPassword("");
    }
  }

  return (
    <Card title="Delete account" tone="destructive">
      <p className="text-sm text-foreground">
        Permanently deletes your login, archive, Investigations, evidence, findings, approvals,
        Custodian runs, provider credentials and preferences, and uploaded document files in
        Storage. This cannot be undone. Export all account data first if you want a copy — the JSON
        still will not contain Storage binaries.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!online}
          className="inline-flex min-h-11 items-center rounded-md border border-destructive bg-card px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete account
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Type <span className="font-mono">{ACCOUNT_DELETE_CONFIRMATION}</span> and re-enter your
            password to confirm permanent deletion.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            placeholder={ACCOUNT_DELETE_CONFIRMATION}
            autoComplete="off"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            placeholder="Current password"
            autoComplete="current-password"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onExportFirst()}
              disabled={!online || exportingFirst || deleting}
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingFirst ? "Exporting…" : "Export all account data first"}
            </button>
            <button
              type="button"
              disabled={
                !online ||
                confirmText !== ACCOUNT_DELETE_CONFIRMATION ||
                password.length === 0 ||
                deleting ||
                exportingFirst
              }
              onClick={() => void onConfirmDelete()}
              className="inline-flex min-h-11 items-center rounded-md bg-[color:var(--destructive)] px-3 py-2 text-sm font-medium text-[color:var(--destructive-foreground)] disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Permanently delete account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
                setPassword("");
              }}
              disabled={deleting}
              className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DiagnosticsSection({
  email,
  meta,
  qCount,
  lCount,
}: {
  email: string | null;
  meta: null | {
    schema_version: number;
  };
  qCount: number | null;
  lCount: number | null;
}) {
  const host = useMemo(() => {
    try {
      return new URL(SUPABASE_URL).host;
    } catch {
      return SUPABASE_URL;
    }
  }, []);
  return (
    <Card title="Diagnostics">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Supabase host</dt>
        <dd className="font-mono">{host}</dd>
        <dt className="text-muted-foreground">Signed-in email</dt>
        <dd className="font-mono truncate">{email ?? "—"}</dd>
        <dt className="text-muted-foreground">Schema version</dt>
        <dd>{meta?.schema_version ?? "—"}</dd>
        <dt className="text-muted-foreground">Records loaded</dt>
        <dd>{qCount ?? "—"}</dd>
        <dt className="text-muted-foreground">Links loaded</dt>
        <dd>{lCount ?? "—"}</dd>
      </dl>
    </Card>
  );
}
