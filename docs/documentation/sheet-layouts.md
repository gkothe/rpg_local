# Character sheet layouts

A sheet layout tells the app how to draw a rule system's character sheets. It is display-only: it never changes a character, a rule revision or content hash, and it is never sent to the GM. Each rule system stores one layout.

Character sheets are free-form JSON (`attributes`, `inventory`, `description`), and their shape differs per rule system. The app therefore renders in two layers:

1. **Base layer (no layout needed).** Numbers render as plain numbers, nested objects as titled groups, string arrays as tags, objects with a `name` as item cards, and long text (140 characters or more) as prose. The base layer never draws dots or bars, because a number alone does not say whether it is a 0–5 rating, a percentile or hit points.
2. **Layout hints.** A layout lists per-field hints that upgrade a field to a specific widget. A hint that does not fit the value (for example `dots` on a string) falls back to the base layer and shows a muted "layout hint does not fit this value" note. A widget id this app version does not know also falls back to the base layer.

## Choosing a layout after importing a book

An agent can do this for each new rule system:

1. Read this document.
2. Fetch the served widget list and limits from `GET /api/rule-systems/:id` (`sheetLayoutOptions`). That response is the source of truth if it differs from this document.
3. Read one or two real characters of that system, for example from `GET /api/campaigns/:id` (the `attributes`, `inventory` and `description` objects), and decide per field what it is: a rating with a fixed maximum, a current/maximum pair, a percentile, a score with a modifier, a list of names, long text.
4. Write a layout that hints only fields whose meaning is clear from the rulebook. Leave everything else to the base layer.
5. Save it from the Rules page (system, "Sheet layout" panel) or with `PUT` on loopback (see below).
6. Open a campaign of that system, then Characters, and check the sheet.

Saving again replaces the whole layout. An empty layout, `{"fields":[]}`, returns the system to the base layer.

## JSON shape

```json
{
  "fields": [
    {
      "path": ["attributes", "skills"],
      "widget": "dots",
      "max": 5,
      "label": "Skills",
      "order": 10
    }
  ]
}
```

| Key            | Applies to                | Meaning                                                                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `path`         | every field               | Path from the character root. First segment is `attributes`, `inventory` or `description`. Up to 16 segments.      |
| `widget`       | every field               | One widget id from the table below.                                                                                |
| `label`        | optional                  | Text shown instead of the humanized key. 1–80 characters.                                                          |
| `order`        | optional                  | Integer 0–999. Hinted fields with an `order` come first, ascending; other fields keep their stored order.          |
| `max`          | `dots`, `checks`, `track` | Fixed maximum. See each widget.                                                                                    |
| `maxPath`      | `track`                   | Path to another value holding the maximum (for example `["attributes","hp","max"]`). Starts like any other `path`. |
| `modifierPath` | `score`                   | Path to the modifier value shown beside the score.                                                                 |

Every other combination of widget and parameter is rejected.

## Widgets

| Id           | Use it for                                                                       | Parameters                                         |
| ------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `number`     | A plain stat shown as a number.                                                  | none                                               |
| `dots`       | A small rating shown as filled dots (a 0–5 skill or attribute).                  | `max` required, integer 1–10                       |
| `checks`     | A count shown as ticked boxes (stress, uses, injuries).                          | `max` required, integer 1–20                       |
| `track`      | A current value against a maximum, drawn as a bar (hit points, willpower pool).  | exactly one of `max` (integer 1–1000) or `maxPath` |
| `percentile` | A 0–100 skill or characteristic (WFRP, Call of Cthulhu).                         | none                                               |
| `score`      | An ability score with an optional modifier (D&D).                                | optional `modifierPath`                            |
| `tags`       | A list of short strings (conditions, languages, talents).                        | none                                               |
| `items`      | A list of objects with a `name` (weapons, spells, gear).                         | none                                               |
| `prose`      | Long text such as a background or personality.                                   | none                                               |
| `facts`      | A labelled group of values as a compact list.                                    | none                                               |
| `hidden`     | A field that should not appear in the sheet view (it stays in the stored sheet). | none                                               |

## Path rules and resolution

- A hint applies to the value at its `path`. A hint on `["attributes","skills"]` with `dots` applies to every numeric child of `skills` that has no hint of its own.
- When several hints match a field, the deepest path wins. Hint `["attributes","skills"]` as `dots` (max 5) and `["attributes","skills","brawl"]` as `dots` (max 3) draws Brawl out of 3 and every other skill out of 5.
- Exact duplicate paths are rejected; nesting one path inside another is allowed.
- Hints never rename, move or change stored data. Sections the layout does not mention use the base layer.

## Limits

At most 200 fields, 32768 bytes of serialized JSON, labels of 1–80 characters and paths of up to 16 segments. The server also rejects reserved path segments (`__proto__`, `prototype`, `constructor`).

## Saving a layout

On the Rules page, open the system and use the "Sheet layout" panel. It shows the widget reference and the backend's validation errors.

From a coding agent on the same machine, use loopback and the client header. `requestId` is a new UUID per save and makes retries safe:

```bash
curl -X PUT http://127.0.0.1:4100/api/rule-systems/<system-id>/sheet-layout \
  -H "content-type: application/json" -H "X-RPG-Client: local-rpg" \
  -d @layout-request.json
```

Request body:

