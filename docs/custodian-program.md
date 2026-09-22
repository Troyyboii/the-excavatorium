# The Custodian program

- **Status:** canonical product and implementation program
- **Version:** 0.1
- **Maintained against:** live repository source, migrations, tests, and verified service evidence
- **Scope:** The Custodian within The Excavatorium

## 1. Authority, use, and maintenance

This is the canonical long-lived program for The Custodian. It explains the product
intent, the implementation that exists in this repository, the deliberate boundaries
that remain closed, and the sequence required to finish a safe owner-controlled V1.
It is the starting map for a future human, Codex, ChatGPT, Lovable session, or other
contributor working on Custodian behavior.

It is not an operational claim about a deployed service. Live source, migrations,
tests, connected services, and a fresh release record outrank this document whenever
they disagree. Supporting documents preserve decisions and provenance; they do not
make a dormant capability operational. Update this program in the same reviewed change
that changes a Custodian contract, authority boundary, user-visible lifecycle, or
definition of done. Record a conflict instead of silently rewriting history to make the
documents agree.

The intended hierarchy is:

| Authority or reference                                                   | Role                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| This document                                                            | Canonical Custodian product and implementation program.                      |
| `docs/design/light-archive-shell.md`                                     | Current whole-application visual constitution.                               |
| `docs/design/custodian-roadmap.md`                                       | Supporting roadmap and implementation provenance.                            |
| `docs/design/custodian-design-system.md`                                 | Historical dark-shell and retained inverse-panel reference.                  |
| `docs/custodian-first-run-readiness.md`                                  | Repository-local first-run map: source-complete vs live-proof blockers.      |
| `docs/release-verification.md`                                           | Reusable release procedure.                                                  |
| `docs/supabase-setup.md`, `docs/supabase-verification.md`                | Backend setup, security, and verification procedures.                        |
| `src/`, `supabase/migrations/`, `supabase/tests/`, and deployed services | Evidence of actual implementation; source is authoritative over stale prose. |

### Capability vocabulary

Use these words consistently. They describe different dimensions, not a single
yes/no feature switch.

| Term           | Meaning                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **CURRENT**    | The inspected source implements the stated behavior on its intended surface. Production still needs separate proof.      |
| **PARTIAL**    | A meaningful portion exists, but a required boundary, interface, persistence link, or verification is missing.           |
| **PLANNED**    | Deliberately specified work with no claimed working implementation.                                                      |
| **FUTURE**     | Product intent beyond V1 or beyond an approved implementation slice.                                                     |
| **BLOCKED**    | Source intentionally refuses or disables the capability. This is a successful safety state, not an empty feature.        |
| **UNVERIFIED** | Source or configuration exists, but this document has no fresh proof of deployed, authenticated, or production behavior. |
| **HISTORICAL** | Retained provenance that no longer controls the current product or visual direction.                                     |

For every material capability, distinguish source implementation, database foundation,
browser UI, connector surface, provider execution, and production verification. A row
in a table, a route, or a type alone does not make the capability CURRENT on all of
those surfaces. Conversely, an omitted UI projection does not prove that archive data
does not exist.

## 2. Identity

The Custodian is the resident caretaker of The Excavatorium: an intelligence that
attends to accumulated judgment, notices what has become stale, contradictory,
unresolved, or consequential, and brings only meaningful matters before the owner.

The Excavatorium is the private technical judgment archive. The Custodian is not a
second archive and does not replace the archive's records, links, owner decisions, or
protected write path. It is an attributable, replaceable layer for bounded reading,
reasoning, proposed action, and verification.

It is explicitly not:

- a generic chatbot that answers from whatever context happens to be available;
- an autonomous agent permitted to mutate the archive or external systems because a
  model sounded confident;
- a scheduler that manufactures work to prove it is active;
- a search engine that treats retrieval as judgment; or
- an ornamental dashboard, avatar, typing indicator, or invented stream of activity.

The core authority split is permanent:

> **THE ARCHIVE REMEMBERS.**
> **THE CUSTODIAN EXAMINES.**
> **THE OWNER DECIDES.**

## 3. Product doctrine

Quiet is success. A quiet archive may have no matter worthy of attention; the
Custodian must not fabricate urgency, confidence, monitoring events, costs, or
activity merely to appear useful.

Evidence is material for reasoning, not decorative text beneath an answer. Every
admitted source needs an inspectable reason for inclusion. Supporting evidence,
contrary material, exclusions, uncertainty, provenance, scope, and truncation remain
available to the owner. Historical material can remain true while no longer defining
the current judgment.

The Custodian may infer and summarize, but model interpretation never silently becomes
canonical archive truth. A proposal is not a change. A gate is an explicit owner
decision point, not a hint to infer permission. Refusal, blocking, expiry, and an
unavailable projection are designed outcomes.

The following states must remain distinct:

- existence in canonical storage;
- owner visibility through RLS and an authenticated projection;
- retrievability by a particular UI or MCP tool;
- current availability of a connected service;
- callability of a runtime or tool; and
- authority to mutate evidence, canonical archive state, or an external system.

Absence from a projection is not absence from the archive. A partial projection is a
legitimate, reportable result. Character and restrained Custodian language may help
orientation, but never obscure evidence, uncertainty, exact proposed action, cost,
failure, source authority, or the owner gate.

## 4. Current source-grounded snapshot

This snapshot describes inspected repository source. It does not assert that migrations
are applied, functions are deployed, an OAuth connection is authenticated, or a live
provider call is available.

| Capability                                               | Source / database                                                                                     | Browser and MCP                                                                                                           | Provider / production                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Owner Cases and selected archive scope                   | **CURRENT** source contract in `supabase/migrations/20260904090000_custodian_case_archive_scope.sql`. | **CURRENT/PARTIAL** Case create/edit and reading UI; no Case UI authoring for every related artifact.                     | Applied migration and owner use are **UNVERIFIED** here.                                                         |
| Bounded Case Reading                                     | **CURRENT** browser-side bundle builder in `src/lib/case-reading.ts`.                                 | **CURRENT** read-only Case Reading presentation.                                                                          | It is provider-free; it is not evidence of a model run.                                                          |
| Claims, evidence, actions, findings, revisions           | **CURRENT** owner-scoped tables/RPC foundation, including the M2 Finding attribution migration and protected materialization RPC in `20260920090000_custodian_finding_attribution.sql`. | **PARTIAL** existing collections now expose Finding origin, run/step attribution, caveats, and bounded support/contrary descriptors. | Database application and end-to-end workflow are **UNVERIFIED**.                                                 |
| Durable runs, steps, budgets, approval, proposals, audit | **CURRENT** migration and RPC contracts, including the M3 owner-gate decision RPC.                    | Run Room is **CURRENT** as a read-only owner listing; Approvals is **CURRENT** as an owner decision surface. Approval does not execute unsupported work. | Runtime foundation is not operational proof.                                                                     |
| Provider-backed analysis                                 | M4A hold storage is merged source. M4B wires one synthesis attempt in `supabase/functions/custodian-run/provider-attempt.ts`: reserve, at most one fetch, truthful settlement, M2 materialization, and boundary verification. That path is unreachable while the Edge gate is closed. M4D source adds a readonly start contract and bounded driver without opening the gate. | M4C Run Room inspection is **CURRENT**. Invocation is **BLOCKED** by `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER = false`. While that constant is false, Start analysis does not call policy RPCs or the Edge Function. | Edge execution is **BLOCKED** by `PROVIDER_EXECUTION_UNSUPPORTED = true`. No paid call is authorized. Production activation is not done. Deployed behavior is **UNVERIFIED**. |
| External or canonical execution                          | Approval and tool-event guard foundations are **CURRENT** source.                                     | No control UI is connected.                                                                                               | **BLOCKED**; current Edge runtime stops approved external execution.                                             |
| MCP Custodian reads                                      | **CURRENT** bounded reader registrations and safe projections.                                        | `list_cases`, `get_case`, `get_findings`, `get_pending_approvals`, and `get_run` are conditional on deployed foundations; `get_findings` now projects bounded attribution and evidence descriptors. | Fresh authenticated production callability is **UNVERIFIED**.                                                    |
| MCP run control                                          | Reserved tools exist.                                                                                 | `start_analysis` and `cancel_run` deliberately return unavailable.                                                        | **BLOCKED**, never simulated.                                                                                    |
| Resident monitoring                                      | Tables and guarded automation RPCs exist.                                                             | Observatory has no live source and says so.                                                                               | **PARTIAL/FUTURE**; no scheduler or resident loop is proven operational.                                         |

