# Public readiness: signup, empty accounts, and bring-your-own OpenAI key

Status: **source implemented on a local branch; nothing here is deployed, applied,
or configured in any hosted project.** Every hosted setting below is
**UNVERIFIED** until someone reads it from the live Supabase dashboard.

Product rule: **The Excavatorium is free to use as an archive. Provider-backed
Custodian work runs on the owner's own OpenAI API key.** Registering, signing
in, browsing, searching, capturing, linking, and exporting never need a key.

> The Archive remembers. The Custodian examines. The Owner decides.

## 1. Account lifecycle

| Capability                     | Where                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Sign up / sign in / magic link | `src/components/login-screen.tsx`                                                               |
| Forgot / reset password        | `login-screen.tsx` (request), `reset-password-screen.tsx` (set)                                 |
| Session restore, sign-out      | `src/lib/session.ts`, `src/components/auth-gate.tsx` (unchanged behavior; adds a recovery flag) |
| Neutral copy                   | `src/lib/auth-messages.ts`                                                                      |

Behavior worth knowing:

- **No account enumeration.** Sign-in failures always read "Email or password is
  incorrect." An already-registered address on sign-up produces the same notice a
  successful confirmation-required sign-up shows. Forgot-password and magic-link
  always answer "If an account exists…". Only weak password, rate limiting, a
  closed signup, and a malformed address are stated.
- **Recovery is same-browser.** The client uses PKCE. `resetPasswordForEmail`
  stores a code verifier in the requesting browser, so the reset link must be
  opened in the browser that asked for it. Opening it elsewhere fails the code
  exchange and the owner requests a new link.
- **Magic link never creates accounts** (`shouldCreateUser: false`). Sign-up is
  the only creation path.
- **No social login, teams, sharing, billing, or subscriptions.**

### Hosted Auth settings to verify or set before opening signup (UNVERIFIED)

Source cannot prove these. `supabase/config.toml` has no `[auth]` section, so the
hosted project's values are whatever the dashboard holds.

| Setting                    | Required value / decision                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allow new users to sign up | **On** (only when release is authorized)                                                                                                                                                                                                       |
| Confirm email              | Decide. **Recommended: On.** If off, an existing address returns an error and the client hides it; if on, Supabase returns an obfuscated success.                                                                                              |
| Site URL                   | The production origin (currently `https://the-excavatorium.lovable.app` unless a custom domain is attached)                                                                                                                                    |
| Redirect URLs              | Production origin and `origin/**`; the Lovable preview origin if previews must sign in; `http://localhost:8080` for development. The client redirects to `window.location.origin` for confirmation, reset, and magic link.                     |
| Reset-password redirect    | Same origin allow-list entry as above (no dedicated route)                                                                                                                                                                                     |
| Email templates            | Confirm-signup and reset templates use `{{ .ConfirmationURL }}`                                                                                                                                                                                |
| SMTP                       | **Custom SMTP.** The built-in sender is heavily rate-limited and not for public use. Set SPF/DKIM on the sending domain.                                                                                                                       |
| Auth rate limits           | Review email, sign-in, sign-up, and token-refresh limits against expected traffic                                                                                                                                                              |
| Bot protection             | Enable CAPTCHA (Turnstile or hCaptcha) on sign-up and password recovery for a public launch. **The client does not yet send a captcha token**; enabling it in the dashboard without adding that to `login-screen.tsx` will block all sign-ups. |
| Password policy            | Minimum length ≥ 8 (client enforces 8); consider leaked-password protection if the plan supports it                                                                                                                                            |
| Anonymous sign-ins         | **Off**                                                                                                                                                                                                                                        |
| Other providers            | Leave social/SSO providers off; none are wired                                                                                                                                                                                                 |
| OTP / link expiry          | Keep defaults or shorter                                                                                                                                                                                                                       |

## 2. New accounts are empty

Migration `20260924100000_public_signup_empty_archive.sql` (new; historical
migrations `…0300` and `…0600` are unchanged):

- `handle_new_auth_user` now also creates `app_metadata` already marked
  initialized, so no seed step ever runs for a new owner.
- `initialize_user_archive` never installs records; it creates or repairs
  metadata only.
- `install_canonical_seeds` is a no-op; `restore_missing_examples` returns
  `{insertedRecords: 0, insertedLinks: 0, status: "examples_unavailable"}`. The
  retired bodies installed 13 example rows and nine links, including
  `projectRoute: The Forge`.
- **Nothing existing is modified.** No backfill, rename, cleanup, or deletion.
  Rows an owner already holds (including `is_example = true`) keep their IDs,
  links, revisions, titles, tags, and data. `remove_example_data`,
  `reset_user_archive`, `restore_user_archive`, and the approved-`seed_key`
  constraint are untouched so an owner can still remove their examples and
  restore their own JSON backups.
- No frontend caller invoked `useInitializeArchive` or `useRestoreExamples`
  before this change; they remain as inert hooks.
- Optional demo data, if ever wanted, must be a new, explicit, neutral opt-in
  function.

