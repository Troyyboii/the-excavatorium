# Custodian design QA

> [!NOTE]
> This is a historical QA record for the earlier dark Custodian Desk. It is not
> current production proof and does not govern the whole application. Use
> [Light archive shell](docs/design/light-archive-shell.md) for the visual
> constitution, [Custodian roadmap](docs/design/custodian-roadmap.md) for the
> implementation sequence, and
> [Release verification](docs/release-verification.md) for live acceptance.

## Result

**Historical result: Passed.** No unresolved P0, P1, or P2 visual defects were
recorded for that local build.

## Evidence

The earlier QA session referenced the evidence filenames below. They must not
be treated as current inspectable artifacts or production evidence unless the
referenced files and live state are reverified.

- Design source: `docs/design/custodian-desk-concept.png` (1672 x 941)
- Final desktop render: `07-desk-white-gold-final-desktop.png` (1425 x 990 browser capture at a 1440 x 1000 test viewport)
- Combined comparison: `09-custodian-concept-vs-white-gold-final.png`
- Mobile render: `04-custodian-desk-mobile.png` (375 x 811)
- Browser method: authenticated Codex in-app browser against `http://localhost:4174/`
- Console errors: none during the final desktop check
- Overflow: no horizontal overflow at the final desktop viewport

The source and implementation are the same Custodian Desk state but not pixel-identical source dimensions, so the comparison is an overview rather than a pixel-diff. Both panels are normalized to the same display width in the combined image.

## Comparison findings

1. **Information hierarchy:** The implementation preserves the concept's three-part hierarchy: fixed navigation, dense operational workspace, and persistent Custodian state rail.
2. **Palette:** The final build strengthens the intended white-gold intelligence layer. Primary headings and values use white-gold, provenance and navigation signals use luminous gold, and burgundy remains reserved for active/risk/action states.
3. **Density:** The concept's compact evidence-led layout is retained. The live archive table uses real records instead of filling the screen with invented agent activity.
4. **Typography:** Serif display headings and compact uppercase metadata remain consistent with the archive identity. Body copy is brighter and more legible than the initial sepia pass.
5. **Structure:** Gold keylines now carry the shell, command bar, table header, focus controls, and right rail without introducing gradients, glows, or decorative card stacks.
6. **State clarity:** Operational state, model selection, approvals, and execution authority are explicit text values rather than color-only signals.
7. **Responsive behavior:** The mobile capture confirms the shell collapses into a usable narrow layout; the later white-gold pass changed shared color tokens and component emphasis, not responsive geometry.

## Interaction checks

- Primary navigation routes open the intended Custodian surfaces.
- The command bar opens from both the visible control and keyboard shortcut.
- Inbox and Cases expose honest foundation-pending states until the owner applies the migrations.
- No interaction silently mutates the canonical archive.
- Reduced-motion rules remain in the shared stylesheet.

## Copy differences from the concept

- The concept uses illustrative case queues, costs, approvals, and agent state.
- The implementation deliberately replaces those invented operational values with authenticated archive counts and explicit `None selected`, `Foundation pending`, and `Owner-gated` states.
- `Operational Brief` becomes `Archive ready` where the live build can verify archive data but cannot yet verify unapplied Custodian tables.

## Iterations completed

- Increased foreground contrast and separated white-gold from luminous-gold roles.
- Strengthened structural gold borders and selected navigation treatment.
- Brightened metadata and table labels while keeping the archive black dominant.
- Removed remaining hard-coded component color literals in the Custodian surfaces.
- Compared the final render directly with the design source and retained the real-data differences intentionally.