Important gaps and contradictions must remain visible:

1. `agent_runs.tool_policy_id` is non-null, and the Edge `parseAgentRun` rejects a
   null policy. `selectRuntimeModel` requires an explicit owner-policy tier list; the
   exported source model list is not a selection default. `custodian_run_budget_status`
   denies a missing or inactive policy and counts held provider reservations separately
   from recorded usage. M4B source calls `custodian_reserve_provider_call` and
   `custodian_settle_provider_reservation` only inside the open-gate synthesis path.
   `handleRequest` does not enter that path while `PROVIDER_EXECUTION_UNSUPPORTED` is
   true, so production provider execution remains blocked. Deployed behavior remains
   **UNVERIFIED**.
2. The Edge Function contains a real OpenAI Responses call path behind its hard gate.
   This is dormant plumbing, not active provider execution.
3. The runtime still persists generic `agent_steps` output, and that output remains
   insufficient to become a Finding. The M2 source path now requires a completed
   `synthesize` step, a validated structured candidate, same-owner/same-Case evidence,
   and the protected `custodian_materialize_finding` RPC before creating an analysis
   Finding. Generic automation `brief` output fails closed. Database application and
   deployed behavior remain **UNVERIFIED**.
4. M4 read-only verification checks durable reservation identity and settlement, usage
   knowledge, factual tokens and cost when known, agreement between that reservation and
   the completed synthesis step, that known actual usage does not exceed the conservative
   hold, finding materialization counts, approval and proposal identity, and the absence
   of every tool operation class other than `read_only` (`evidence_write`,
   `canonical_write`, `archive_change`, and `external_write`). An exact disallowed-event
   count is required; a sampled tool-event page is not proof that no mutation occurred.
   Subtype flags are recorded only from exact class counts, or as false when that count
   is zero. An unexplained disallowed event does not mark every subtype false. Retrieval
   verification uses `provider-free-retrieve:<run id>` and fails if any retrieval artifact
   records provider contact or evidence creation. `semantic_correctness` is `not_claimed`.
   Reaching `verifying` or `completed` is not proof that a model conclusion is correct.
   Deployed behavior remains **UNVERIFIED**.
5. Approvals and automation foundations exist. The browser Approvals route is an
   owner-scoped proposal/gate decision surface; execution remains unavailable, and no
   resident loop was found in the inspected source.
6. The Desk's attention queue derives from existing archive rules, not a proven
   Custodian monitoring loop. Persisted Cases are available through the Cases surface
   when the case foundation is available; production application state remains
   **UNVERIFIED**.
7. The plugin README describes ordinary archive and Custodian retrieval as bounded and
   read-oriented, with `excavate_document` as the intentional non-read-only Document
   mutation exception outside Custodian run execution. Keep the distinction exact.

## 5. Canonical lifecycle

The complete conceptual lifecycle is:

```text
Signal → Case → Evidence → Finding → Proposal → Gate → Execution → Verification → Quiet
```

The sequence is a product contract, not a claim that every stage is currently wired
end to end.

| Stage            | Entry and durable artifact                                                                                                                                                                                                                      | Owner authority and failure state                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signal**       | A bounded indication: owner request, selected record condition, explicit revisit condition, approved monitoring rule, failure, pending approval, or demonstrated contradiction. Its source, time, scope, and reason for attention are recorded. | The owner can ignore, defer, pause, or remove a rule. A weak or unavailable signal stays quiet rather than escalating itself.                                         |
| **Case**         | An owner-created case defines the question, lifecycle, bounded `archive_scope`, and optional free-text owner context.                                                                                                                           | The owner chooses records and context. No case silently expands to an archive dump. Invalid ownership, unavailable scope, or excess size blocks admission.            |
| **Evidence**     | A context bundle preserves admitted records, provenance, order, exclusions, truncation, current/superseded/conflict signals, and uncertainties.                                                                                                 | Evidence is read as data. A withheld or partial bundle is reported as such; it is not silently replaced with model memory.                                            |
| **Finding**      | An attributable interpretation links claims, supporting and contrary evidence, confidence, uncertainty, revision/revisit conditions, and what would change the conclusion.                                                                      | Findings are not canonical record facts. A refusal, invalid output, missing source, or contradiction can yield no finding or an explicitly unresolved one.            |
| **Proposal**     | A possible change captures target, exact before snapshot, diff, after snapshot, rationale, provenance, action class, idempotency identity, and expiry.                                                                                          | A proposal makes no mutation. It can be cancelled, superseded, rejected, or deferred without applying its contents.                                                   |
| **Gate**         | An approval request binds the owner, case, run, exact action hash, approval kind, and proposed action.                                                                                                                                          | Approval is explicit. Reject, defer, expiry, cancel, policy mismatch, or a changed action ends or pauses the path; no inferred permission.                            |
| **Execution**    | A permitted internal evidence write, canonical archive change, or external action records the exact tool event and result against the approved action.                                                                                          | V1 must only execute what its policy and implementation explicitly allow. The current runtime blocks external execution; approval does not override that block.       |
| **Verification** | Independent checks record source/action identity, expected state, persisted result, usage, tool/external outcome, contradictions, and failures.                                                                                                 | Incomplete evidence, changed action hash, unexpected result, unavailable external source, or budget failure produces a visible failed/blocked result, not completion. |
| **Quiet**        | Completed or intentionally deferred work leaves an inspectable trail and no fabricated follow-up.                                                                                                                                               | Quiet does not erase history. A later owner signal or explicit revisit condition can start a new bounded cycle.                                                       |

## 6. Domain model and storage boundaries

The database foundation is extensive. It is deliberately broader than the immediate
V1 user experience. Existing tables must be classified by role before they are exposed
as features.

| Boundary                  | Current concepts and repository authority                                                                                                                                                         | V1 role                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical archive         | `records`, `record_links`, and protected archive RPCs, documented in `docs/supabase-setup.md`. Five record types are tool, repository, conversation, decision, and document.                      | Source of truth; Custodian does not replace it.                                                                                                                                                 |
| Case and analysis staging | `cases`, `inbox_items`, `case_members`, `claims`, immutable `evidence_items`, `claim_evidence`, `actions`, `custodian_findings`, and `record_revisions` in `20260811190000_custodian_tables.sql`. | Cases, scope, evidence, claims, and attributable reading are immediate V1 concerns.                                                                                                             |
| Judgment extensions       | `entities`, `entity_relations`, `experiments`, `decision_reviews`, and `forecasts` in `20260811191000_custodian_runtime_tables.sql`.                                                              | Useful foundations, but not every table needs a V1 screen or automatic population. Decision Review is the explicit handoff toward an owner decision, not automatic canonical decision creation. |
| Runtime and policy        | `tool_policies`, `connector_accounts`, `connector_tools`, `agent_runs`, `agent_steps`, and `record_embeddings`.                                                                                   | Run policy, durable state, cost/audit evidence, and bounded future retrieval. Embeddings are optional, not an excuse for opaque archive-wide retrieval.                                         |
| Proposal and approval     | `approval_requests`, `change_proposals`, and `tool_events`.                                                                                                                                       | Exact-action, owner-gated work only.                                                                                                                                                            |
| Automation and audit      | `automation_rules`, `automation_runs`, and immutable `audit_events`.                                                                                                                              | Conservative future monitoring foundation; no proof of a resident loop.                                                                                                                         |

