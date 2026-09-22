# First real Custodian run — source readiness map

- **Status:** repository-local readiness map, not a production claim
- **Inspected against:** live repository source at the commit that lands this file
- **Does not authorize:** provider activation, secret changes, migration application, Edge deployment, Lovable publication, or a paid run

This map is the short first-run companion to [`custodian-program.md`](./custodian-program.md). The program remains the canonical product contract. This file answers only: what is complete in source for one bounded read-only analysis, what still needs live proof, and what must stay closed. M4D is implemented in source and is not activated.

Use the capability vocabulary from the program. Source inspection here is not evidence that migrations are applied, functions are deployed, Lovable is serving this commit, or a provider can be contacted.

## 1. Target first run

The first real Custodian run is one owner-scoped, read-only analysis:

```text
owner Case + bounded archive_scope
→ provider-free retrieval snapshot
→ at most one reserved synthesis attempt
→ attributable Finding or an explicit refusal / no-Finding
→ optional exact-action owner gate
→ verification of identity, usage, and no non-read-only tool event
→ quiet
```

It is not resident monitoring, Observatory, MCP run control, canonical archive mutation, or external execution. Approval still does not execute unsupported work. No internal V1 execution class is selected.

## 2. Source-complete map

| Slice | Source state | What exists | What this is not |
| ----- | ------------ | ----------- | ---------------- |
| Cases and bounded scope | **CURRENT** in `supabase/migrations/20260904090000_custodian_case_archive_scope.sql`, Cases UI, `src/lib/case-reading.ts` | Owner-created Case, 50-record / 10k-character scope, provider-free Case Reading | Not a model run. Production Case foundation is **UNVERIFIED**. |
| M2 Findings | **CURRENT** source in `20260920090000_custodian_finding_attribution.sql` | Analysis Findings require a completed `synthesize` step, structured candidate, same-owner evidence, and `custodian_materialize_finding`. Generic briefs fail closed. | Database application and deployed materialization are **UNVERIFIED**. |
| M3 owner gate | **CURRENT** source in `20260921140000_custodian_owner_gate.sql` and Approvals | Exact-action inspect-and-decide through `custodian_respond_approval` with required `expected_action_hash` | Approval does not execute. Internal V1 execution class is **UNRESOLVED**. |
| M4A budget hold | **CURRENT** source in `20260921180000_custodian_provider_budget_hold.sql` | Hold storage separate from factual usage; owner reserve; service-role settle; explicit policy bootstrap; server-built read-only snapshot | Not a provider call. Remote application is **UNVERIFIED**. |
| M4B synthesis wiring | **PRESENT, UNREACHABLE** in `supabase/functions/custodian-run/provider-attempt.ts` | One attempt identity `provider-attempt:<run id>:synthesize`; reserve first; at most one Responses fetch; truthful settlement; M2 materialization; M4 verification | `handleRequest` does not enter this path while `PROVIDER_EXECUTION_UNSUPPORTED` is `true`. |
| M4C Run Room | **PRESENT, CLOSED** | Read-only listing; recorded cost, hold, unknown usage, and pricing version are distinct. Start analysis stays disabled while the browser gate is false and does not call policy RPCs or the Edge Function. | Browser constant `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER` is `false`. The enabled start path exists only behind that constant. |
| MCP | **CURRENT** readers / **BLOCKED** controls | `list_cases`, `get_case`, `get_findings`, `get_pending_approvals`, `get_run` project when foundations exist. `start_analysis` and `cancel_run` authenticate then return `RUNTIME_UNAVAILABLE` with no write. | Live OAuth callability is **UNVERIFIED**. |
| M4D activation | **IMPLEMENTED IN SOURCE, NOT ACTIVATED** | Readonly start contract and bounded driver exist. The browser drives `queued`, `retrieving`, `synthesizing`, and `verifying` only. `executing` is not driven. Ambiguous Edge results are reconciled from the persisted run and are not retried. Keys rotate only after a resolved hold (`settled_known` + known usage, or `released_uncontacted` + usage none) on a stop status. Gates remain closed. | Production activation is not done. Secrets and pricing are not configured. The first paid run is not done. Deployed concurrency proof is pending. Invocation keys stay in memory for one tab. The second-start guard sees only the loaded Run Room list: newest 100 owner runs (`CUSTODIAN_RUN_READ_LIMIT`), same tab, same case. A missing hold is not certainty. An uncertain run outside those 100 rows, or only in another tab, is not seen. No cross-tab dedup. M5 is not done. |

Closed gates that remain successful safety states:

- `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER = false` in `src/lib/custodian-runtime.ts`
- `PROVIDER_EXECUTION_UNSUPPORTED = true` in `supabase/functions/custodian-run/index.ts`
- No environment value bypasses either constant
- Prepared invocation body is only `{ runId, invocationKey }`
- MCP run controls never fake a start or cancel

## 3. What still requires live proof

These are not source bugs. They are missing operational evidence.

