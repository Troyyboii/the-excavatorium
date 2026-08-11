# The Custodian design system

The visual source of truth is
[custodian-desk-concept.png](./custodian-desk-concept.png). It extends the
existing Excavatorium rather than replacing its dark archival identity.

## Palette

| Role            |     Value | Use                                                    |
| --------------- | --------: | ------------------------------------------------------ |
| Archive black   | `#100F0D` | Page and navigation ground                             |
| Raised archive  | `#191714` | Dense working surfaces                                 |
| Warm foreground | `#FAF6EA` | Reading text and high-confidence values                |
| White-gold      | `#F7EBC8` | Active intelligence, selected evidence, primary values |
| Luminous gold   | `#E2C477` | Focus, provenance paths, verified state                |
| Muted brass     | `#8A724C` | Dividers, dormant metadata, inactive provenance        |
| Burgundy        | `#852F43` | Contradiction, consequential action, unresolved risk   |

Warm foreground is neutral context, white-gold is the focal reading layer,
luminous gold is selected or verified evidence, and burgundy is alert or
consequential state. Essential values stay legible without relying on color
alone; icons, labels, borders, and text reinforce each state.

## Structure

- A compact left rail owns navigation and archive creation.
- The centre is an open working surface made of ruled rows, tables, and
  evidence traces rather than a grid of generic cards.
- A right operational rail exposes only verified Custodian state.
- On narrow screens the rails become drawers or inline sections; the working
  surface remains the primary reading order.
- Serif typography carries titles and judgments. Sans-serif text carries
  controls and metadata. Monospace is reserved for identifiers, states, and
  machine evidence.

## Interaction

- `Ctrl+K` or `Cmd+K` opens the command bar.
- Focus rings use luminous gold and remain visible against every surface.
- State transitions run for 140-220 ms.
- Provenance may animate only while evidence is actively assembled.
- `prefers-reduced-motion` disables nonessential movement.
- Empty surfaces state what data or migration is missing. They never invent
  counts, model names, costs, approvals, or scheduled work.

## Custodian presence

The Custodian is a stateful operational rail, not a chat persona. Supported
states are `Dormant`, `Observing`, `Retrieving`, `Synthesizing`,
`Awaiting approval`, `Executing`, `Verifying`, `Complete`, `Blocked`, `Failed`,
`Expired`, and `Budget stopped`.

No avatar, typing theatre, fake emotion, motivational copy, or decorative
three-dimensional graph is permitted.