Custodian rows are owner and case scoped. The migrations use composite owner/case/run
relationships, RLS, revoked direct mutation privileges, and `SECURITY DEFINER` RPCs
that derive and re-check the caller. The source-level contracts are in
`20260811190200_custodian_rls_privileges.sql`,
`20260811190300_custodian_write_rpcs.sql`,
`20260811191100_custodian_runtime_indexes_rls.sql`, and
`20260811191200_custodian_runtime_rpcs.sql`. Deployment, grants, and second-user
isolation still need fresh production evidence under `docs/supabase-verification.md`.

## 7. Attention: when to interrupt quiet

Attention is earned by a concrete relationship to owner judgment, not by freshness or
model curiosity alone. Candidate signals include:

- a judgment with an explicit revisit condition that is now met;
- evidence marked superseded or a materially newer replacement;
- contradictory evidence that affects a decision, claim, or action;
- unresolved uncertainty material to a live case;
- an open loop whose owner-defined condition or deadline has become relevant;
- a Decision Review condition, experiment result, or forecast condition the owner
  explicitly asked to revisit;
- a failed, blocked, expired, cancelled, or budget-stopped run that needs a human
  choice;
- a pending approval that is still valid and materially actionable; or
- an owner-created monitoring rule within its declared scope, frequency, and budget.

Each signal must state why it was admitted, which records or rule produced it, its
freshness, and what decision it could affect. A new timestamp, a large archive, a
missing connector result, or a model-generated hunch alone is not enough. Deduplicate
equivalent signals and preserve the earlier case/run reference rather than creating
noise. A quiet state should be the normal outcome for an archive with no supported
reason to act.

## 8. Cases and bounded evidence

`cases.archive_scope` is the current durable contract: `{ record_ids,
free_text_context }`. The scope migration limits it to 50 owner-visible UUIDs and
10,000 characters of owner context. The owner selects archive records; context remains
separate and visibly labeled as owner context, not canonical evidence. The old
`default_working_set` remains a compatibility field and is not Case Reading evidence.

`src/lib/case-reading.ts` and `src/components/custodian/case-reading.tsx` implement
a provider-free, read-only Case Reading. The selected record order is preserved. The
bundle is capped at 80,000 serialized characters and retains unavailable exclusions,
truncation, evidence gaps, provenance, and limited detectable signals for superseded
Decisions, replacement tools, document conflicts, and uncertainty. The displayed
reading is a context bundle, not an archive dump.

The current evidence admission reason is derived transiently from the owner's selected
scope and the archive snapshot: available selected records are admitted as owner-selected,
missing records are excluded as unavailable, and records removed by the serialized reading
limit are excluded as over the reading limit. There is no dedicated stored "Why admitted?"
field. Case Reading exposes a concise, inspectable admission reason for each selected record
and retains exclusions with the reason a record was not admitted. Connector-source admission
remains a separate future contract.

If the owner-scoped archive snapshot is unavailable, Case Reading is withheld. If a
last successful snapshot is shown after refresh failure, it is labeled stale. A selected
but unavailable record remains visible as unavailable rather than being silently
dropped. These are correctness properties, not cosmetic error states.

## 9. Findings and reasoning

A finding is a Custodian interpretation, not a canonical record fact. It must carry:

- a specific claim or conclusion and its confidence;
- links to supporting material and contrary material;
- source attribution and provenance for each material statement;
- uncertainty, assumptions, scope limits, and known unavailable evidence;
- supersession or contradiction status where relevant;
- what would change the Custodian's mind; and
- a revisit condition or explicit reason not to revisit.

`custodian_findings` and related claim/evidence tables provide a source foundation;
the Record Evidence Reader presents persisted findings separately under
"Interpretation — not source truth." The current readers do not establish provider
provenance for a finding, and current Edge provider plumbing does not write model
output into `custodian_findings`. Do not collapse generic `agent_steps.output_payload`
into a finding without an explicit, reviewed persistence contract.

Contradiction handling preserves material competing values, source dates, scope,
confidence, and provenance. It never resolves a conflict simply by tone, recency, or
plausibility. `compare_records` is a bounded MCP comparison aid; it reports projected
differences and is not a verdict generator. The appropriate finding may be "unresolved"
or a refusal to conclude.

## 10. Proposals and the owner gate

Every consequential proposal must be a durable object, not prose buried in a response.
The minimum representation is target identity, operation, exact before snapshot,
proposed diff, after snapshot, rationale, provenance, lifecycle status, expiry, and an
idempotency key. `change_proposals` already provides the before/diff/after foundation.

An approval request must bind the exact proposal or tool action through an exact action
hash, owner, case, run, approval kind, and status. The current foundation supports
`tool_action`, `canonical_write`, `external_write`, and `archive_change`, with
`pending`, `approved`, `rejected`, `expired`, and `cancelled` outcomes. Tool-event
hardening binds non-read-only events to the matching approved case/run/action hash.

The owner may approve, reject, defer, allow expiry, or cancel where a UI/control is
explicitly implemented. Approval replay is valid only for the same approved action
identity under the same policy and still-valid state. Changed input, proposal, target,
scope, policy, or action hash requires a new proposal and gate. Rejection does not
mutate the target; it records why the run stopped and may inform a later, newly bounded
proposal. Retrying a failed read-only operation is possible only through a durable,
idempotent run contract. Retrying a write never turns a past approval into blanket
permission.

The database/RPC foundation exists, and the browser Approvals route is an owner-scoped
inspect-and-decide surface. MCP remains read-only for pending approvals. Approval
records the exact-action decision only; no internal V1 execution class has been selected.

## 11. Runtime architecture

The source state machine is defined in `src/lib/custodian-runtime-types.ts`:

```text
queued → retrieving → synthesizing → verifying → completed
                  ↘ awaiting_approval → executing → verifying
```

Any active state may end in `blocked`, `failed`, `expired`, `budget_stopped`, or
`cancelled` where the transition table permits it. Terminal states do not advance.
The runtime tables record objective, input snapshot, graph/config, prompt version,
tool allowlist, model tier, budgets and usage, cancellation request, failure details,
ordered steps, approvals, proposals, tool events, and audit entries.

`custodian_create_agent_run`, `custodian_transition_agent_run`,
`custodian_record_agent_step`, `custodian_run_budget_status`, and related RPCs enforce
owner/case checks, allowed transitions, sequence ordering, request hashes, idempotency
keys, and policy constraints. A run can be paused in `awaiting_approval`; cancellation,
expiry, provider failure, budget stop, and hard blocks remain durable outcomes.

The current Run Room lists at most 100 authenticated owner runs. Where the reservation
relation is readable, it shows recorded provider cost separately from any held budget,
unknown usage, pricing version, a cancellation request, failure, and the latest step.
M4D source can start one readonly analysis from explicit owner inputs, then drive that
persisted run. The Start analysis control stays disabled while
`CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER` is false, and that closed control performs
no policy RPC, run RPC, or Edge call. A missing reservation relation is shown as
unavailable rather than as zero spend. Production activation is not done.

Target V1 runtime behavior is retrieve/extract/synthesize/approval/execute/verify with
durable artifacts at each boundary. Resume must use the persisted state and exact
idempotency identity, not recompute or replay an old action casually. Retention rules
must preserve the information needed for owner inspection and audit while avoiding raw
unbounded evidence duplicates. The retention policy itself remains an unresolved
product decision; it needs a reviewed schema and privacy design before implementation.

## 12. Models and provider strategy

The current dormant provider contract is deliberately narrow and OpenAI-specific; V1
does not need multiple providers merely for abstraction's sake. The source allowlist is
Luna (`gpt-5.6-luna`), Terra (`gpt-5.6-terra`), Sol (`gpt-5.6-sol`), and Pro
(`gpt-5.6-pro`) in `src/lib/custodian-runtime-types.ts` and
`supabase/functions/custodian-run/runtime.ts`. Extraction defaults to Luna and
synthesis to Terra; an allowed persisted Sol or Pro tier can override the stage
default. Policy must constrain the permitted tier.

