# Night Crypt

The original spec and the task brief are kept outside the repository. The spec text below is the copy in this document. A personal name in the spec's opening sentence was omitted from this copy.

`src/styles.css` is what ships. This document does not change those values. Where the spec and the stylesheet disagree, the disagreement is listed under [Drift from source](#drift-from-source) and neither side is silently edited.

## Palette

| Token | Hex | Role |
|---|---|---|
| grave-night | `#11131B` | Page background |
| vault-stone | `#1B1E29` | Panels, cards, inputs |
| vault-deep | `#151823` | Header, sidebars, niche |
| mortar | `#2E3345` | Hairlines, dividers |
| mortar-strong | `#474D63` | Control borders, rings |
| moonbone | `#F1EAD9` | Primary text |
| mist | `#C4BFD0` | Secondary text |
| ash | `#948FA6` | Tertiary text, ≥14px only |
| candlelight | `#F2B857` | Primary actions, active nav, "current" |
| candle-ink | `#1A1408` | Text on candlelight buttons |
| ember | `#EF7A68` | Uncertain / risk |
| spectre | `#BBA6F7` | Conversations, open loops |
| moonwater | `#8EBCF2` | Repositories |
| parchment | `#E6CC9C` | Documents |

Night Crypt is the default theme. No green anywhere. One lantern glow per screen, max.

## Type

- **IM Fell English**: page headings (roman) and every Custodian line (italic). Nothing else.
- **Alegreya Sans** 400/500/700: all interface text. Body 16–18px.
- No monospace all-caps eyebrow labels, no `→` appended to links, no `A · B · C` meta strings.

## Icons

The 22 glyphs are inlined in `src/components/crypt-icon.tsx` (`CRYPT_GLYPHS`), and that file is the source of truth. They are a 24×24 grid, 1.6 stroke, `currentColor`. `CryptIcon` takes a typed `glyph` union; icons are decorative (`aria-hidden`) next to visible text; icon-only buttons need `aria-label`.

| Meaning | Glyph |
|---|---|
| Home | lantern |
| Archive | crypt |
| Investigations | key |
| Review | seal |
| Capture | shovel |
| Search | search |
| Timeline | hourglass |
| Connections | chains |
| Edit | quill |
| Export | urn |
| More/settings | hood |
| Decision | gravestone (candlelight) |
| Conversation | ghost (spectre) |
| Document | scroll (parchment) |
| Repository | chest (moonwater) |
| Tool | pickaxe (moonbone) |
| Current / Active | candle (candlelight) |
| Open loop | coffin (spectre) |
| Uncertain | skull (ember) |
| Awaiting verdict | hourglass (mist) |
| Superseded / Reversed | toppled (ash) |
| Buried / Archived | mound (ash) |
| Decorative | raven |

## The Custodian

- `public/character/custodian-cutout.webp` (473×1200, transparent): full figure, cut out of the canon sheet's parchment. Only appears inside the **arched niche** on Home and empty states — stone frame, raven above, plinth with his name between two candles. Never free-standing.
- `public/character/custodian-portrait.webp`: hooded skull close-up. Circle portrait (object-position 60% 30%) wherever he speaks: Archive, record reading, Findings, Capture, mobile Home.
- `public/character/custodian-lantern.webp`: lantern panel, arched on Capture and in "Examine again".
- All three live in `public/character/` and are regenerated from `public/character/00-custodian-canon.png` by `docs/design/night-crypt/cut-custodian.py`. From the repository root:

```text
python docs/design/night-crypt/cut-custodian.py public/character/00-custodian-canon.png public/character
```

## Voice

The Custodian speaks in narration only, in a restrained dark-fantasy cadence: archaic, terse, never jokey. Buttons, costs, errors, scopes and warnings stay plain ("Create editable draft", "Never more than $1.00 a run"). Advanced / Run Room stays technical on purpose.

Sample lines from the canvas:

- Home: "Ah… the lantern stirs. You have returned, and the dust has not been idle."
- Archive: "Forty-seven remains, catalogued. None forgotten — only unread." (count must be live)
- Record: "Set aside, yet it still bears witness to what came after. I have not read it. Bid me, and I shall."
- Capture: "Lay the transcript before me. I will draw out what matters — and bury nothing without your word."

## Screen rules

- **One shell** for every route: 72px header (lantern + wordmark, icon+label nav, hood "More" button, candlelight Capture), one page-header pattern, one content width.
- **Home**: Custodian niche left; greeting; search; "What stirs tonight" grouped attention tiles (group identical reasons into one tile with a count); "The chambers" = per-kind counts with icons; two secondary actions.
- **Archive**: chambers sidebar with icons and live counts; standing filter chips with icons; single-line rows = kind icon ring, title, kind, standing icon + label, date.
- **Record**: big kind icon ring; standing / confidence / date chips with icons; "was replaced by" chain when superseded; Why / Trigger / What would change my mind with icons; Custodian's reading panel (readable contrast!); "Bound to" links with kind icons; provenance behind a disclosure.
- **Investigation**: four-step trail (Question → Evidence → Examined → Your judgment); Finding with portrait, voice line, four icon tiles (Uncertain / Missing / Would change / Look again); run panel with key, model and cost cap in plain words.
- **Capture**: two big mode cards (Excavate / Write by hand); icon flow (paste → Custodian drafts → you edit → you save).
- **Dates**: one format everywhere, `22 Sep 2026`.

## Drift from source

Compared with `src/styles.css` on 2026-10-09. The fourteen named palette hexes above match the stylesheet; only letter case differs (`#11131B` and `#11131b` are the same color). The items below are the disagreements. `src/styles.css` remains the shipped values.

### Tokens and hex values present only in the stylesheet

| Token or value | In `src/styles.css` | In this spec |
|---|---|---|
| `--vault-raised` | `#232735`, used for `--secondary`, `--accent`, and `--record-hover` | Not named |
| `--burgundy-muted` | `#4a3b22`, used as the text-selection background | Not named |
| `.custodian-niche-well` base | `#0c0e14` | Not named. The spec assigns the niche to vault-deep `#151823` |
| Radius | `--radius: 4px`; sm `2px`, md `4px`, lg `6px`, xl `8px` | Not specified |

`--ash: #948fa6` matches the spec hex and is declared in the stylesheet, and no rule in that file references `var(--ash)`.

### Role mappings that differ

- **vault-stone.** The spec includes inputs. The stylesheet maps `--card` and `--popover` to vault-stone, and maps `--input` to `--mortar-strong`.
- **mortar-strong.** The spec assigns control borders and rings. The stylesheet maps `--ring` to candlelight. `--input`, `--strong-border`, and `--brass-muted` use mortar-strong. `--border` uses mortar.
- **vault-deep.** The spec includes the niche. The stylesheet maps `--sidebar`, `--muted`, and `--canvas` to vault-deep. The niche well uses `#0c0e14` instead.
- **moonwater.** The spec role is repositories. The stylesheet also maps `--verified` and `--success` to moonwater. `--graph-repository` is moonwater.
- **candlelight.** The spec role is primary actions, active navigation, and "current". The stylesheet also maps `--brass`, `--burgundy`, `--luminous-gold`, `--warning`, and `--graph-decision` to candlelight. `--primary` and `--ring` are candlelight as well.
- **Lantern glow.** `.custodian-niche-well` uses `rgb(242 184 87 / …)`, which is candlelight `#F2B857`. The well's second color, `#0c0e14`, is the extra value above. The stylesheet defines that one glow and does not encode "one glow per screen."

### Type rules that differ

- The italic IM Fell English face is imported (`@fontsource/im-fell-english/400-italic.css`). No selector in `src/styles.css` sets `font-style: italic`, so the spec's "every Custodian line (italic)" rule is not in the stylesheet. Headings `h1`–`h4` do use the roman serif face at weight 400.
- The spec forbids monospace all-caps eyebrow labels. `.custodian-table th` sets `font-family: var(--font-mono)`, `text-transform: uppercase`, `letter-spacing: 0.12em`, and `font-size: 0.625rem`. `.custodian-risk-label` also uses the mono face, without uppercase.
- The stylesheet adds fallbacks the spec does not name: serif `"Iowan Old Style", Georgia, serif`; sans `ui-sans-serif, system-ui, sans-serif`; mono `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Alegreya Sans 400/500/700 are the faces the stylesheet imports for `--font-sans`.
