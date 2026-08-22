# Release verification

This is the reusable release gate for The Excavatorium. It is a procedure, not
a snapshot of one release. Record volatile evidence in the pull request or
phase report; do not copy private archive contents, record titles, counts,
credentials, or dated service state into this document.

Related references:

- [Repository overview](../README.md)
- [Lovable project knowledge](./lovable-project-knowledge.md)
- [Supabase setup](./supabase-setup.md)
- [Supabase verification checklist](./supabase-verification.md)
- [Light archive shell](./design/light-archive-shell.md)
- [Custodian roadmap](./design/custodian-roadmap.md)

## Evidence rules

- Treat source, local checks, hosted CI, Lovable, Supabase, connectors, and the
  production browser as separate evidence surfaces.
- Configuration is not operational proof. Inspect the live service state.
- Tie every hosted and production claim to an exact Git commit.
- Use `Verified`, `Failed`, `Blocked`, or `Not checked`. Do not turn a skipped
  check into a pass.
- Preserve unrelated work. Stage exact paths and never rewrite published Git
  history.

## 1. Repository preflight

Inspect before pulling, editing, merging, or deleting a branch:

```powershell
git status --short --branch
git branch --show-current
git rev-parse HEAD
git fetch --prune origin
git rev-list --left-right --count main...origin/main
git diff --check
```

Before release proof, require:

- the intended commit is on `main`;
- local `main` and `origin/main` have the same SHA and `0 0` divergence;
- the tracked worktree is clean;
- unrelated untracked files remain untouched;
- every branch selected for deletion is first proven to be an ancestor of
  `main` with `git merge-base --is-ancestor`.

## 2. Local validation

Inspect `package.json` and the workflows before running commands. The standard
frontend gate is:

```powershell
bun install --frozen-lockfile
bun test src
bun run lint
bun run typecheck
bun run build
git diff --check
```

Report the test totals and distinguish lint warnings from errors. The hosted
[`Validate application`](../.github/workflows/ci.yml) workflow runs the
frontend suite, lint, frontend typecheck, Deno Edge Function checks and
guardrail tests, the production build, and pgTAP database tests against a
fresh local Supabase stack. A green hosted job still does not replace direct
production verification.

## 3. GitHub and Lovable

For the pull request and resulting merge commit:

1. Inspect the complete diff and review it for scope, regressions, privacy, and
   security boundaries.
2. Require a normal, non-history-rewriting merge and a successful hosted job
   whose `headSha` is the exact merge commit.
3. Confirm Lovable reports that same commit as ready.
4. Publish explicitly when the public site still serves an older bundle.
5. Verify the public bundle changed to the release build; `is_published: true`
   alone may describe an earlier production publication.
6. Run authenticated production checks on the public URL, not only the Lovable
   preview or screenshot.

If publication fails, stop. Do not retry blindly or describe a ready preview as
successful production deployment.

## 4. Supabase

This repository uses one directly managed Supabase project. Do not create a
replacement Lovable backend or a second data store.

Before a database-affecting release:

```text
supabase migration list
supabase db push --dry-run
```

Require aligned local and remote migration history, an empty reviewed dry run
when no schema change is expected, and retained output that contains no
secrets. Follow the one-time reconciliation rules in
[Supabase setup](./supabase-setup.md); `migration repair` changes history
bookkeeping and must never hide a missing schema change.

The guarded [`Deploy Supabase`](../.github/workflows/deploy-supabase.yml)
workflow may run only after its reconciliation variable is enabled. Verify that
it checked out the exact validated SHA, applied only expected migrations, and
deployed the intended authenticated Edge Functions. Use the detailed
[Supabase verification checklist](./supabase-verification.md) for RLS, grants,
safe function paths, RPC ownership checks, and second-user isolation.

## 5. Provider and cost boundary

Unless a separately approved provider-activation phase has completed, verify:

- [`CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER`](../src/lib/custodian-runtime.ts)
  remains `false`;
- [`PROVIDER_EXECUTION_UNSUPPORTED`](../supabase/functions/custodian-run/index.ts)
  remains `true`;
- no paid model call is presented as available;
- no direct archive write bypasses owner-scoped RPC and approval boundaries.

Provider activation remains blocked until tool policy is mandatory and
non-null, per-run and cumulative budgets are enforced, allowed model tiers are
explicit, concurrent provider calls reserve budget per run, retries are
idempotent, write-capable operations pause for approval, and safe resume and
audit evidence are verified.

## 6. Connector and owner isolation

In a fresh authenticated task:

1. Confirm the installed Excavatorium connector exposes the reviewed tool
   surface.
2. Run one bounded, read-only archive operation.
3. Report only the success or failure shape; do not paste private records or
   counts into release notes.
4. Verify unauthenticated access fails safely.
5. Verify owner isolation with a second test account when available. If it is
   unavailable, mark that check `Not checked` rather than inferring isolation
   from configuration.

## 7. Production browser proof

Use an authenticated owner session against the public production URL.

Desktop checks:

- the visible command trigger and `Ctrl+K` or `Cmd+K` each open exactly one
  dialog;
- the dialog has an accessible title and description;
- Escape restores focus to the visible trigger;
- route, creation, and persisted-record commands navigate without accidental
  submission;
- Inbox offers only Thought, Link, Conversation, and Document;
- blank capture cannot enter Review or save;
- Capture -> Review -> Back preserves the local draft;
- `Save to Inbox` is the only persistence action and requires action-time
  confirmation for a production proof record;
- one save increments the count once, clears the form, and displays the saved
  item without promotion, edit, or deletion.

Repeat the responsive checks at a genuine narrow viewport such as `390 x 844`:

- no horizontal overflow;
- all visible first-party controls are at least 44 by 44 CSS pixels;
- focus is visible;
- the five-slot bottom navigation and safe-area padding remain usable;
- Capture -> Review -> Back works without a second save;
- command and capture controls remain operable.

Check relevant console errors after the interactions. Do not simulate a
destructive or expensive failure merely to satisfy a checklist; use focused
automated tests for failure preservation where appropriate.

## 8. Verdict and rollback

Publish a phase report containing the objective, exact commit, checks run,
changed files, security and data implications, warnings, failed or skipped
checks, diff status, and the next approval boundary.

The release is green only when every required surface is `Verified`. If a live
check fails, diagnose the confirmed cause on a new reviewable `codex/` branch.
Rollback uses a new revert or fix commit followed by normal validation and
publication. Never rebase, amend, force-push, or otherwise rewrite published
history.
