# First real Custodian run — source readiness map

- **Status:** repository-local readiness map, not a production claim
- **Inspected against:** live repository source at the commit that lands this file
- **Does not authorize:** provider activation, secret changes, migration application, Edge deployment, Lovable publication, or a paid run

This map is the short first-run companion to [`custodian-program.md`](./custodian-program.md). The program remains the canonical product contract. This file answers only: what is complete in source for one bounded read-only analysis, what still needs live proof, and what must stay closed. M4D is implemented in source, and both provider source gates are open (section 2). No deployed run has yet completed.

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
| M4B synthesis wiring | **CURRENT, SOURCE GATE OPEN** in `supabase/functions/custodian-run/provider-attempt.ts` | One attempt identity `provider-attempt:<run id>:synthesize`; reserve first; at most one Responses request through the official OpenAI SDK (section 5); truthful settlement; M2 materialization; M4 verification | Deployed behavior is proven only up to a provider rejection (section 6). No deployed synthesis has completed. |
| M4C Run Room | **CURRENT, SOURCE GATE OPEN** | Owner listing; recorded cost, hold, unknown usage, and pricing version are distinct. Start analysis sends explicit owner inputs through the readonly policy and run RPCs. A run with a provider attempt shows safe provider metadata behind **Technical details**. | The browser sends only `{ runId, invocationKey }` to the Edge Function. It never writes runtime, reservation, or diagnostic tables. |
| MCP | **CURRENT** readers / **BLOCKED** controls | `list_cases`, `get_case`, `get_findings`, `get_pending_approvals`, `get_run` project when foundations exist. `start_analysis` and `cancel_run` authenticate then return `RUNTIME_UNAVAILABLE` with no write. | Live OAuth callability is **UNVERIFIED**. |
| M4D activation | **IMPLEMENTED, SOURCE GATES OPEN** | Readonly start contract and bounded driver exist. The browser drives `queued`, `retrieving`, `synthesizing`, and `verifying` only. `executing` is not driven. Ambiguous Edge results are reconciled from the persisted run and are not retried. Keys rotate after a resolved hold (`settled_known` + known usage, or `released_uncontacted` + usage none) on a stop status, and after a `blocked`, `budget_stopped`, or `cancelled` row whose reservation read succeeded and found no reservation. An unavailable projection stays indeterminate and is not retried. A `completed` row with an unexpected missing reservation does not rotate unless the hold proves no provider contact. | No deployed run has completed (section 6). Deployed concurrency proof is pending. Invocation keys stay in memory for one tab. The second-start guard sees only the loaded Run Room list: newest 100 owner runs (`CUSTODIAN_RUN_READ_LIMIT`), same tab, same case. An unreadable hold is not certainty. An uncertain run outside those 100 rows, or only in another tab, is not seen. No cross-tab dedup. M5 is not done. |

Source gate state and invariants that still hold:

- `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER = true` in `src/lib/custodian-runtime.ts` (opened by `07868f8`)
- `PROVIDER_EXECUTION_UNSUPPORTED = false` in `supabase/functions/custodian-run/index.ts` (opened by `8531331`)
- No environment value bypasses either constant
- Prepared invocation body is only `{ runId, invocationKey }`
- The server owns provider authority, reservation, settlement, and diagnostics
- MCP run controls never fake a start or cancel; `start_analysis` and `cancel_run` stay unavailable

## 3. What still requires live proof

These are not source bugs. They are missing operational evidence.

| Remaining class | Why it still blocks a completed run | Authoritative proof |
| --------------- | ----------------------------------- | ------------------- |
| Diagnostics migration | `20260923120000_custodian_provider_diagnostics.sql` exists only as a file until applied. Until then the Edge runtime still attempts the diagnostic write; it fails, is ignored without changing accounting, and Run Room shows no technical details. | `supabase migration list` against the directly managed project, then the RLS/grant checks in [`supabase-verification.md`](./supabase-verification.md). CI does not apply migrations. |
| Edge deployment verification | The deployed `custodian-run` predates the official SDK transport and the repaired synthesis contract. | Authorized `supabase functions deploy custodian-run` evidence tied to the merged commit and `verify_jwt = true`. |
| Lovable / runtime verification | Browser surfaces can be source-correct and still serve an older bundle. | Authenticated proof that Run Room serves the merged commit, including **Technical details** on a failed run. A green build is not that proof. |
| A completed bounded run | Both production runs so far failed at the provider boundary (section 6). M4 proof is incomplete until a fresh deployed run completes, settles known usage, and passes M4 verification. | One brand-new, owner-authorized, bounded Luna run on the deployed commit. |
| Concurrency / idempotency proof | Source tests cover duplicate invocation keys, racing invocations, shared approval identity, and held/settled/released replay. They are in-process fixtures, not two-way deployed races. | Deployed proof that two concurrent invocations of the same run reuse `provider-attempt:<run id>:synthesize` and cannot spend the same remaining budget twice. |

Local database runtime validation needs Docker and `supabase test db`. Hosted CI job `database` is the repository's pgTAP runner; a green hosted job still does not replace production verification.