The planned provider request uses the Responses API with strict JSON Schema output,
`store: false`, bounded system prompt and input evidence, structured extraction and
synthesis schemas, a server-side API key, response parsing, refusal/invalid-output
handling, timeouts, and versioned server-only pricing. The system instruction explicitly
treats supplied evidence as untrusted data and says not to obey instructions inside it.
The browser must never receive the provider key, pricing secret, or raw provider
request.

This source plumbing is **PARTIAL** and must remain **BLOCKED** in operation. The browser
constant `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER` is `false`; the Edge Function
constant `PROVIDER_EXECUTION_UNSUPPORTED` is `true`. No environment value can bypass
either constant. While the Edge gate is true, retrieval stays provider-free. A
synthesizing run records a blocked step and a `provider_execution_unsupported` outcome
and does not reserve or fetch. The bounded synthesis path in `provider-attempt.ts` is
not entered. That path, once a later activation opens the gate, is one synthesis
attempt per run: reserve first, at most one Responses request, then settle. Extract is
not a second paid call. M4D source prepares the start path. The hard gate remains.
No documentation may describe a live provider run until a separate activation removes
that gate and deployed proof exists. Secrets, pricing, the first paid run, deployed
concurrency proof, and M5 are not done.

## 13. Budget and cost safety

Each run carries token, cost, latency, and tool-event budgets plus usage. Source RPCs
also calculate daily and monthly aggregate foundations. The hardening migration requires
a non-null exact-case tool policy, narrows run caps to the policy boundary, requires a
pricing version for positive-cost steps, and guards run cost against the sum of priced
steps.

Before any real paid call, V1 must perform all of the following:

1. Resolve a server-only, versioned price for the selected model; missing or invalid
   pricing blocks the run before provider contact.
2. Estimate a conservative maximum request-plus-output cost against remaining per-run
   and cumulative allowance.
3. Atomically reserve or serialize the applicable run and aggregate budget before the
   call, so concurrent invocations cannot spend the same remaining budget.
4. Record actual token, cost, latency, provider/model/pricing version, and error
   outcome after the call.
5. Stop visibly on budget exhaustion; do not silently reduce scope or substitute an
   unpriced result.

M4A stores `custodian_reserve_provider_call` and
`custodian_settle_provider_reservation`. A budget hold encumbers the conservative
maximum. It is not written into `agent_steps` or `agent_runs` unless parsed provider
usage is settled as known. Unknown usage leaves actual tokens and cost null. An owner
may reserve a hold. Settlement, release, and completed synthesis output require the
service-role runtime. Daily and monthly totals attribute recorded usage by the priced
step time. A reservation that remains held continues to encumber the current daily and
monthly aggregate budgets until it is settled as known usage or released as
uncontacted. Run creation time does not place either figure.

M4B calls that reservation boundary from the Edge synthesis path before any provider
fetch. A denied, unreadable, in-flight, or already held reservation produces zero
provider requests. Known settlement records factual tokens and cost and drops the hold
from aggregate accounting. Ambiguous contact leaves the hold with null actuals and
`usage_knowledge = unknown`. A definite pre-contact failure releases the hold as
uncontacted. The public runtime projection reports recorded cost, unknown usage, and
held encumbrance separately; it does not label factual cost `unpriced`. The attempt
identity is `provider-attempt:<run id>:synthesize`, so a repeated invocation reuses
that reservation instead of opening a second paid attempt. An approval gate for that
synthesis uses `approval:provider-attempt:<run id>:synthesize`, so concurrent replays
share one gate instead of the caller's invocation key. An idempotent approval replay
that omits the run is re-read from the durable run and must already be
`awaiting_approval`; the caller’s earlier status is not reused. If that confirmation
fails, the response stays unavailable and keeps the already settled provider accounting
without inventing `awaiting_approval`. The exact action hash
remains the M3 server hash of the proposed diff and tool action. The database still keys
reservations by idempotency key; this source does not add a second synthesis key.
`PROVIDER_EXECUTION_UNSUPPORTED` remains `true`, so the production handler never
enters this path. The first paid Custodian run requires the separate M4D sequence.

A null daily or monthly cost ceiling is not a product default.
`custodian_reserve_provider_call` and the read-only policy and run RPCs refuse it.
`custodian_run_budget_status` still reports a null remaining amount for a legacy policy
with a null aggregate ceiling, so an existing status reader does not treat that legacy
row as an immediate budget stop. Held amounts are included in the usage those
remainings are measured against.

Cost must be visible to the owner as budget, actual usage, pricing version, and failure
reason without exposing secrets or raw provider headers. A generic completion message
is insufficient.

## 14. Tools, connectors, and MCP

Tool operation classes are `read_only`, `evidence_write`, `canonical_write`,
`external_write`, and `archive_change`. `read_only` needs no action approval; every
other class needs an explicit owner gate and exact action identity. A connector account
and tool must describe source, account relationship, capability, schema version,
freshness, provenance, and availability. Schema drift, revoked access, stale consent,
missing scopes, and unavailable foundations are reportable states, not empty results.

MCP is a bounded, authenticated client surface over application persistence; it is not
a second database or a way around the owner authority model. Current archive tools use
safe projections and bounded arguments. They redact user identifiers, seed keys, raw
conversation text, private document storage/extracted paths, and unknown document
fields by default. `get_context` returns a bounded owner-linked bundle rather than an
archive dump. `compare_records` compares projection fields without adjudicating truth.

Current Custodian MCP readers are `list_cases`, `get_case`, `get_findings`,
`get_pending_approvals`, and `get_run`, conditional on the relevant deployed owner-RLS
foundation. `start_analysis` and `cancel_run` are intentional reserved boundaries:
they authenticate, return `RUNTIME_UNAVAILABLE`, perform no write, and never pretend
that execution or cancellation happened. Connected ChatGPT or Codex clients must stop
there. A live connector call requires its own fresh proof; registration or a plugin
manifest is not proof of authentication or callability.

The `custodian` plugin skill in `plugins/the-excavatorium/skills/custodian/SKILL.md`
defines useful retrieval discipline: discover narrowly, fetch/prove provenance, compare
only material records, preserve contradiction and unavailable states, and never surface
hidden identifiers or storage paths. It is a client behavior guide, not a grant of
runtime mutation authority.

## 15. Execution model

These actions are deliberately different:

| Action                   | Meaning                                                           | Current V1 position                                                                      |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Reasoning                | Interpret a bounded evidence bundle.                              | Provider-free case reading exists; provider reasoning is blocked.                        |
| Proposing                | Persist an exact possible action for review.                      | Foundation exists; Approvals exposes linked proposals when persisted.                    |
| Approving                | Owner decision on the exact action hash.                          | Foundation and owner-scoped UI exist; MCP has no decision tool; execution stays blocked. |
| Evidence write           | Create a non-canonical evidence artifact within policy and audit. | Foundation exists; only implement after explicit contract and gate.                      |
| Canonical archive change | Change a protected record or related canonical meaning.           | Not implied by a finding or approval; requires explicit protected path and verification. |
| External side effect     | Change something outside the archive.                             | Intentionally unsupported by the current Edge runtime.                                   |

Custodian V1 should first execute no external side effects. If it eventually supports
an execution action, start with one narrow, independently reversible, policy-defined
internal evidence write or explicitly reviewed canonical path. Do not promise external
or canonical writes until a milestone implements, tests, and releases the exact path.

## 16. Verification after a run

Verification is a real stage, not a status label. A run must establish, as applicable:

- evidence/source availability, scope, provenance, exclusions, and any stale snapshot;
- the identity of the proposal, exact action hash, policy, approval, and idempotency key;
- that no unauthorized mutation occurred;
- persistence of expected run, step, finding/proposal, usage, and audit artifacts;
- expected state transition and terminal/failure reason;
- recorded tool result and source freshness;
- external result only when an external action was explicitly supported; and
- contradictory evidence, refusal, partial result, and verification failure.