| Remaining class | Why it still blocks a real run | Authoritative proof |
| --------------- | ------------------------------ | ------------------- |
| Production migration verification | M2, M3, and M4A contracts exist only as files until applied. Cases, Findings, Approvals, holds, and readonly-run RPCs are unusable until the remote ledger matches. | `supabase migration list` against the directly managed project, plus the RLS/grant checks in [`supabase-verification.md`](./supabase-verification.md). CI does not apply migrations. |
| Edge deployment verification | Closed-gate `custodian-run` source is not proof that the deployed function is this SHA, JWT-verified, and still gated. | Authorized `supabase functions deploy custodian-run` evidence tied to the commit, `verify_jwt = true`, and a signed-in call that blocks synthesis without contacting a provider. |
| Lovable / runtime verification | Browser surfaces can be source-correct and still serve an older bundle, missing table, or unavailable hold relation. | Authenticated production/preview proof of Cases, Case Reading, Findings, Approvals, and inert Run Room on the published commit. A green build is not that proof. |
| Owner model / pricing policy | `custodian_ensure_readonly_analysis_policy` has no product-default tiers or ceilings. `selectRuntimeModel` rejects an omitted allowlist. Missing or invalid `CUSTODIAN_MODEL_PRICING_JSON` blocks before fetch. | Owner-chosen `allowed_model_tiers` and numeric per-run / daily / monthly token and cost ceilings, plus a server-only versioned pricing secret. Do not print values. |
| Concurrency / idempotency proof | Source tests cover duplicate invocation keys, shared approval identity, and held/settled/released replay. They are in-process fixtures, not two-way deployed races. | Deployed proof that two concurrent invocations of the same run reuse `provider-attempt:<run id>:synthesize` and cannot spend the same remaining budget twice. Required before any paid owner run. |
| M4D activation | Source now contains the truthful start path and bounded driver. The two hard gates remain closed. Secrets and pricing are not configured. Deployed concurrency proof, production activation, the first paid run, and M5 are not done. | A separate activation authorization. This file does not open either gate. |

Local database runtime validation remains **UNVERIFIED** in environments without Docker / `supabase test db`. Hosted CI job `database` is the repository's pgTAP runner; a green hosted job still does not replace production verification.

## 4. Exact blockers before M4D activation

M4D source is implemented. Activation must not start while any of these remain open:

1. Remote history does not yet prove that `20260920090000_custodian_finding_attribution.sql`, `20260921140000_custodian_owner_gate.sql`, and `20260921180000_custodian_provider_budget_hold.sql` are applied.
2. Deployed `custodian-run` is not proven to be the inspected closed-gate source, with `PROVIDER_EXECUTION_UNSUPPORTED` still true.
3. Authenticated UI proof is missing that Run Room cannot start analysis and that Cases / Findings / Approvals tell the truth when the foundation is present or absent.
4. Owner has not chosen explicit model tiers and numeric ceilings. Source must not invent defaults.
5. Server-only pricing configuration is not proven to exist as a secret. Absence is a correct fail-closed outcome, not a reason to hard-code rates.

CI success, this document, and a merged M4B/M4C source slice are not M4D authorization.

## 5. Exact blockers before the first paid run

Everything in section 4, plus:

1. M4D source is implemented and the provider gates remain closed. Write-capable work stays behind the owner gate. Activation is still a separate authorization.
2. The deployed function is proven to reserve before any Responses call and to settle known, unknown, or uncontacted outcomes truthfully.
3. Deployed two-way concurrency and idempotency proof exists for the stable attempt key.
4. `OPENAI_API_KEY` and `CUSTODIAN_MODEL_PRICING_JSON` are configured as Edge secrets only.
5. The first paid run has its own explicit authorization. Opening a gate is not that authorization.
6. No MCP `start_analysis` path is treated as a trigger. It remains `RUNTIME_UNAVAILABLE` until a later reviewed change says otherwise.

A closed-gate retrieval that advances `queued → retrieving → synthesizing → blocked` is not a paid run. It must perform zero reserves and zero provider fetches.

## 6. Operator path — no GitHub deploy workflow

`.github/workflows/deploy-supabase.yml` was removed. Hosted [`Validate application`](../.github/workflows/ci.yml) validates frontend, Edge, and local pgTAP. It does not link the project, push migrations, or deploy functions.

After the one-time remote history repair in [`supabase-setup.md`](./supabase-setup.md), an authorized operator applies schema and functions explicitly:

```text
supabase migration list
supabase db push --dry-run
supabase db push
supabase functions deploy custodian-run
```

Retain the outputs. They must contain no secrets. Do not treat a GitHub repository variable as a substitute for that evidence.

## 7. Smallest next implementation task

M4D is implemented in source. The gates are still closed. Production activation is not done. Secrets and pricing are not configured. The first paid run is not done. Deployed concurrency proof is pending. M5 is not done.

The next dangerous boundary is activation: opening the two provider constants, configuring secrets and owner pricing, and proving the deployed race. This file does not authorize that boundary.