## 4. Operator path — no GitHub deploy workflow

`.github/workflows/deploy-supabase.yml` was removed. Hosted [`Validate application`](../.github/workflows/ci.yml) validates frontend, Edge, and local pgTAP. It does not link the project, push migrations, or deploy functions.

After the one-time remote history repair in [`supabase-setup.md`](./supabase-setup.md), an authorized operator applies schema and functions explicitly:

```text
supabase migration list
supabase db push --dry-run
supabase db push
supabase functions deploy custodian-run
```

Retain the outputs. They must contain no secrets. Do not treat a GitHub repository variable as a substitute for that evidence.

## 5. Provider transport and diagnostics (source)

- **Transport.** The official OpenAI JavaScript SDK (`npm:openai@7.20.0`, Edge-only; the frontend bundle does not include it) owns the Responses request in `supabase/functions/custodian-run/openai-provider.ts`. `provider-attempt.ts` keeps reservation, idempotency, cancellation, settlement, and authority.
- **One request per attempt.** The SDK client is created with `maxRetries: 0`, and the injected transport refuses a second fetch before it reaches the network. It also refuses, before the network, any request whose headers differ from the SDK defaults plus the expected key; a request that fails or is refused before the network is released as uncontacted (`provider_request_not_sent`). The deadline covers headers and body. The raw response body is parsed by the runtime, so a malformed output array still leaves its usage readable. Base URL, organization, project, admin key, and logging are explicit, so no ambient environment variable redirects the request, adds a credential, or turns on logging. The SDK still reads `OPENAI_CUSTOM_HEADERS`; if it changes the request headers, the request is refused as above. Do not set it on the function.
- **`store: false`** is set on every synthesis request.
- **Schema.** Zod (`npm:zod@3.25.76`, v4 API) in `openai-schema.ts` is the single source of the synthesis contract. The official `zodTextFormat` helper generates the strict Structured Outputs format; the same schema validates the output before any Finding or approval. The call uses `responses.create` rather than `responses.parse`, because parse throws on schema-invalid output and would lose the usage needed for truthful accounting.
- **Schema repair.** The hand-written schema declared `proposedDiff` and `toolAction` as objects with no properties. Those objects could only ever be `{}`, and property-less objects are outside the documented Structured Outputs subset. They were removed from the provider contract. An approval created from a synthesis still records `proposed_diff = {}` and `tool_action = {}`, which is exactly what the old contract could produce. String length bounds are enforced locally instead of being sent as `maxLength`, which is not in the documented strict-mode keyword list. A test fails if a property-less object, record, omitted field, unsupported keyword, or action field appears in the generated format.
- **Diagnostics.** After a provider exchange has been settled, the service-role runtime records one row per attempt in `agent_provider_diagnostics` through `custodian_record_provider_diagnostic`. Retained: provider, contact state, classification, HTTP status, OpenAI request id, `error.type`, `error.code`, `error.param`, and `incomplete_details.reason`, each allowlisted and bounded; an invalid value is stored as null. Not retained: `error.message`, request or response bodies, headers, Authorization, the API key, prompts, evidence, or model output. The owner can read their rows; the browser cannot write them. Settlement happens first; the diagnostic write is bounded to 3 seconds, and a failed or slow write never changes reservation or settlement. Direct table writes are revoked from every role, including the service role.
- **Accounting is unchanged.** Reserve before contact; one logical attempt per run; unknown usage after possible contact keeps the hold with null actuals; no automatic retry; known usage settles once.

## 6. Live evidence to date

Two production runs reached the provider and failed. They are immutable forensic evidence: do not retry, release, settle, delete, or reuse either reservation.

| Run | Reservation | Outcome | Reservation state |
| --- | ----------- | ------- | ----------------- |
| `0c45212e-24e7-4ca6-a192-80b5f2e112fd` | `82c5776f-9e33-4f56-a4a6-a139cd8b4072` | `failed`, `openai_unavailable` | `held`, usage unknown, hold 7633 tokens / $0.0057 |
| `36ee430c-ba04-40af-9dd0-cf780e441042` | `b053366b-0d05-40ba-8fbf-1081b8c28290` | `failed`, `openai_request_rejected` | `held`, usage unknown, hold 7970 tokens / $0.0057 |

The second run proves provider-free retrieval, reservation, provider contact, and a request-level rejection that the classifier separated from authentication, quota, permission, rate limiting, timeout, and server errors. No automatic retry occurred, usage was not falsely claimed, and the hold stayed unresolved. The rejected parameter was not retained at that time; the diagnostics above now retain it for future attempts. Those two runs predate the diagnostics table and have no diagnostic row.

The change that added the SDK transport and diagnostics made no provider request and no paid run. Production still needs the diagnostics migration applied and `custodian-run` redeployed. M4 proof remains incomplete until a fresh deployed run succeeds.

## 7. Smallest next live step

Apply the diagnostics migration, deploy the merged `custodian-run`, publish the frontend, and verify the deployed source. Then run one brand-new, bounded Luna analysis and inspect its accounting, verification, and **Technical details**. Never reuse either held reservation in section 6.
