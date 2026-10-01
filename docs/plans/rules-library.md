# Plan: System rules library

**Status**: Design agreed; VtM 5e core split into column files (T001). No backend code yet.
**Date**: 2026-10-01. **Mode**: default, with user direction.
**Request**: Store whole rulebooks per game system so the GM AI can search them, using one row per system with generic JSON columns and a mapping column that tells the AI where things are.

## Summary

Each game system (for example "Vampire: The Masquerade 5th Edition") is **one row** in `rule_systems`. The row holds the system's books split into a fixed set of generic JSON columns (`core_rules`, `lore`, `abilities`, …) that fit any RPG. A small `mapping` column describes what each column means in this system, how its keys are laid out and what each field means. The AI reads `mapping` first, then searches or reads paths through a few backend tools. It never writes SQL.

The text stored is the book's original wording, so the AI searches and quotes the source itself. Summaries exist only to help locate things and are never the authority for a ruling.

This library is per system, not per campaign. It is separate from the existing per-campaign `source_chunks`. A campaign points at the system it uses.

## Table

```sql
rule_systems
  id            uuid PRIMARY KEY
  system_name   text NOT NULL       -- "Vampire: The Masquerade 5th Edition"
  sources       jsonb NOT NULL      -- imported books: title, slug, file sha256, page count, converter version
  core_rules    jsonb NOT NULL      -- mechanics: dice, tests, conflict, damage, advancement, condition tracks
  lore          jsonb NOT NULL      -- setting, factions, history, in-world fiction
  archetypes    jsonb NOT NULL      -- classes / races / clans / callings
  abilities     jsonb NOT NULL      -- spells, powers, feats, disciplines, rituals
  traits        jsonb NOT NULL      -- attributes, skills, merits, flaws, backgrounds
  items         jsonb NOT NULL      -- weapons, armor, gear, equipment
  creatures     jsonb NOT NULL      -- NPCs, monsters, antagonists, stat blocks
  procedures    jsonb NOT NULL      -- step-by-step flows: character creation, group creation
  glossary      jsonb NOT NULL      -- terms and short definitions
  gm_guidance   jsonb NOT NULL      -- running the game, setting design, safety tools
  others        jsonb NOT NULL      -- anything that fits nowhere else
  mapping       jsonb NOT NULL      -- how to find things in all of the above
  updated_at    timestamptz NOT NULL DEFAULT now()
```

Column names are fixed for every system and a column the system does not use stays `{}`. The list of column names is a backend-owned constant, not a string repeated across services.

`campaigns` gains a reference to the system it uses (in a new migration; existing migrations are immutable).

## Node shape (same in every column)

Each column is a tree of nodes keyed by a stable slug:

```json
{
  "auspex": {
    "name": "Auspex",
    "aliases": [],
    "pages": [249, 256],
    "source": "vtm5e-core",
    "text": "<original book text, verbatim>",
    "summary": "<derived; for locating only>",
    "review": "extracted | verified",
    "fields": { "type": "...", "masquerade_threat": "..." },
    "children": { "heightened_senses": { "...": "same shape" } }
  }
}
```

- `text`: verbatim source. Searched and quoted.
- `summary`: generated after the split; marked derived; never used for rulings.
- `fields`: system-specific values for exact lookups (level, cost, dice pool, damage).
- `children`: nesting (chapter → section, discipline → power, group → creature).
- Tables live in the node that explains them, as `fields.table: {columns, rows}`.
- Paths are dotted keys: `abilities.auspex.children.heightened_senses`.

## Mapping column

Small (a few KB), read first by the AI. Per column: what it means in this system, the path layout, field meanings and search hints; plus a `terms` map from generic vocabulary to columns (`"spell": "abilities"`, `"class": "archetypes"`, `"monster": "creatures"`).

The path layout and field lists are generated from the stored columns so they cannot drift. Only `means` and `search_hint` lines are hand-written.

## AI tools

| Tool | Returns |
| --- | --- |
| `rules_map(system)` | The `mapping` column. |
| `rules_search(system, query, columns?)` | Matching paths with name, pages and a short snippet; not whole nodes. |
| `rules_get(system, path)` | One node's full `text` and `fields`, without its children's text. |
| `rules_list(system, path, filter?)` | Child names and fields only, optionally filtered on fields. |

Search inside the single row uses `jsonb_path_query` over node strings; a generated `tsvector` per column (`jsonb_to_tsvector('simple', column, '["string"]')`) can pre-check a column. Loading a column into memory and searching it in the app is an acceptable alternative for a local app. Tool results stay bounded.

## Import pipeline

1. **PDF → Markdown**: `D:\projects\markitdown\scripts\pdf_to_md_plus.py` with heading fixes and layout/table overrides (checked against page images). `verify_against_hocr.py` checks word loss, mid-paragraph mixing and paragraph order against the PDF text layer and archive.org's independent hOCR layout.
2. **Markdown → column files**: a per-book outline (structure only: anchors, target column and path) drives `D:\projects\markitdown\scripts\split_by_outline.py`, which writes one Markdown file per column. Headings in the column files are node boundaries and each carries a node comment with dotted path, PDF pages and printed pages. Page markers stay inline. Book-derived files live next to the book, never in this repository (VtM: `G:\My Drive\stuff\GamesPdf\vampire\data_book\`: `VtM_5e_Rulebook.outline.json` and `columns\<column>.md`).
3. **Coverage check**: the splitter fails unless every body line of the book Markdown lands in exactly one column file or an explicitly dropped node (converter contents, table of contents, index, back cover).
4. **Field extraction** per column (disciplines first). Each extracted value must appear in its node's `text`; otherwise the node stays `review: "extracted"`.
5. **Summaries**, then **mapping** generation.
6. **Import** the column files into the row; a later book of the same system merges into the same row with its own `source`.

## Accuracy rules

- Verbatim `text`, `pages` and `source` on every node; answers cite pages.
- Rulings come from `text`, never from `summary`.
- `sources` records each file's hash and converter version so a re-import shows what changed.
- Book text and column files stay outside the public repository; only code and structure-free tooling are committed.

## Trade-offs accepted

- One row per system is a few MB; Postgres stores it out of line.
- Editing a node rewrites that column; imports and edits are rare compared to reads.
- A wrong `mapping` path misleads the AI, hence generating it from the data.

## Tasks

- [x] T001 VtM 5e outline file and `split_by_outline.py`; column files with coverage report. Evidence (2026-10-01): 4,923 body lines placed once each; 596 nodes across 11 columns; paragraph-order check against hOCR reviewed page by page, remaining disagreements are hOCR's own order (sidebars, list columns, lexicon), checked on the page images.
- [ ] T002 Field extraction for `abilities` with the value-in-text check.
- [ ] T003 Field extraction for `archetypes`, `traits`, `items`, `creatures`. Loresheet levels are printed as red dots the OCR does not capture: entries appear in level order 1–5 (column-major reading), confirmed by counting the dots on the page images; extraction sets `fields.level` from that and must not infer it from text.
- [ ] T004 Summaries.
- [ ] T005 Mapping generation.
- [ ] T006 Migration for `rule_systems` and the campaign reference.
- [ ] T007 Importer from column files.
- [ ] T008 The four AI tools within the bounded-context and provider-isolation rules.