The M4 read-only verification stage inspects durable artifacts: run identity,
the stable provider-free retrieval step `provider-free-retrieve:<run id>`, reservation
identity and settlement, known factual tokens and cost, and a completed synthesis step
whose idempotency key, pricing version, tokens, and cost match that reservation. The
stable retrieval step must be completed, with provider contact and evidence creation
both false. Another retrieve step cannot replace it. Any retrieval artifact that records
provider contact or evidence creation fails verification. Known actual tokens and cost
must be present and must not exceed the conservative hold. It also checks finding count,
approval and proposal identity when present, and the absence of every tool operation
class other than `read_only`, including `evidence_write`, `canonical_write`,
`archive_change`, and `external_write`. That absence comes from an exact count of
disallowed tool events, not from a bounded sample. Known subtype flags come from exact
per-class counts. When a disallowed event is known only as a count, verification fails
and does not record every subtype as false. `semantic_correctness` is always
`not_claimed`. Unknown or missing provider usage fails the run closed. A hold that was
exceeded fails verification and keeps the factual actual usage. This proves persistence
and boundary integrity. It does not prove that a model conclusion is correct. The closed
Edge gate does not advance a run into this stage. M5 execution verification remains
unimplemented.

## 17. Resident attention and automation

`automation_rules` and `automation_runs` establish a conservative foundation: rule
triggers can be schedule, record-created, evidence-added, manual, connector event, or
webhook; outputs are constrained to evidence, brief, or approval; the schema forbids
canonical mutation. Related RPCs check rule status, idempotency, and connector schema
conditions. These facts do not prove a scheduler, event consumer, resident process, or
live Observatory.

The future resident model must be owner-created and bounded:

- each rule names a case, source, condition, schedule/event source, output kind,
  deduplication key, frequency, cost ceiling, and pause/kill control;
- schedules/events assemble a bounded context and may emit only evidence, a brief, or
  an approval request where policy permits;
- it never changes canonical archive state without a new explicit owner gate;
- matching signals deduplicate against existing cases/runs and retain their lineage;
- a missing connector, schema change, rate limit, budget limit, or paused owner policy
  produces a quiet, inspectable blocked result; and
- a healthy archive without a qualifying signal produces nothing.

Observatory remains a PLANNED presentation until it has a truthful live source. It must
not invent health, model, cost, approval, verification, or monitoring statistics.

## 18. User experience

The visual authority is `docs/design/light-archive-shell.md`: a grouped near-black
structural shell, warm ivory archival workspace, evidence-led ledger treatment, and
light provenance/boundary inspector. Historical dark Custodian design language remains
only for inverse interpretation, refusal, security, code, and execution boundaries.

| Surface                      | Current state                                                                                                     | Intended role                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Custodian Desk               | **CURRENT** projection of real archive/link-derived attention and working sets; not a control plane.              | Quiet first view that surfaces only materially supported attention.                                          |
| Inbox                        | **CURRENT** owner intake, review, save, triage, and promotion foundation with truthful offline/foundation states. | Bring tentative material into a bounded Case without calling it archive evidence too early.                  |
| Cases                        | **CURRENT/PARTIAL** owner Case and scope UI; related artifacts display but are not all authorable there.          | Owner defines question, bounded archive scope, and free-text context.                                        |
| Evidence Room / Case Reading | **CURRENT** provider-free, bounded, provenance-rich reading.                                                      | Inspect what was admitted, excluded, unavailable, superseded, or uncertain.                                  |
| Findings                     | **PARTIAL** persisted finding display via evidence readers and case collections.                                  | Separate attributable interpretation from source truth and expose support/contrary evidence.                 |
| Proposal / Gate              | **CURRENT** inspectable exact-action presentation on Approvals.                                                   | Show exact before/diff/after and owner decision, never a vague "approve agent" button.                       |
| Approvals                    | **CURRENT** owner-scoped inspect-and-decide surface; execution remains **BLOCKED**.                               | Read and decide exact owner-scoped requests with expiry/reject/defer audit.                                  |
| Run Room                     | **CURRENT** closed owner inspection. Start analysis stays disabled and does not invoke the Edge Function while the browser gate is false. | Show status, objective, model tier, recorded cost and tokens, held budget, unknown usage, pricing version, cancellation, failure, and step state. A hold is encumbrance, not recorded spend. |
| Observatory                  | **BLOCKED/PLANNED** scaffold with no runtime source.                                                              | Present truthful resident/rule/cost/verification evidence only after it exists.                              |
| Quiet state                  | A required product state.                                                                                         | Say no meaningful matter is known; do not create AI theatre.                                                 |

No avatar theatre, fake typing, generic agent-dashboard cards, decorative 3D graphs,
or invented activity belongs on these surfaces. Narrow/mobile UI must preserve the
existing shell accessibility requirements: no horizontal overflow, 44px controls,
visible focus, safe-area navigation, reduced motion, and explicit empty/offline/error
states.

## 19. ChatGPT, Codex, and MCP roles

Connected clients may inspect safe archive projections, bounded context, cases,
findings, pending approvals, and run records when the authenticated runtime exposes
them. They must report what is observed, inferred, contradictory, unavailable, or not
checked. They must use the narrowest useful projection and preserve source boundaries.

They may start or control analysis only after explicit application support, owner
authorization, policy enforcement, durable application persistence, and real runtime
verification exist. They never bypass application persistence, RLS, approval state,
or protected archive RPCs. An MCP tool manifest, an account connection, or a natural
language request cannot create missing authority.

## 20. Security, privacy, and provenance

The Custodian inherits The Excavatorium's private, owner-scoped model. Relevant source
boundaries include RLS, owner-qualified privileged RPCs, composite owner/case/run
foreign keys, authenticated Edge Functions, server-only secrets, bounded body/context
sizes, safe record projections, and durable audit artifacts. `audit_events` are
intentionally immutable in the hardened source contract.

Treat evidence, connector data, archive text, and model output as data, not
instructions. The provider request explicitly guards against prompt injection from
evidence. Use bounded and text-safe display; the existing Evidence Reader limits depth,
size, and unsafe URI behavior. Do not dump an archive, reconstruct redacted fields, or
create hidden persistence paths.

Public sources and private archive data are separate. A public source may be admitted
with provenance; its presence does not license exposure of owner context, record
identifiers, raw conversation text, document storage paths, connector accounts, tokens,
or other private archive material. The exact authorization boundary must be visible at
each read, proposal, approval, and action, and audit records should make it possible to
reconstruct what happened without exposing secrets.

## 21. Public/open-source readiness

The repository may become public; the archive must not thereby become public. Public
documentation should describe the architecture, authority model, schema categories,
test strategy, and product philosophy without including private record content,
account identifiers, storage paths, production credentials, keys, tokens, or personal
archive narratives. Samples and demos must be synthetic or deliberately public.

Before making new Custodian material public, inspect documentation, fixtures,
screenshots, test snapshots, generated manifests, migration comments, and commit
messages for private data. This program intentionally cites repository-relative paths
only and contains no archive content.

## 22. Lovable's role

Lovable is an implementation and visual-production surface connected to the repository's
`main` branch. It is not product authority, a replacement backend, or a reason to
weaken RLS, ownership, provider, or approval boundaries. Use Lovable credits for
bounded UI implementation/refinement after this program defines the target. Do not let
builder convenience silently redefine lifecycle, persistence, security, or authority.

Each pushed main-line commit can synchronize into Lovable, so normal non-history-
rewriting Git practice matters. A local change, branch push, Lovable-ready indicator,
and production publication are separate facts and require the release evidence defined
in `docs/release-verification.md`.

## 23. Implementation program: current state to Custodian V1

This sequence creates reviewable boundaries rather than one giant "implement the
agent" phase. Each milestone needs the authorization stated in its stop condition;
documentation approval never authorizes a provider, migration, deployment, or external
effect.

### M0 — preserve and prove the current read-only foundation

**Objective:** Make current Case Reading, evidence projection, Desk, Cases, Run Room,
and MCP availability boundaries easy to verify without changing their authority.