Private-name audit (backend scope): the only automatic path that installed
owner-specific content was the seed helper above. Fixed Home "working sets"
(The Forge / The Chamber / The Book in `src/routes/index.tsx`) are the parallel
UI branch's responsibility and were not touched here.

## 3. Bring-your-own OpenAI key

### Architecture

Chosen: an application-layer envelope, because nothing in the repository uses
Supabase Vault and its availability, grants, and per-owner isolation on the hosted
project could not be verified from source. If Vault is later confirmed suitable,
`custodian_store_provider_credential` / `custodian_get_provider_credential` are
the only two functions that would change.

```
browser --(key, TLS, once)--> provider-key Edge Function (JWT verified)
                                 | AES-256-GCM, fresh nonce,
                                 | AAD = provider + owner id + key version
                                 v
                        service-role RPC: ciphertext + last4 + version
                                 v
                 owner_provider_credentials  (RLS on, no grants to any role)

custodian-run (authenticated owner) --> service-role RPC --> ciphertext
       --> decrypt in memory with the Edge secret --> OpenAI request --> discard
```

- Wrapping keys live only in Edge secrets (below). The database holds no
  wrapping key and no plaintext.
- `owner_provider_credentials` has RLS enabled, **no policies, and no privileges
  for anon, authenticated, or service_role**. Only two `SECURITY DEFINER`
  functions touch it, both executable only by `service_role`.
- The browser can learn only `{configured, last4, key_version, updated_at}` via
  `custodian_provider_key_status()`. Nothing returns the key or the ciphertext.
- AES-GCM associated data binds a ciphertext to its owner and key version. A
  ciphertext copied to another owner's row fails authentication.
- The key is never logged, stored in the browser (no local/session storage,
  IndexedDB, query cache, or mutation state), placed in `record_data`, included in
  audit payloads or JSON backups, or written to a public environment variable.
- **Saving a key never contacts OpenAI.** No "Test key" action is implemented; if
  one is added it must be explicit, bounded, and labelled as contacting OpenAI.

### Secrets to set before deploying `provider-key` (authorization required)

```sh
# 32 random bytes, base64. Generate once; keep it out of the repository.
openssl rand -base64 32

supabase secrets set PROVIDER_KEY_ENCRYPTION_KEYS='{"1":"<base64-32-bytes>"}'
supabase secrets set PROVIDER_KEY_ACTIVE_VERSION=1
```

Rotation: add `"2": "<new>"` to the JSON map, set `PROVIDER_KEY_ACTIVE_VERSION=2`.
Old versions must stay in the map until every stored ciphertext is re-saved.
Losing a version makes those owners' keys unreadable (they see "replace it in
Settings"); it never exposes them.

`CUSTODIAN_MODEL_PRICING_JSON` must contain an entry for every model an owner may
choose (see §4). A model without a price stops the run before contact
(`model_pricing_invalid`), exactly as before.

### Runtime behavior (`custodian-run`)

- The server-wide `OPENAI_API_KEY` is **no longer read** by `custodian-run`. There
  is no fallback to it.
- Order before any reservation: authorization and gate → tool policy → tier
  allowed → owner model choice → pricing → system prompt → owner key. Any
  failure stops the run with a distinct code and **no reservation, no provider
  request, and no accounting**:
  `model_not_selected`, `model_selection_invalid`, `model_tier_mismatch`,
  `model_preference_unavailable`, `provider_key_not_configured`,
  `provider_key_unreadable`.
- Unchanged invariants: owner-scoped authorization, provider-free retrieval,
  reservation before contact, at most one provider request per attempt, zero SDK
  retries, no automatic retry after ambiguous contact, `store: false`, timeout
  boundary, structured-synthesis validation, Finding attribution, exact
  provider/model attribution, known vs unknown usage, held vs actual, protected
  Finding materialization, approval/action-hash contracts, bounded diagnostics.
- The key lookup is keyed only by the JWT-derived owner id; the ciphertext is also
  cryptographically bound to that owner. One owner's run cannot use another's key.

### Accounting under BYOK (deliberately unchanged)

The owner pays OpenAI directly. Token usage and model attribution are still
recorded per run. The existing per-run, daily, and monthly **holds and ceilings
are kept as application-side, owner-visible budgeting**: they now protect the
owner from their own runaway spend rather than the operator. A hold is **not**
provider spend; actual usage is recorded only when the provider reports it, and
unknown stays unknown. No accounting semantics or schema were changed. If the
product later wants operator-independent budgets (or none), that is a separate,
migration-backed decision: do not delete the machinery to make it disappear.

## 4. Model choice

Six IDs, one central list per layer:

| Model           | Policy tier | UX tone   |
| --------------- | ----------- | --------- |
| `gpt-5.6-luna`  | luna        | efficient |
| `gpt-5.6-terra` | terra       | balanced  |
| `gpt-5.6-sol`   | sol         | strong    |
| `gpt-6-luna`    | luna        | efficient |
| `gpt-6-sol`     | sol         | strong    |
| `gpt-6-astra`   | pro         | highest   |

