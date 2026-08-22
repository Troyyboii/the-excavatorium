# Custodian roadmap

This roadmap turns the visual constitution in
[Light archive shell](./light-archive-shell.md) into a bounded evidence product.
It reuses the existing archive, cases, findings, run contracts, and connector
surface instead of introducing a second backend.

## Product contract

The target owner-reviewed flow is:

```text
question + selected scope
-> bounded evidence bundle
-> attributable Custodian reading
-> uncertainty and findings
-> explicit owner review
```

Archive evidence and Custodian interpretation remain visually, structurally,
and operationally separate. Interpretation does not mutate canonical records
or become source truth automatically.

## Current foundation

The repository already contains:

- five canonical record types and links;
- owner-scoped Inbox, case, finding, approval, and run contracts;
- bounded context and safe-projection helpers;
- a persisted read-only Run Room;
- an Excavatorium connector with read-oriented archive and Custodian tools;
- explicit provider-disabled boundaries in the browser and Edge Function.

Availability is not inferred from source. Each release must verify the connected
Supabase foundation, authenticated owner reads, connector authorization, and
production behavior using the [release gate](../release-verification.md).

## Phase 1 - light archive shell

Implement one reviewable shell slice before redesigning individual features:

1. Introduce light-first semantic tokens while retaining dark inverse-panel
   values.
2. Group the existing desktop navigation into Work, Records, Judgment, and
   System.
3. Add the ivory workspace and light provenance/boundary inspector treatment.
4. Apply the evidence-led ledger treatment to Custodian Desk using real current
   data and truthful states.
5. Preserve the five-slot mobile navigation, safe areas, command behavior, and
   capture actions.

Acceptance requires route parity, no data-flow change, desktop and narrow-mobile
proof, no horizontal overflow, 44 px controls, keyboard focus, contrast,
reduced motion, and no invented activity or statistics.

## Phase 2 - bounded evidence interface

Build the question and scope surface over existing records and cases:

- the owner chooses a question, case, and bounded working set;
- retrieval produces a size-limited evidence bundle with record identifiers,
  provenance, exclusions, and truncation;
- the Custodian reading is attributable and labeled as interpretation;
- claims and findings cite their supporting records;
- uncertainty, conflicts, superseded material, and refusal remain visible;
- the owner can leave and return to inspect persisted run state.

Stop at a provider-ready, read-only evidence system. Do not fake a model run or
add a second persistence path.

## Phase 3 - owner review and proposals

After read-only evidence behavior is proven:

- proposals show exact before and after changes;
- acceptance is explicit and owner-scoped;
- rejection and cancellation make no archive mutation;
- every write-capable operation pauses for approval;
- approved artifacts use existing reviewed RPC and run contracts;
- retry and resume behavior is idempotent and auditable.

Character voice must never hide evidence, uncertainty, failure, cost, or the
exact proposed action.

## Phase 4 - connector alignment

Keep connector work bounded and observable:

- align installed discovery with the reviewed repository manifest;
- preserve safe record projection and bounded context limits;
- verify fresh OAuth or consent where required;
- return clear errors for stale tokens, missing scopes, and unavailable
  foundations;
- keep reserved run-control tools as explicit unavailable boundaries; expose
  write-capable run control only after a security review decides it remains
  appropriate.

Release notes report connector success or failure shapes without copying
private records or counts.

## Separate future phase - provider activation

Provider execution is not part of the shell or read-only evidence phases. It
remains blocked until all of the following are implemented and verified:

- `agent_runs.tool_policy_id` is mandatory and non-null;
- allowed model tiers are explicit;
- exact per-run and cumulative token, cost, latency, and tool-event ceilings
  are enforced;
- concurrent provider calls reserve or serialize the same run budget before
  any paid request;
- retries, duplicate invocation, interruption, and resume are idempotent;
- write-capable tools always pause for owner approval;
- refusal, failure, budget stop, and cancellation are durable and inspectable;
- evidence and usage are auditable without exposing secrets;
- the first paid run receives separate explicit authorization.

Until then,
[`CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER`](../../src/lib/custodian-runtime.ts)
must remain `false` and
[`PROVIDER_EXECUTION_UNSUPPORTED`](../../supabase/functions/custodian-run/index.ts)
must remain `true`.

## Delivery discipline

- Use one coherent `codex/` branch per reviewed slice.
- Inspect live state before changing it and preserve unrelated work.
- Do not combine shell, database, provider, OAuth, and archive-mutation changes.
- Run the narrowest tests first, then the full local and hosted gates.
- Inspect the complete diff and verify the exact published commit.
- Roll back with a new reviewed commit; never rewrite published history.
- Require separate authorization for commit, push, pull request, merge,
  publication, Supabase changes, provider activation, and handoff deletion.

The historical dark-shell record remains in
[The Custodian design system](./custodian-design-system.md); it supplies inverse
panel and provenance context but no longer governs the whole application.