- **Prerequisite:** current source contracts and the light-shell visual constitution.
- **Likely areas:** Case/evidence tests, route truthfulness, `custodian-surfaces`, MCP
  projection/security tests, documentation only where behavior has changed.
- **Database/provider/connector impact:** none intended; provider gate stays closed.
- **UI impact:** small truthfulness and accessibility repairs only, no invented runtime.
- **Security:** preserve owner scope, redaction, bounded context, and read-only paths.
- **Validation:** focused source tests; authenticated browser proof and RLS/projection
  evidence in a separately authorized release slice.
- **Stop condition:** every visible CURRENT surface says what it can and cannot do.
- **Authorization boundary:** implementation and release evidence need explicit approval;
  no provider activation.

### M1 — make Case Reading a complete evidence admission surface

**Objective:** Finish owner-visible reason-for-admission, exclusions, conflict/revision
signals, and clear distinction between canonical source, owner context, and
interpretation.

- **Prerequisite:** M0 truthfulness and current bounded scope contract.
- **Likely areas:** `src/lib/case-reading.ts`, `src/components/custodian/case-reading.tsx`,
  Case UI, focused tests; migration only if a durable admission rationale is required.
- **Database impact:** avoid a new table unless a stable audit/replay need is proven.
- **Provider impact:** none; reading remains provider-free.
- **UI impact:** Evidence Room improvements under the Light Archive Shell.
- **Connector impact:** define source freshness/admission metadata but do not activate a
  connector.
- **Security:** preserve selected-only owner scope, 80k cap, redactions, and unavailable
  state.
- **Validation:** deterministic order/truncation/exclusion/contradiction tests and
  narrow mobile/browser proof.
- **Stop condition:** an owner can inspect why every bundle member is present or absent.
- **Authorization boundary:** any schema migration or connector call requires explicit
  authorization.

### M2 — make findings attributable and separate from generic run data

**Objective:** Define and implement the reviewed path from a bounded analysis result to
an attributable, non-canonical finding with support, contrary evidence, uncertainty,
and revisit conditions.

- **Prerequisite:** M1 evidence admission contract and a decision on finding schema
  provenance/linkage.
- **Likely areas:** `custodian_findings`, claims/evidence relationships, case/evidence
  readers, run-step schema/contracts, focused tests.
- **Database impact:** likely a narrow migration if provider/run provenance needs an
  explicit relation; do not overload untyped step JSON silently.
- **Provider impact:** still none required; test with deterministic fixture output first.
- **UI impact:** Findings reading, provenance, uncertainty, and "what would change it"
  presentation.
- **Connector impact:** findings retain connector freshness/provenance if source used.
- **Security:** model output remains interpretation; canonical writes remain unavailable.
- **Implemented source path:** `custodian_findings` now distinguishes legacy,
  owner-authored, and analysis origin; analysis Findings link to the originating run,
  completed synthesis step, candidate index, result hash, bounded caveats, and a
  dedicated supporting/contrary evidence relation. Refusal and no-Finding outcomes
  do not persist Findings. Generic automation briefs fail closed.
- **M2 SOURCE IMPLEMENTATION:** **COMPLETE**
- **LOCAL VALIDATION:** **PARTIAL** — frontend and Edge Function validation passed;
  local database runtime validation is unverified because Docker is unavailable.
- **REMOTE MIGRATION APPLICATION:** **UNVERIFIED**
- **DEPLOYED EDGE BEHAVIOR:** **UNVERIFIED**
- **PROVIDER EXECUTION:** **BLOCKED**
- **Validation:** deterministic support/contrary/absence/refusal fixtures, replay and
  conflicting-identity checks, owner/RLS checks, canonical-record preservation, and
  source-to-Finding audit assertions.
- **Stop condition:** no generic agent-step output can masquerade as a provider-backed
  finding.
- **Authorization boundary:** schema change and any real model call need explicit
  authorization.

### M3 — complete owner gate and limited internal execution contract

**Objective:** Build an owner-scoped proposal/approval surface and choose one narrow,
non-external, policy-controlled action type, if any, for V1.

- **Prerequisite:** M2 provenance, exact action schema, tool-policy decision, and
  idempotency tests.
- **Likely areas:** Approvals route, proposal/gate components, runtime RPC clients,
  `approval_requests`, `change_proposals`, `tool_events`, audit tests.
- **Database impact:** only a reviewed migration needed to represent the chosen exact
  action safely; preserve hardening constraints.
- **Provider impact:** no provider required to demonstrate the gate.
- **UI impact:** exact before/diff/after, action-time confirmation, approve/reject/defer,
  expiry/cancel state, and no broad permission prompts.
- **Connector impact:** no connector action unless separately approved.
- **Security:** action hash, case/run/policy binding, ownership, audit, and replay
  protection are non-negotiable.
- **Implemented source path:** Approvals reads owner-scoped `approval_requests` and
  linked `change_proposals`, presents the exact action, and records approve / reject /
  defer / expire / cancel through the protected `custodian_respond_approval` RPC. A
  changed exact action hash cannot reuse the current gate. The RPC requires
  `expected_action_hash`; omitting it, or passing null/blank, cannot authorize a
  decision. Approval does not execute
  provider, external, or canonical work. No internal V1 execution class was selected.
- **M3 SOURCE IMPLEMENTATION:** **COMPLETE**
- **LOCAL VALIDATION:** **PARTIAL** — frontend typecheck, lint of changed files, `bun test src`,
  Edge `deno task check`/`test`, and `bun run build` passed in this workspace. Local
  database runtime validation is **UNVERIFIED/BLOCKED** because Docker is unavailable.
- **REMOTE MIGRATION APPLICATION:** **UNVERIFIED**
- **DEPLOYED EDGE BEHAVIOR:** **UNVERIFIED**
- **PROVIDER EXECUTION:** **BLOCKED**
- **INTERNAL V1 EXECUTION CLASS:** **UNRESOLVED**
- **Validation:** rejection, expiry, changed hash, duplicate approval, cross-owner,
  unauthorized write, and audited no-mutation tests.
- **Stop condition:** the owner can make an inspectable decision, but approval cannot
  execute unsupported work.
- **Authorization boundary:** enabling any execution path is a separate explicit
  authorization.

### M4 — close the provider activation gate

**Objective:** Turn dormant Responses plumbing into one bounded real provider-backed
read-only analysis path.

- **Prerequisite:** M1-M3, non-null policy enforced everywhere, explicit model allowlist,
  provider finding persistence, comprehensive state/idempotency tests, and an approved
  cost policy.
- **Likely areas:** `supabase/functions/custodian-run/`, runtime RPCs/migrations, tests,
  Run Room, Findings and evidence UI, secure configuration and release documentation.
- **Database impact:** likely reservation/locking and explicit provenance changes; no
  migration is applied without separate authorization.
- **Provider impact:** server-only pricing/key, strict schema, `store:false`, atomic
  budget reservation, timeout/refusal/malformed-output handling, and first-paid-run
  approval.
- **UI impact:** a truthful start path, durable progress/failure, run inspection, and
  no fake streaming activity.
- **Connector impact:** none required for the first analysis; use owner-selected archive
  evidence.
- **Security:** request/context cap, prompt injection isolation, owner scope, audit,
  no provider secret in client, and hard fail on missing price/reservation.
- **Validation:** local unit/Edge/database checks plus authenticated deployed proof of
  one bounded read-only run and its failure paths.
- **Stop condition:** no paid call occurs until every provider gate is verified and the
  first paid run has separate explicit authorization.
- **Authorization boundary:** provider activation, secret configuration, migration
  application, deployment, and first paid run are all distinct external approvals.
- **M4A SOURCE FOUNDATION:** **MERGED** on main. Hold storage, service-role settlement,
  owner-scoped reserve, persistent unknown holds, aggregate budgets, policy bootstrap,
  the server-built read-only snapshot, allowed model tiers, and in-flight cancellation
  semantics exist. No M4A migration was rewritten by the later source slice.
