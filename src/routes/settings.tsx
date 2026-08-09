import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/lib/session";
import { useArchive, useAppMetadata, useResetArchive, useRestoreArchive } from "@/lib/archive";
import { PageHeader, Banner, Toast } from "@/components/page-parts";
import {
  backupFilename,
  buildBackup,
  download,
  validateBackup,
  type BackupCounts,
} from "@/lib/format";
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
        <BackupSection q={q} setToast={setToast} setError={setError} />
        <StorageSection />
        <DestructiveSection setToast={setToast} setError={setError} />
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-6">
      <h2 className="mb-3 font-serif text-lg text-foreground">{title}</h2>
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
                ? "text-sm text-[color:var(--destructive-foreground)]"
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
  setToast,
  setError,
}: {
  q: ReturnType<typeof useArchive>;
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

  // Backup is only safe to generate when the complete paginated archive
  // has loaded successfully. A pending or errored archive must not become
  // an empty "backup" on disk.
  const archiveReady = q.isSuccess && !!q.data;
  const archiveError = q.isError
    ? q.error instanceof Error
      ? q.error.message
      : String(q.error)
    : null;

  function onExport() {
    setError(null);
    if (!archiveReady || !q.data) {
      setError("Backup unavailable: the current archive has not finished loading.");
      return;
    }
    try {
      const data = buildBackup(q.data.records, q.data.links);
      // Validate the freshly built backup before offering it for download.
      const check = validateBackup(data);
      if (!check.ok) {
        setError(`Backup validation failed: ${check.error}`);
        return;
      }
      download(backupFilename(), JSON.stringify(data, null, 2), "application/json;charset=utf-8");
      setToast("Backup downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
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
          Backup and restore are disabled until the archive loads. {archiveError}
        </Banner>
      ) : null}
      {!archiveReady && !archiveError ? (
        <p className="text-sm text-muted-foreground">
          Loading the complete archive… Backup and restore will enable once it is ready.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={!archiveReady}
          className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Export JSON backup
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
            It is strongly recommended to Export JSON backup first.
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
              onClick={onExport}
              disabled={!archiveReady}
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download current backup first
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
        The archive is not public. Export JSON backups for independent recovery and portability.
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
    <Card title="Destructive action">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--destructive)]/60 px-3 py-2 text-sm text-[color:var(--destructive-foreground)] hover:bg-[color:var(--destructive)]/10"
        >
          Reset all data
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            This deletes every record and link owned by your account. Type{" "}
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