```json
{
  "requestId": "0b6a3f0e-8f6b-4c1d-9c1d-0d1f7f2a6b11",
  "sheetLayout": {
    "fields": [{ "path": ["attributes", "skills"], "widget": "dots", "max": 5 }]
  }
}
```

An invalid layout returns `422` with code `sheet_layout_invalid` and the path of each problem (`sheetLayout.fields.0.max`). Reusing a `requestId` with a different layout returns `409`. Saving never changes the rule system's revision or content hash.

## Examples

These layouts are illustrations of the pattern. Always compare them with the sheets you actually have: attribute names depend on how the character was entered.

### Vampire: The Masquerade

This is the layout used for a real VtM 5e campaign, whose characters store the nine attributes directly under `attributes` (`attributes.strength`, `attributes.wits`) and skills and disciplines as nested objects. Attributes, skills, disciplines and Hunger are 0–5 ratings; Humanity is 0–10. Health and Willpower are stored as a single number of boxes with no damage value, so they stay plain numbers: drawing `6` as dots out of 10 would wrongly read as "6 of 10". If your sheets also store damage (for example `health: {"max": 6, "superficial": 1}`), use a `track` instead.

```json
{
  "fields": [
    { "path": ["attributes", "strength"], "widget": "dots", "max": 5, "order": 10 },
    { "path": ["attributes", "dexterity"], "widget": "dots", "max": 5, "order": 11 },
    { "path": ["attributes", "stamina"], "widget": "dots", "max": 5, "order": 12 },
    { "path": ["attributes", "charisma"], "widget": "dots", "max": 5, "order": 13 },
    { "path": ["attributes", "manipulation"], "widget": "dots", "max": 5, "order": 14 },
    { "path": ["attributes", "composure"], "widget": "dots", "max": 5, "order": 15 },
    { "path": ["attributes", "intelligence"], "widget": "dots", "max": 5, "order": 16 },
    { "path": ["attributes", "wits"], "widget": "dots", "max": 5, "order": 17 },
    { "path": ["attributes", "resolve"], "widget": "dots", "max": 5, "order": 18 },
    { "path": ["attributes", "hunger"], "widget": "dots", "max": 5, "order": 20 },
    { "path": ["attributes", "humanity"], "widget": "dots", "max": 10, "order": 21 },
    {
      "path": ["attributes", "health"],
      "widget": "number",
      "label": "Health (boxes)",
      "order": 22
    },
    {
      "path": ["attributes", "willpower"],
      "widget": "number",
      "label": "Willpower (boxes)",
      "order": 23
    },
    {
      "path": ["attributes", "skills"],
      "widget": "dots",
      "max": 5,
      "label": "Skills",
      "order": 30
    },
    {
      "path": ["attributes", "disciplines"],
      "widget": "dots",
      "max": 5,
      "label": "Disciplines",
      "order": 31
    },
    { "path": ["attributes", "powers"], "widget": "tags", "label": "Powers", "order": 32 },
    { "path": ["inventory"], "widget": "items", "label": "Inventory" },
    { "path": ["description", "backstory"], "widget": "prose" }
  ]
}
```

### Warhammer Fantasy Roleplay 4e

Characteristics and skills are percentiles; wounds are a track whose maximum is stored on the sheet.

```json
{
  "fields": [
    {
      "path": ["attributes", "characteristics"],
      "widget": "percentile",
      "label": "Characteristics"
    },
    { "path": ["attributes", "skills"], "widget": "percentile", "label": "Skills" },
    {
      "path": ["attributes", "wounds", "current"],
      "widget": "track",
      "maxPath": ["attributes", "wounds", "max"],
      "label": "Wounds"
    },
    { "path": ["attributes", "fate"], "widget": "checks", "max": 6 },
    { "path": ["attributes", "talents"], "widget": "tags" },
    { "path": ["inventory", "trappings"], "widget": "items" }
  ]
}
```

### Dungeons & Dragons 5e

Ability scores show their modifiers; hit points are a track.

```json
{
  "fields": [
    {
      "path": ["attributes", "abilities", "strength"],
      "widget": "score",
      "modifierPath": ["attributes", "modifiers", "strength"]
    },
    {
      "path": ["attributes", "abilities", "dexterity"],
      "widget": "score",
      "modifierPath": ["attributes", "modifiers", "dexterity"]
    },
    {
      "path": ["attributes", "hp", "current"],
      "widget": "track",
      "maxPath": ["attributes", "hp", "max"],
      "label": "Hit points"
    },
    { "path": ["attributes", "skills"], "widget": "number" },
    { "path": ["attributes", "languages"], "widget": "tags" },
    { "path": ["inventory", "weapons"], "widget": "items" },
    { "path": ["description", "backstory"], "widget": "prose" }
  ]
}
```

Item lists offer sorting by every key present in their cards, in ascending or descending order. Numbers sort numerically; missing or null values stay last. Sorting is local to the view and does not change saved inventory order.

On character sheets, the pencil at the bottom right of each item opens a modal with editable values, including nested fields. Numbers and booleans retain their types. Save item persists the edited fields while keeping the modal open with feedback; unrelated refreshed values are preserved. Close discards unsaved changes. The section JSON editor remains available for adding or removing keys and items.

The trash button beside the pencil opens a confirmation modal. Cancel or Escape leaves the item unchanged. Delete item removes the keyed entry or list element and refreshes the sheet; failures remain visible in the modal. If the item changed while confirmation was open, cancel and review it before confirming again.