- **M4B SOURCE WIRING:** **PRESENT, UNREACHABLE.** `provider-attempt.ts` can perform
  exactly one bounded synthesis attempt after a successful reservation. Retrieval stays
  provider-free. Valid synthesis still materializes only through the M2 contract.
  `PROVIDER_EXECUTION_UNSUPPORTED` remains `true`, so `handleRequest` does not enter
  the fetch path.
- **M4C BROWSER PREPARATION:** **PRESENT, CLOSED.**
  `CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER` remains `false`. The prepared invocation
  body is only `{ runId, invocationKey }`. While the constant is false, Start analysis
  does not call the Edge Function.
- **M4D SOURCE:** **IMPLEMENTED, NOT ACTIVATED.** The readonly start contract and
  bounded driver exist. Both provider constants remain closed. Production activation
  is not done. Secrets and pricing are not configured. The first paid run is not done.
  Deployed concurrency proof is pending. M5 is not done.
- **M4 PROVIDER ACTIVATION:** **BLOCKED.** M4 is not complete.
- **PRODUCTION / DEPLOYED BEHAVIOR:** **UNVERIFIED** until a separately authorized
  deploy and proof. M5 and M6 are not started. The first-run blocker
  split is recorded in `docs/custodian-first-run-readiness.md`.

### M5 — finish V1 lifecycle inspection and permitted execution

**Objective:** Deliver the demonstrable owner-controlled lifecycle, including only the
execution class that M3 explicitly approved.

- **Prerequisite:** M4 real read-only run proof and M3 exact owner gate.
- **Likely areas:** Runs, findings, approvals, verification, audit, policy, and focused
  UI/MCP readers; connectors only if independently justified.
- **Database impact:** no speculative foundation expansion; only reviewed changes needed
  for the selected V1 action.
- **Provider impact:** existing bounded path only; do not add providers casually.
- **UI impact:** Desk attention, Evidence, Findings, Gate, Run Room, and quiet state
  form one comprehensible path.
- **Connector impact:** remain read-only/unavailable unless a separate connector phase
  implements freshness, schema versioning, and policy.
- **Security:** prove no unauthorized canonical/external mutation and exact action
  replay protections.
- **Validation:** V1 definition-of-done scenarios below across source, DB, Edge,
  browser, and production evidence.
- **Stop condition:** finished only when the full bounded lifecycle is demonstrable;
  model text alone is insufficient.
- **Authorization boundary:** any canonical or external side effect beyond the selected
  V1 action needs a new product, security, and release decision.

### M6 — optional resident attention and connectors

**Objective:** Add owner-created, rate/cost-bounded monitoring or a specific connector
only after V1 is calm, verifiable, and safe.

- **Prerequisite:** M5, owner pause/kill controls, deduplication contract, and concrete
  signal value.
- **Likely areas:** automation rules/runs, Observatory, connector account/tool models,
  MCP capability policy, tests.
- **Database/provider/UI/connector/security:** each change is a separate reviewed slice;
  no active loop or connector is implied by current tables.
- **Validation:** schedule/event, deduplication, pause, schema drift, unavailable
  connector, cost/frequency cap, and quiet-state proof.
- **Stop condition:** automated output remains evidence/brief/approval only and never
  manufactures work or canonical mutation.
- **Authorization boundary:** schedule activation, OAuth/connector credentials, provider
  use, and deployment are explicit external authorizations.

## 24. Custodian V1 definition of done

Custodian V1 is complete only when an owner can demonstrate this entire controlled
path with fresh evidence:

```text
open or create Case
→ define a question and bounded owner-selected scope
→ inspect an evidence bundle with provenance and exclusions
→ perform one real bounded provider-backed read-only analysis
→ inspect attributable findings, support, contrary material, and uncertainty
→ inspect any exact proposal and required owner gate
→ approve, reject, or defer where the selected V1 action supports it
→ execute only the explicitly permitted, policy-bound V1 action
→ verify identity, persistence, result, usage, cost, and audit state
→ inspect failure/cancel/budget-stop/retry paths
→ return to quiet without manufactured work
```

The first real V1 may support **read-only analysis plus owner review** and no external
action. If an execution form is selected, it must be explicitly named, internally
bounded, policy-governed, owner-approved, idempotent, auditable, and verified. External
execution remains out of V1 unless a later milestone specifically implements and proves
it. Canonical archive mutation likewise remains unavailable unless the exact protected
path is implemented and accepted.

V1 also requires:

- non-null policy and allowed model tier for every provider run;
- real server-side cost/usage accounting and atomic reservation or serialization;
- strict provider result/refusal/malformed-output handling;
- provider output linked to attributable findings rather than only generic steps;
- owner-scoped UI and MCP read surfaces that report unavailable foundations honestly;
- complete state transition, cancellation, expiry, budget, duplicate invocation, and
  approval replay evidence;
- no browser secret, no archive dump, no bypass of RLS/protected RPCs; and
- release evidence that separates source checks, database application, deployed Edge
  behavior, client/OAuth behavior, and authenticated production behavior.

## 25. Acceptance matrix

The following scenarios are acceptance checks for future slices. A status in source is
not a passing run; retain command/test/browser/deployment evidence for the exact build.

| Scenario                              | Required observable outcome                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal read-only analysis             | Selected owner scope produces a bounded evidence bundle; real provider result becomes an attributable interpretation/finding; no canonical or external write occurs. |
| Contradictory evidence                | Both material sides, provenance, scope, and uncertainty remain visible; no automatic adjudication.                                                                   |
| Superseded evidence                   | Historical material remains inspectable and is labeled as superseded/non-current where the source relationship supports that conclusion.                             |
| Partial or unavailable projection     | Withhold or label the reading; preserve excluded IDs/reasons and never treat projection absence as archive absence.                                                  |
| Model refusal                         | Persist a bounded refusal/blocked or unresolved result with no invented finding or mutation.                                                                         |
| Malformed provider output             | Strict schema/parse failure produces a safe failed result, accounts usage when safely known, and does not create a finding/proposal.                                 |
| Provider outage or timeout            | Safe failure and durable state/audit; retry policy stays bounded and idempotent.                                                                                     |
| Missing pricing                       | Provider is never contacted; run blocks with clear cost-pricing reason.                                                                                              |
| Budget exhaustion                     | Atomic guard prevents overspend, records budget stop, and keeps prior evidence inspectable.                                                                          |
| Cancellation                          | Owner cancellation stops eligible run states, records outcome, and never performs a queued action.                                                                   |
| Duplicate invocation                  | Same idempotency identity replays safely without duplicate run, step, cost, proposal, approval, or tool event.                                                       |
| Pending approval                      | Exact action hash, before/diff/after, policy and expiry are visible; execution pauses.                                                                               |
| Rejection                             | No mutation; run/proposal/approval/audit show the rejected outcome and new work requires a new action identity.                                                      |
| Approval replay                       | Only the still-valid, matching owner/case/run/policy/action hash can progress once; changed material requires a new gate.                                            |
| Unauthorized write attempt            | RLS/RPC/policy rejects it; audit/failure is inspectable without leaking protected data.                                                                              |
| Connector unavailable or schema drift | Return explicit unavailability/block, retain provenance/freshness, never return an empty archive masquerading as success.                                            |
| Archive isolation                     | A second owner cannot read, scope, approve, or mutate another owner's records/Custodian artifacts.                                                                   |
| Narrow/mobile UI                      | No horizontal overflow; visible focus and 44px controls; scope, evidence, failure, and gate remain understandable.                                                   |
| Quiet state                           | No qualifying signal produces no fake activity, counts, costs, health, or proposed work.                                                                             |

## 26. Release and public-readiness gate

Follow `docs/release-verification.md`; do not duplicate its whole procedure here. The
Custodian-specific additions for real provider execution are:

- exact commit, clean intended diff, branch/remote SHA proof, and no sensitive material
  in documentation, screenshots, logs, or test output;