- Edit `supabase/functions/_shared/openai-models.ts`, `src/lib/openai-models.ts`,
  and `public.custodian_openai_model_tier()` (new migration). A Bun test fails if
  the TypeScript copies or the SQL function disagree, and if any other source file
  hard-codes a model ID.
- The **tier** remains the identity used by tool policies, runs, and steps; their
  CHECK constraints are unchanged. The **exact model name** is recorded on the
  provider reservation, so attribution stays exact. `gpt-5.6-pro` is retired for
  new reservations (historical rows stay valid).
- The choice is owner-scoped (`owner_provider_settings`, RLS select-own, writes
  only through `custodian_set_model_preference`).
- **A run's tier must equal the tier of the owner's chosen model** or it stops
  with `model_tier_mismatch`. There is no substitution and no fallback to another
  paid model. Provider 4xx / permission / model-unavailable responses are
  classified by the existing diagnostics; choosing a model does not prove the
  owner's OpenAI project can use it.
- Open UX: the Run Room's technical `model_tier` field defaults from the owner's
  chosen model's policy tier (via `custodian_openai_model_tier` / catalog mirror).
  Advanced may still override; the server still rejects `model_tier_mismatch`.

## 5. Other AI extraction: owner BYOK (decision a)

**Conversation Excavation (`conversation-extract`) and File/Document Excavation
(`document-extract`) use the authenticated owner's encrypted OpenAI key and
Settings model preference.** They share the Custodian credential decrypt path
(`resolveOwnerProviderKey` / `custodian_get_provider_credential`). There is no
operator `OPENAI_API_KEY` fallback on those production paths. Missing key or
model fails closed with a clear Settings-directed message before any provider
contact. Requests use `store: false`. Secrets never appear in logs, errors, or
drafts.

Hosted activation still **REQUIRES PRODUCTION ACTION**: BYOK migrations, wrapping
key secrets, and Edge deploys for `provider-key` plus the updated extract
functions. See §8.

## 6. Data export and deletion scope

**What the JSON backup contains** (`export_user_archive_snapshot` →
`buildBackup`): archive records and the links between them. Uploaded document
files are detached (`storagePath`, `extractedContentPath`, `contentHash` are
nulled).

**What it does not contain:** private Storage objects (`document-files`),
Investigations/cases, evidence, claims, Findings, approvals and proposals,
Custodian runs, steps, reservations and diagnostics, inbox items, record
revisions, audit events, and provider credentials or preferences. Settings now
says so.

**Account deletion is not implemented, and no owner-delete RPC exists.**
`reset_user_archive` only empties records and links. To ship real deletion:

1. A server-side flow (Edge Function, service role, re-authenticated owner) that
   removes the owner's `document-files/<user_id>/` Storage objects, since Storage
   does not cascade from `auth.users`.
2. Then `auth.admin.deleteUser`. 37 owner references cascade; 19
   `created_by`/`updated_by` references are `NO ACTION`. They point at rows that
   the owner cascade also deletes, so this should work, but it **must be tested**
   on a populated account before relying on it.
3. Also purge or anonymize anything not keyed by `auth.users` (none found), and
   define the retention statement for OpenAI's own logs (out of our control).
4. Offer a full export first, which needs the export to grow to cover the data in
   the previous list.

## 7. Cross-owner isolation: what is proven and what is not

Local pgTAP now proves, for the new structures:

- the ciphertext table is unreachable from anon, authenticated, and service_role
  directly; only the two service-role functions read or write it;
- owner A cannot read or overwrite owner B's credential status, events, or model
  preference; B's removal leaves A's key intact;
- values shaped like a plaintext key are rejected by the table;
- the reservation accepts only catalog models in the run's tier;
- a new signup has no records or links, and lifecycle RPCs add nothing or alter
  nothing for an existing owner.

Deno tests prove: ciphertext bound to owner and version, tamper resistance, no key
in responses or errors, lookup keyed only by the authenticated owner, and no
server-key fallback.

**Not proven, and not to be claimed until done with two real accounts on a
hosted or staging project:** RLS and grants across all 33 pre-existing public
tables, `SECURITY DEFINER` RPC boundaries, Storage bucket policies and path
ownership, MCP/OAuth client scoping, Edge Function authorization end to end, and
the actual Auth dashboard behavior.

## 8. Release-time checklist (each item needs explicit authorization)

- [ ] Reconcile migration `20260923113236` (applied) with source
      `20260923120000_custodian_provider_diagnostics.sql` before applying new ones;
      new migrations sort after both.
- [ ] Apply migrations `20260924100000`, `…110000`, `…120000` (staging first).
- [ ] Set `PROVIDER_KEY_ENCRYPTION_KEYS`, `PROVIDER_KEY_ACTIVE_VERSION`, and
      `CUSTODIAN_MODEL_PRICING_JSON` (six models) as Edge secrets.
- [ ] Deploy `provider-key` and the updated `custodian-run` (JWT verification on).
- [ ] Verify and set hosted Auth settings (§1).
- [ ] Two-account isolation run on staging (§7).
- [ ] Decide account deletion and expanded export (§6).
- [ ] Lovable publication and release.
