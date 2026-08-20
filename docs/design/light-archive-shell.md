# Light archive shell

This document is the authoritative whole-application visual constitution for
The Excavatorium. It supersedes the global dark-shell direction recorded in
[The Custodian design system](./custodian-design-system.md) while preserving
that file and [Custodian design QA](../../design-qa.md) as historical
provenance.

The selected direction combines a grouped near-black structural shell, a
spacious light archival workspace, and an evidence-reading treatment for
records. The archive remains authoritative; the Custodian remains an
attributable and replaceable interpreter.

## Design principles

- Light-first means warm archival ivory and paper-white reading surfaces, not
  a featureless white application.
- Near-black is structural: navigation, command framing, and inverse boundary
  panels.
- Brass and gold mark provenance, selection, numbering, seals, and fine rules.
- Muted burgundy is reserved for deliberate primary actions, active
  navigation, or consequential state.
- Desaturated green indicates verified or archive-ready state.
- Ledger rows, crisp dividers, and generous whitespace replace generic
  dashboard cards and decorative density.
- Real data, explicit uncertainty, and truthful empty states outrank visual
  theatre.

## Shell architecture

The permanent desktop sidebar is near-black and groups only routes already
present in the application:

| Group    | Routes                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Work     | Custodian Desk (`/`), Inbox (`/inbox`), Cases (`/cases`)                                                         |
| Records  | Archive (`/archive`), Conversations (`/conversations`), Documents (`/documents`), Repositories (`/repositories`) |
| Judgment | Decisions (`/decisions`), Graph (`/graph`), Timeline (`/timeline`)                                               |
| System   | Tools (`/tools`), Search (`/search`), Settings (`/settings`)                                                     |

Grouping changes presentation, not destinations or authorization. Hidden or
scaffold routes are not promoted merely because they exist.

The main workspace is warm ivory, spacious, and ruled as a continuous archival
ledger. A light right inspector owns provenance, scope, selection, boundary,
verification time, and status without competing with the reading surface.
Near-black inverse panels are reserved for Custodian interpretation, refusal,
security, code, and execution boundaries.

The top command surface retains `Command the archive...` and one deliberate
burgundy `New capture` action. Renaming that visible action must not change its
underlying destinations or mutations.

## Record-reading view

Record detail treats source evidence and interpretation as different classes
of information:

- the evidence excerpt is visibly source truth;
- provenance, scope, exclusions, and truncation remain inspectable;
- current, superseded, conflicting, and uncertain states are first-class;
- `Custodian's Reading` appears in a separate inverse panel labeled
  `Interpretation - Not source truth`;
- model output never becomes canonical archive truth automatically;
- consequential proposals show exact intended changes and wait for explicit
  owner review.

Queue or record navigation may remain visible where it helps orientation, but
the reading surface must not become a stack of nested cards.

## Mobile shell and Inbox

Mobile uses a compact near-black header, a warm ivory body, and the existing
five-slot bottom navigation. Preserve safe-area padding and route behavior.

Inbox is progressive:

```text
01 Capture -> 02 Review -> explicit Save to Inbox
```

- Use truthful copy such as `Continue to review` before persistence.
- Mark local material as `Not yet in the archive` or an equivalent provisional
  state.
- Do not render an empty Review candidate before a candidate exists.
- Keep Saved Inbox and lifecycle filters separate from local capture.
- Back preserves the local draft; only a successful save clears it.

## Visual language

- Retain Libre Caslon Text for archival titles and Geist for controls and body
  text; monospace is reserved for identifiers, states, and machine evidence.
- Use 4-8 px radii, minimal shadows, and crisp rules.
- Preserve dark values for inverse panels and a possible future reviewed dark
  mode; do not make them the default page ground.
- Avoid gradients, glass effects, purple AI glow, generic metric cards, cards
  inside cards, tiny unreadable uppercase labels, and ornamental activity.
- The Custodian portrait belongs only on onboarding, About, or a deliberate
  empty state. It is not an operational avatar or wallpaper.

## Interaction and accessibility

- Preserve all current routes, queries, mutations, authentication, command
  behavior, and owner scoping.
- All visible touch controls are at least 44 by 44 CSS pixels.
- Keyboard focus remains visible on every surface.
- Command and capture flows work by keyboard and pointer.
- Narrow layouts have no horizontal overflow.
- Motion stays within 140-220 ms and nonessential movement is disabled by
  `prefers-reduced-motion`.
- Color never carries essential state alone; reinforce it with text, icons,
  borders, or labels.
- Loading, empty, blocked, offline, and error states say what is known without
  inventing counts, costs, models, findings, approvals, or agent activity.

## Truth and security boundaries

- The archive is authoritative; the Custodian is replaceable.
- Retrieval is narrow, bounded, owner-scoped, and project-scoped.
- Return a context bundle, not an archive dump.
- Provenance follows every record and interpretation.
- Refusal is a designed and useful outcome.
- Security and write authority are enforced server-side.
- Provider execution and paid model calls stay disabled until the separate
  gates in the [Custodian roadmap](./custodian-roadmap.md) are approved and
  verified.

Implementation proceeds in small reviewable slices. Global light-token changes
can reskin every route, so audit routes before changing root tokens and prove
desktop and narrow-mobile behavior before declaring the shell accepted.