- migration/RLS/function privilege and second-owner isolation proof for each changed
  table/RPC;
- verified hard-gate state when provider activation is not in scope, or verified removal
  only when the activation milestone is explicitly authorized;
- evidence of server-only key/pricing configuration without printing values;
- model-tier/policy, atomic budget reservation, pricing version, actual usage/cost,
  timeout, refusal, malformed response, failure, cancellation, idempotency, and audit
  proof;
- authenticated UI and MCP proof that clients cannot bypass owner authority and that
  unavailable boundaries tell the truth;
- exact allowed execution class, approval/action-hash verification, and no unauthorized
  mutation proof; and
- fresh production proof tied to the deployed commit. A green build, migration file, or
  local source inspection alone is not sufficient.

Public readiness additionally requires a privacy review of examples, fixtures, paths,
screenshots, generated artifacts, and documentation. Do not copy private archive data
into release notes.

## 27. Source map, decision ledger, and revision criteria

### Durable source map

| Area                        | Authoritative/supporting paths                                                                                                                                                                                                       | Role                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Canonical program           | `docs/custodian-program.md`                                                                                                                                                                                                          | This document.                                                                        |
| First-run readiness         | `docs/custodian-first-run-readiness.md`                                                                                                                                                                                              | Source-complete vs remaining live proof for one bounded read-only run. M4D source is not activation. |
| Visual authority            | `docs/design/light-archive-shell.md`                                                                                                                                                                                                 | Current whole-application visual constitution.                                        |
| Roadmap provenance          | `docs/design/custodian-roadmap.md`                                                                                                                                                                                                   | Supporting delivery history and existing provider gate.                               |
| Historical visual reference | `docs/design/custodian-design-system.md`, `design-qa.md`                                                                                                                                                                             | Retained dark/inverse language and historical QA, not the default visual authority.   |
| Release procedure           | `docs/release-verification.md`                                                                                                                                                                                                       | Reusable local/hosted/Supabase/Lovable/connector/production gate.                     |
| Backend procedure           | `docs/supabase-setup.md`, `docs/supabase-verification.md`                                                                                                                                                                            | Directly managed backend setup and verification distinction.                          |
| Cases and evidence          | `src/lib/custodian.ts`, `src/lib/custodian-types.ts`, `src/lib/case-reading.ts`, `src/lib/evidence-display.ts`, `src/components/custodian/`                                                                                          | Owner case contracts, bounded reading, display and source tests.                      |
| Runtime client              | `src/lib/custodian-runtime.ts`, `src/lib/custodian-readonly-run.ts`, `src/lib/custodian-runtime-types.ts`, `src/lib/custodian-approvals.ts`                                                                                            | Browser read boundary, closed readonly start, state machine, owner-gate decision client, budget/model/request contracts. |
| Frontend surfaces           | `src/routes/index.tsx`, `src/routes/inbox.tsx`, `src/routes/cases.index.tsx`, `src/routes/cases.$caseId.index.tsx`, `src/routes/run-room.tsx`, `src/routes/approvals.tsx`, `src/routes/observatory.tsx`, `src/components/custodian/approvals-surface.tsx`, `src/components/custodian/run-room-surface.tsx` | Current Desk, Inbox, Cases, inert Run Room, owner-gate Approvals, and scaffold Observatory. |
| MCP                         | `src/lib/mcp/index.ts`, `src/lib/mcp/capability-handlers.ts`, `src/lib/mcp/tools/`, `src/lib/mcp/security.ts`                                                                                                                        | Bounded archive/Custodian client surface and authentication.                          |
| Plugin guidance             | `plugins/the-excavatorium/skills/custodian/SKILL.md`, `plugins/the-excavatorium/.mcp.json`                                                                                                                                           | Client retrieval discipline and MCP endpoint metadata.                                |
| Provider runtime            | `supabase/functions/custodian-run/index.ts`, `supabase/functions/custodian-run/runtime.ts`, `supabase/functions/custodian-run/provider-attempt.ts`, their tests                                                                     | Closed-gate handler, pricing, and the unreachable one-attempt synthesis lifecycle.    |
| Core Custodian migrations   | `supabase/migrations/20260811190000_custodian_tables.sql` through `20260811190300_custodian_write_rpcs.sql`, plus `supabase/migrations/20260920090000_custodian_finding_attribution.sql`                                              | Case/analysis schema, indexes, RLS, write RPCs, and the M2 Finding attribution/materialization boundary. |
| Runtime migrations          | `supabase/migrations/20260811191000_custodian_runtime_tables.sql` through `20260811191200_custodian_runtime_rpcs.sql`                                                                                                                | Runtime/policy/approval/automation/audit foundation.                                  |
| Hardening and case scope    | `supabase/migrations/20260817163457_custodian_tool_policy_delete_guard.sql`, `supabase/migrations/20260822214714_harden_archive_and_custodian_boundaries.sql`, `supabase/migrations/20260904090000_custodian_case_archive_scope.sql`, `supabase/migrations/20260921140000_custodian_owner_gate.sql` | Policy, exact action, audit, cost hardening, selected archive scope, and the M3 owner-gate decision contract. |
| M4A provider budget hold    | `supabase/migrations/20260921180000_custodian_provider_budget_hold.sql`, `supabase/tests/database/custodian_provider_budget_hold.sql`                                                                                                      | Hold storage separate from factual usage, reserve/settle and fail-closed budget RPCs, explicit owner-policy bootstrap, and a server-built read-only snapshot. Not a provider call. |
| M2 database proof           | `supabase/tests/database/custodian_finding_attribution.sql`                                                                                                                                                                               | Deterministic structured-result, attribution, evidence, replay, RLS, automation-guard, and archive-isolation coverage. |
| Database tests              | `supabase/tests/database/custodian_case_archive_scope.sql`, `supabase/tests/database/harden_archive_and_custodian_boundaries.sql`, `supabase/tests/database/custodian_owner_gate.sql`, `supabase/tests/database/custodian_provider_budget_hold.sql` | Source-level pgTAP/database contract evidence; execution must be recorded separately. |

### Known gaps and deliberate deferrals

- Provider execution, paid calls, and live run controls remain **BLOCKED**. M4A is
  merged and stores the provider budget hold and server-built read-only run bootstrap.
  Settlement stays service-role only. M4B source can reserve, settle, and fetch once,
  but the production handler does not enter that path while
  `PROVIDER_EXECUTION_UNSUPPORTED` is true. M4C keeps the browser control closed.
  M4D is implemented in source: explicit owner inputs, one readonly policy, one
  persisted run, and a bounded `{ runId, invocationKey }` driver. The gates remain
  closed. The owner must still choose the model allowlist and numeric cost/token
  ceilings before activation; the policy RPC has no product-default tiers or ceilings.
  Secrets and pricing are not configured. Production activation, deployed concurrency
  proof, the first paid run, and M5 are not done. M4 is not complete, and production
  behavior is **UNVERIFIED**.
- Interactive Approvals exist as an owner decision surface; meaningful verification
  after execution and a selected internal V1 execution class still need implementation.
- External execution is intentionally unsupported; canonical writes are not implied by
  findings or proposals.
- A resident loop, live Observatory, active connector use, and connector-account UI are
  not established by their tables.
- Retention, the first allowed internal V1 execution class, and long-lived automation
  policy remain unresolved product/security decisions. M3 adds the owner gate and
  keeps execution unavailable. M2 adds source-level Finding provenance linkage but
  does not prove deployment or production behavior.
- Current source/test inspection does not prove migration application, Edge deployment,
  live OAuth, production RLS, or provider behavior.

Revise this program when a reviewed change alters the authority split, lifecycle,
status vocabulary, scope limits, data contract, model/cost/policy boundary, execution
class, visual constitution, public-data policy, or V1 acceptance condition. A revision
must cite the live paths/evidence that changed, classify any new production claim, and
move a capability from BLOCKED/PARTIAL to CURRENT only when the relevant implementation
and verification evidence actually support it.
