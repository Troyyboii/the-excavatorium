# Core Archive Redesign — design QA

> [!IMPORTANT]
> **HISTORICAL.** This is ivory-era visual QA. Night Crypt is the current and
> only visual language. See [Night Crypt](./docs/design/night-crypt.md).

## Result

**Blocked.** The authenticated local implementation was inspected at desktop, mobile portrait, and mobile landscape sizes, but the required final source-and-implementation comparison could not be opened as one browser input. The in-app Browser's URL security policy rejected the local comparison document, so this run cannot claim a completed visual comparison.

## Evidence inspected

- Selected Concept 1 source: local Codex artifact (not in repository)
- Desktop graph: local Codex artifact (not in repository)
- Desktop Desk: local Codex artifact (not in repository)
- Desktop Archive: local Codex artifact (not in repository)
- Desktop Timeline: local Codex artifact (not in repository)
- Graph mobile portrait: local Codex artifact (not in repository)
- Graph mobile landscape: local Codex artifact (not in repository)

## Verified implementation behavior

- Desktop uses the selected dark grouped navigation, ivory workspace, brass provenance, and burgundy action/selection hierarchy.
- The former permanent static status rail is absent. Graph owns a selected-record inspector; Desk owns its operational boundary panel.
- Graph search selected a real record and synchronized `record=<uuid>` in the URL.
- Record-type filters serialized a sorted `types=` parameter and returned to an omitted parameter when all types were active.
- Map/Links switching synchronized `view=map|links`; keyboard node selection, zoom, reset, selected-record inspector, direct-neighbor list, and Open Record were exercised.
- Mobile portrait Previous/Next selection changed the record URL; the Details sheet opened and closed. Page width remained bounded (`scrollWidth <= innerWidth`).
- Mobile landscape exposed the wider graph canvas with no document-level horizontal overflow.
- Archive showed exactly five persisted record classes with real counts and latest-update dates.
- Timeline grouped events by numeric date and its created/updated filter was exercised.
- Browser-visible dates used `DD/MM/YY` and `DD/MM/YY, HH:mm`; no Croatian month abbreviations were present.

## Remaining visual gate

Create and inspect one permitted comparison input containing the selected Concept 1 source and the final desktop implementation at matched scale. Until that single-input comparison is inspected, the Product Design visual QA result remains blocked even though the responsive implementation checks above passed.
