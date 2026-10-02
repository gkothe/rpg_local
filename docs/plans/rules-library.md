# Plan: System rules library

**Status**: Application implementation and Windows regression evidence completed; 90/91 original tasks checked. T085 now has actual three-provider evidence, including continuous Codex and private-MCP Antigravity campaign acceptance. T001 awaits the extraction owner's metadata/UTF-16 handoff confirmation after successful read-only validation of the actual eleven-column package. At the user's request, a fresh Claude repeat is a TODO until the weekly subscription allowance is available; prior acceptance remains historical evidence. Exact evidenced Windows model/effort gates are enabled. The user's 2026-10-02 caching/native-tool/extension direction below supersedes the earlier fresh-phase/no-cache design.
**Date**: 2026-10-01. **Mode**: default, with clarified user direction.
**Request**: Expand the simplified rules-library draft into an executable plan without taking over the separate Markdown extraction work.

## Summary

Store reusable game-system libraries in local PostgreSQL, retaining original book text in eleven generic JSON columns. Import the other agent's annotated Markdown through preview and atomic publication. The GM discovers and reads relevant rules through four bounded read-only tools alongside trusted dice; it never receives a whole book or SQL access.

Campaigns and rule tools use the current system table directly. Turns capture a revision/hash; a system change stops an in-flight attempt before it can commit mixed-rule output. A built-in default system contains only editable instructions: without a selected book system, gameplay continues using existing context, campaign memory and model knowledge. Books are authoritative when they contain the relevant rule; extracted fields and summaries are navigation aids.

Campaign exports reference the library; separate private backups contain the books. Code and original synthetic fixtures are public, actual books/extraction outputs are not.

## Clarifications

- Q: Book priority and house rules? → A: Rules come from the books if present; house rules are out of scope. Do not invent a priority system or silently overwrite contradictory books.
- Q: Pin campaigns to an older version? → A: Always use the latest system version.
- Q: What may the app edit? → A: Instructions only; replace books by re-importing. Browse/preview are included; node/field editing is excluded.
- Q: Include books in campaign exports? → A: Reference the library; separate full-library backup.
- Q: Updates during running/failed turns? → A: The earlier frozen-version answer is superseded by the user's simplification: always use the current system table, without full system copies. Stop an outdated running attempt and block its retry; retain its dice/short evidence. A new action uses current rules.
- Q: No selected system? → A: Keep playing from memory/model knowledge through a default row with only instructions filled.

## Context

Node.js 22.13+, TypeScript ESM, Express, PostgreSQL, Zod; React/TypeScript/Vite and root npm workspaces. Tests use Node/tsx, Supertest, isolated PostgreSQL, Vitest/Testing Library and Windows Chrome Playwright.

- `services/sourceLibrary.ts` already implements review/revision-owned campaign sources. Shared systems remain separate from campaign `source_chunks`.
- `domain/context.ts` builds bounded mandatory state, recent history, memory and retrieved campaign sources; never append whole library columns.
- `services/turns.ts` owns frozen input, leases, cancellation, atomic changes, explicit retry and undo. `domain/diceContext.ts` currently lacks system/revision identity.
- Claude and Antigravity use owned private MCP; Codex replies to native dynamic calls in the same bounded turn. One reconstructed logical action uses one continuous native tool loop. Default gameplay exposes dice only; book mode adds the four implemented readers under explicit verified capability gates.
- `services/library.ts` strictly handles campaign archives v1/v2; new references/audit require a distinct v3 with legacy normalization.
- Campaigns live in JSON documents. A new relational reference requires migration and `Store.insert/save` mirror updates, not only TypeScript fields.

Paths above are under `rpg_be_local/src/`. Follow root/app CLAUDE.md: backend-owned values, sequential application I/O, parameterized SQL, immutable migrations and no external I/O inside transactions.

## Scope and must not change

Include shared systems, annotated Markdown import/replace, preview/diff/publish, revision-owned instructions, browsing, automatic latest binding, four GM rule tools, cited evidence, private backups and all three Windows CLI paths.

Exclude PDF/OCR conversion, Markdown cleanup, AI-generated extraction/enrichment, house-rule creation, app-enforced mechanics, public books, remote synchronization, vector services, node editing and Android/macOS/Linux acceptance. Fields/summaries are optional; their unfinished extraction does not block text imports.

Preserve existing campaign sources, private notes, templates, dictation/read-aloud, revision checks, no-tools extraction/compaction, trusted dice, idempotency, full undo and legacy archives. Rule tools cannot mutate state, roll, access files/network or select another campaign/system. Default gameplay retains the existing dice-only path; no direct API or simulated model fallback.

## User stories

### US1 — Import and maintain systems (P1, library MVP)

Create a system, import prepared book files, review a tree/diff, publish, browse its original text and edit instructions.

**Acceptance**:

1. Original synthetic parent/child/table text imports once with PDF/printed page provenance intact; empty structural parents are permitted.
2. Invalid UTF-8, unknown columns, missing files, duplicate/unsafe paths, bad hashes/evidence fail before publication with a location.
3. Replacing book A removes its obsolete nodes and preserves book B and hand-written instructions. Identical input is a no-op.
4. Draft previews never enter gameplay; stale/duplicate confirmation cannot publish twice. Content/mapping/revision publish atomically.
5. Saving instructions keeps the editor open and preserves books. Default exists on fresh/upgraded databases and permits instructions only.

### US2 — Play with bounded, authoritative rules (P1, gameplay MVP)

Select a book system or default. The GM reads the compact map, retrieves relevant passages, requests genuine dice, and returns complete narration with citations.

**Acceptance**:

1. Rules/dice interleave; only the five owned tools exist. Books are authoritative for covered mechanics; summaries/fields alone cannot support a ruling citation.
2. Citations identify retrieved original text, book/path, captured hash and PDF/printed pages. Missing results are explicit. Unsupported provisional model rulings are labelled; conflicting books are explained rather than silently merged.
3. Malicious book text cannot activate shell, network, ambient MCP, user skills or provider sessions. Whole books never enter a model prompt.
4. Updating A→B mid-turn stops the A attempt with no canonical state commit; the next new action uses B. Failed A retry against B is rejected, retaining original dice/read audit.
5. Provider switching preserves context, selection and dice. Unsupported book tooling does not disable default gameplay or extraction/compaction.
6. No selection resolves to instructions-only default and existing memory/model knowledge. Empty/missing library does not silently become default.
7. Mandatory overflow, exhausted limits and cancellation apply no partial canonical game state or fabricated fallback.

### US3 — Separate portable saves from private books (P2)

Export a reference-only campaign and a full private library backup; restore each independently and resolve missing libraries explicitly.

**Acceptance**:

1. Campaign v3 omits full book trees; v1/v2 import into default. Templates contain a reference, not books/history.
2. A missing library leaves the campaign viewable but blocks book-backed Send until explicit resolution/default choice. No fuzzy name match.
3. Stable system key/hash resolves across different local UUIDs; current-head differences are disclosed. Subsequent turns use latest.
4. Backup restores current instructions/books atomically; malformed/conflicting imports change nothing. Imported dice sessions remain non-executable.

## Decisions

| Decision                                                             | Why                                                     | Alternatives rejected                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Eleven fixed JSON columns and one current row/system.                | Preserves agreed draft and generic systems.             | Per-node SQL rows or VtM-specific schema.                                  |
| One current system row; revision/hash guards instead of full copies. | User explicitly wants the simpler live-table design.    | Historical book snapshots, permanent pinning or silently mixing revisions. |
| Namespace nodes by book slug.                                        | Same-name rules cannot erase another book.              | Name matching or last-import-wins.                                         |
| Instructions-only protected default.                                 | User explicitly wants memory/model play without books.  | Require books or fabricate a model-generated library.                      |
| Import prepared Markdown without AI calls.                           | Extraction is a separate workflow.                      | Repeat OCR/extraction or wait for all summaries.                           |
| Deterministic application search first.                              | Bounded local data needs no extra service.              | Embeddings, model-authored SQL/JSONPath, premature search infrastructure.  |
| Owned registry behind existing provider transports.                  | Add rule tools while retaining verified dice isolation. | Global MCP or a complete provider rewrite.                                 |
| Books outrank summaries/fields.                                      | Literal occurrence does not prove a field's meaning.    | Treat extracted JSON as executable mechanics.                              |

## Data contract

### One current row and lightweight turn evidence

`rule_systems`: UUID id, unique stable system_key, system_name, backend kind (library/model_knowledge), monotonically increasing local integer revision, SHA-256 content_hash, instructions, sources, eleven JSON columns, mapping and UTC timestamps. Columns: core_rules, lore, archetypes, abilities, traits, items, creatures, procedures, glossary, gm_guidance, others. Unused columns are {}. Backend constants own names/labels/validators. Hash sorted canonical content including instructions/sources/text/enrichment/mapping, excluding IDs/counters/timestamps.

There is **no rule_system_versions table, historical full-book copy, per-campaign book copy or persistent book snapshot**. Publication replaces the current row under its lock; exact identical content is a no-op. Each lookup checks and locks the authoritative database head before using content. Under the user's caching direction, immutable revision/hash snapshots may be retained in bounded process memory (four entries/64 MiB serialized content), with bounded search candidate caches (eight queries/4096 hits per snapshot). Ownership, cancellation and fresh persisted receipts remain outside the cache. Superseded content cannot be served against a changed head; weakly associated search data is collectable after eviction.

Seed the protected model_knowledge default identity in the migration: sources empty, book columns/mapping {}, only instructions filled. It cannot accept books/deletion. Null/missing legacy selection resolves to this row. Instruction edits update its revision/hash too. Restoring a backup into an existing row increments its local revision; never restore an older revision counter. Restoring the default changes only instructions under explicit confirmation, retaining its local protected identity/kind and empty book columns.

Add nullable campaigns.rule_system_id FK (null = default), mirrored by optional Campaign.ruleSystemId. Unresolved imported references have explicit document metadata/status and a null FK; they must not fall through to default until the user chooses it. Update Store/create/import/template writers together and enforce mirror consistency.

`turn_rule_reads`: append-only receipt UUID, campaign/turn, system identity and captured revision/hash, tool name, transport request identity, argument digest, result hash, bounded returned payload and UTC time. Persist short evidence before reveal; unique (turn_id,transport_request_id) receipts replay the exact ID/payload, changed reuse conflicts. Check active ownership/current revision before receipt replay too. Budget/call counters are transactionally charged once per transport identity, including invalid requests; a network retry cannot consume the budget twice. No full-column/book storage here. Failed/cancelled/undone receipts stay audit, never active narrative history. A turn's ordinary prompt necessarily contains the instructions/map overview it was sent; that is bounded input evidence, not a second library.

### Nodes

Each column begins with book-slug navigation roots, then splitter paths. Nodes contain name, aliases, source slug, direct original text, optional derived summary, fields/fieldEvidence, review, pdfPages/printedPages, optional direct-text pageSpans and children. Page spans use canonical UTF-16 [start,end) offsets into the same direct text used for enrichment evidence, with known PDF page and separate printed label; spans cannot overlap, exceed text bounds or borrow descendant text. Unmapped spans explicitly have unknown page provenance. Structural parents may have empty text/pages and `structural:true`; they cannot support citations.

Canonical path: `abilities.example-core.auspex.children.heightened_senses`. Content slugs match `[a-z0-9][a-z0-9_-]{0,79}`; full path ≤512 characters; content depth ≤12 (exclude column/book/literal children separators). Reject `__proto__`, `constructor`, `prototype`, `children` as content keys. Own-property traversal only, never SQL/JSONPath evaluation.

Preserve exact known one-based PDF pages and separate printed labels/unknown values. Existing comment `pages:249-256` is an inclusive range, not two exact pages or proof every intervening page supplied text. Inline page markers refine direct text provenance. Parents do not inherit descendant text/pages as their own evidence. Preserve inline page-marker positions as pageSpans before stripping control comments; derive each returned text window and cited quote’s pages from intersecting spans. When only a node-wide range is available, report that range as approximate, never invent an exact page for the quote.

Review is `extracted`/`verified`, default extracted; import does not confer verification. Text field evidence has exact quote and UTF-16 start/end offsets into direct source text; validate membership/provenance but do not claim semantic proof. Visual evidence has PDF page, review note and explicit manual status: red-dot levels missing from OCR must remain visibly visual evidence. Invalid evidence fails enrichment validation; absent evidence stays extracted. Summaries are derived navigation only. Tables stay in original Markdown and may also have bounded `fields.table`; fields never replace source authority.

### Named limits

Store these once in `domain/rules.ts` or the owning gameplay contract; serve them to the frontend. Byte limits measure actual UTF-8 serialization including escaping/metadata.

- Keys/slugs 1–80 characters, names/titles 1–200; converter identifier 1–120; SHA-256 exactly 64 lowercase hex characters.
- Instructions ≤8,192 bytes; node summary ≤1,024 bytes; ≤20 aliases of 1–120 characters. ≤20 books/10,000 nodes/20 MiB canonical current system content; ≤2,000 pages/book; direct text ≤512 KiB/node; fields/evidence ≤16 KiB/node; field nesting ≤4, arrays ≤1,000 elements.
- Import ≤12 files (manifest + eleven columns), ≤10 MiB/file and ≤20 MiB combined. Optional enrichment lives in manifest, not a thirteenth file. No ZIP extraction, symlinks/recursive paths or server file-path API.
- Preview TTL 30 minutes, ≤2/system or fresh-restore system key and ≤8/server; book previews ≤20 MiB, full-library restore previews ≤32 MiB, ≤256 MiB aggregate server staging; validation deadline 30 seconds. Owned external temp staging; cleanup on expiry/consume/cancel/startup.
- Detailed generated mapping ≤32 KiB; injected overview ≤1,024 bytes. Mapping describes populated columns/books and generic node/field layouts, not an exhaustive path index; search/list discover actual paths. A valid 10,000-node system must not fail just because enumerating its paths would exceed this mapping cap. Never enumerate full node text/all paths into the prompt.
- Rule request ≤1,024 bytes; cursor/locator ≤192 ASCII characters each, mutually exclusive; query 1–240 characters/≤12 terms; ≤10 search hits or ≤20 child descriptors. Serialized rule result ≤4,096 bytes; aggregate rule request/result transcript ≤8,192 bytes; ≤12 rule calls including invalid/map/list/search/get requests.
- Preserve dice ≤24 requests, 12 slots, 200 new faces/logical action and ≤8,192-byte transcript. Combined calls ≤36 plus final inference, overall deadline 180 seconds and output ≤2,000,000 bytes. Provider-specific verified reserves can require lower limits; never raise native capacities just to fit this ceiling.
- Campaign upload remains 20 MiB. Private full-library backup ≤32 MiB of current content, using a separate bounded route, not larger global JSON limits.

Benchmark original synthetic 596-node and maximum 10,000-node/20-MiB systems on Windows: p95 warm search <500 ms, cold row load+lookup <2 seconds across 30 sequential queries. Targets are unmeasured until implementation; optimize if missed without relaxing evidence/context limits.

## External extraction handoff and import

The separate agent owns PDF conversion, layout/page checking, split outlines, enrichment and summaries in the private book workspace. Do not modify its scripts/books while implementing this plan.

**Recorded external milestone, not independently reverified here**: original draft T001 reports 4,923 body lines placed once, 596 nodes across eleven VtM core files and page-image/hOCR review. Original T002–T005 enrichment/summaries remain external responsibilities. New application T001 below confirms the input contract, not extraction completion. Fields/summaries can arrive later by complete book re-import.

Accept `rules-book` package v1: `manifest.json` plus exactly its listed column `.md` files. Manifest: source slug/title/page count, optional edition/publication labels, original PDF SHA-256 if known, mandatory per-column hashes, converter identifier/version, marker-format version, coverage/explicit omission report and optional keyed enrichment. Compute upload hashes locally; never claim to verify an unavailable PDF. Missing original PDF hash is explicitly unknown.

Accept the current column header `<!-- column: <column> | source: <source> | ... -->` and verify it against filename/manifest; ignore only recognized control metadata. Accept `pages:-`/`printed:-` for unknown or structural content; actual PDF pages must be within the manifest page count. Preserve original body words/order and make the normalized direct-text/offset contract explicit in T001 (UTF-16 offsets after agreed metadata removal and LF normalization).

Use existing splitter markers `<!-- node: dotted_path | pages: start-end | printed: start-end -->` and inline `<!-- page N (printed N) -->`. App adds column/book prefixes. Preserve direct body text/order and tables; metadata comments are not book prose. Parse boundaries outside fenced code only; capped heading depth does not override marker paths. Allow explicit empty parent nodes; reject absent parents, duplicate paths/files, conflicting titles, unknown columns, malformed markers and hash mismatch. Every non-metadata body span in accepted files belongs to exactly one direct node. This proves column-input coverage, not OCR correctness.

Enrichment is optional and must point to existing column/relative-node paths. Unknown keys fail; text and manual visual evidence remain distinct. Instructions are never generated/overwritten. Optional hand-written column meanings/search hints are validated metadata; path/field layouts are generated from nodes and are not executable instructions.

Preview shows sources/counts, coverage/page warnings, extracted fields and replacement diff. Confirmation `{revision,requestId,previewId}` is bound to the preview's system/base revision and input hash. Lost-response retries reuse that identity. Under the system lock, resolve a persisted confirmation receipt before requiring the preview to exist or checking its old base revision: a successful confirmation consumes the preview and advances the row. Same request ID and identical input returns the originally committed result even after preview expiry or another publication; changed reuse conflicts. A first-time confirmation still requires a live matching preview and current base revision. Store immutable confirmation identity/input hash/result metadata separately from temporary staging; do not retain raw book uploads as receipts. Parse/file I/O outside transactions; under system lock validate current revision, replace that source's complete partition, recompute mapping/totals and atomically publish current row/mapping/revision/receipt. Other books and hand-written instructions survive. Identical content is a no-op; stale preview conflicts.

## Tools, context and provider integration

### Four rule tools

Bind system identity/expected revision in the application closure; remove the draft's model-supplied `system` argument. Default advertises dice only and omits rules mapping.

| Tool           | Strict input                                                   | Result                                                                                                                                           |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rules_map`    | `{column?,cursor?}`                                            | Generated layout/field meanings, validated meanings/hints and generic term aliases, paginated.                                                   |
| `rules_search` | `{query,columns?,source?,cursor?}`                             | ≤10 paths/names/source/page/review descriptors and original-text snippets with a bounded text locator; summary-only matches labelled derived.    |
| `rules_get`    | `{path,view?,cursor?,locator?}`, view text (default) or fields | One node's direct original-text chunk or canonical field-JSON chunk; no descendant text.                                                         |
| `rules_list`   | `{path,filter?,cursor?}`                                       | ≤20 direct child names/paths and bounded scalar projections. Filter one declared scalar field with eq/gte/lte and matching type; no expressions. |

Every result includes captured revision/hash, receipt, complete/omitted indicators and continuation cursor/null. Node results carry source/path; map/search/list envelopes carry source/path on individual entries rather than inventing a single source for multi-book results. Cursor binds revision/hash, normalized arguments (excluding cursor/locator), section and position. Use a compact authenticated opaque token of at most 192 ASCII characters, not the full path/query encoded again. A server restart invalidates its paging tokens and reports an explicit cursor_expired response; restart the lookup rather than fabricate a result. Stale browser cursor conflicts; invalid fields/oversized requests reject. Account for serialized escaping overhead, progress on Unicode boundaries, never label partial node/JSON complete. Result projection takes the remaining aggregate allowance as well as the per-result ceiling, reserving request/receipt/escaped-envelope bytes before persisting/revealing it. Partial output always includes explicit continuation; if even metadata plus one valid text unit cannot fit, fail rules_budget_exhausted before another reveal. Persistence, transcript accounting and receipt idempotency are one transaction.

Detailed field JSON can be retrieved in successive chunks, with complete=false until the full value has been provided; oversized units fail explicitly.

Search returns an authenticated ≤192-character locator for each original-text match. rules_get may start at that match window (locator and cursor are mutually exclusive), then paginate forward; it need not read hundreds of KB from the node start to reach a relevant paragraph. Field/summary-only matches have no text-authority locator. Locator validates node/path/revision and cannot access another system.

Search ranks exact names/aliases first, original text next, summary-only matches last, then stable source/path ties. No per-query AI, embeddings, mapping-boilerplate authority, SQL or whole-column result. No match is legitimate; operational failure is not disguised as empty success.

Book-backed GM response v3 retains v2 narrative/operations/rollInterpretations and adds ruleCitations. Export both its runtime validator and JSON schema from ruleResponse.ts. Select the same default-v2/book-v3 schema in buildContext, each native adapter’s final-envelope parser and TurnService; Antigravity must not unconditionally parse a book final with diceResponseSchema. Default remains v2. A citation references a persisted `rules_get` text receipt from this attempt (or exact replay), source/path/revision/hash and nonempty original quote ≤600 characters. Validate quote membership, ownership and all references before state commit; quoted pages must agree with the receipt’s canonical page spans or be explicitly approximate/unknown. Fields/search snippets/summaries/structural nodes alone cannot support citations. Empty citations are valid if no book rule is claimed. Validation cannot prove free-form reasoning follows the rule; explicitly document that limitation.

Books provide mechanics, not authority to execute instructions/tools. System instructions guide GM behavior; campaign instructions govern tone/language/preferences, neither silently changes published mechanics. Uncovered rules may receive explicitly provisional memory/model adjudication. Unresolved applicable contradictions are cited/explained and clarification requested; no implicit book precedence or house-rule editor.

### Current-table reads, changes and recovery

Capture lightweight RuleContext {systemId,revision,contentHash,kind} when accepting a new turn. Inject current system instructions before compact map overview, respecting existing prompt limits; do not copy books into the turn or prompt. No selected system resolves to the instructions-only default.

Each rule/dice tool (including exact receipt replay) and final commit checks active lease/owner/cancellation and the expected current system revision/hash. Use existing campaign→turn/dice-session→system lock order; take a short shared system-row lock while checking/persisting evidence or dice, not while running the CLI. Publication locks only the system row and commits the changed head. Make expected-head validation atomic with turn acceptance/session creation, new-read persistence and final state commit. Never check the head outside a transaction then assume it is unchanged for the write. No external work under either lock. A changed head causes rules_context_changed, aborts the provider and prevents canonical state commit; already-saved dice/short reads remain visible. Compaction-driven context rebuild retains the initially captured RuleContext and verifies it before saving rebuilt input/session creation; never silently resolve a new head inside the same attempt. The turn heartbeat can detect changes between tools so the application does not wait for a final answer unnecessarily.

Unchanged-head explicit retry preserves original dice and requests current-table rules normally in a fresh attempt. Changed-head retry blocks: do not silently reinterpret the original roll under new rules or use a hidden old book copy. A deliberately new action uses current rules; it is distinct from preserved retry.

Local retry identity includes effective system ID, revision, kind and content hash. A→B→A publication or restore still blocks the old attempt because its local revision changed, even if the content hash happens to match again. Duplicate no-op imports do not increment revision. Portable archive matching uses stable key/content hash, not another database's local revision.

Keep existing bounded campaign memory and compaction. Memory records events/consequences, not authority for current mechanics; current books outrank remembered interpretations. No whole-history rebuild, checkpoint versioning or retroactive stat recalculation just because a book changes. Updating default instructions follows the same revision checks. Undo restores campaign state/memory, never the shared library or read/dice audit.

Historical citations retain only their original retrieved quote/pages/source/hash. They show an outdated marker if current content changed; the UI cannot reopen a full prior book version. Clicking a current node must disclose the hash mismatch rather than presenting today's text as the old source.

### Owned gameplay registry

Introduce `GameplayTools` for exactly roll_dice plus the four rule tools: strict schemas, purpose gates, serialized dispatch, receipt idempotency and separate/shared counters. Reuse DiceService without changing randomness/declaration/replay semantics. Default keeps its dice-only tools and roll rules, but its narrator explicitly permits model knowledge when no confirmed reference covers the question. For book mode use a distinct narrator/purpose, not DICE_NARRATOR's current “No other tools” wording. Tool names come from the registry; book text is still untrusted and random outcomes still require roll_dice.

- Claude: extend private endpoint and exact init allowlist for book mode only. No resources/prompts/discovery/shell/file helpers. Verify output/context/turn reserves against native context/usage before increasing the old 25-turn allowance. Keep no-tools safe mode for compaction/extraction.
- Codex: expose only registry-owned dynamic definitions and reply to pending native calls with the installed DynamicToolCallResponse schema. Continue one ephemeral thread/turn per logical action; preserve auth/version/context checks, bounded call/transcript/output/inference accounting and actual cached-input telemetry.
- Antigravity: configure authenticated private HTTP MCP in an owned temporary profile, exact private MCP permissions, empty native tool list and excluded global customizations. Continue one native logical turn; preserve 12,800-byte serialized input, 16,000-token per-inference input windows, 2048-token outputs, 25-inference/time/call gates. Check native gateway server/tool identities; never broadly allow intrinsic tool events. No shared MCP/settings mutation.
- ProviderService serves separate `rules:{supported,reason,limits}` provider/model capability. Dice/no-tools/installation does not imply rule support. Reserve tool schemas/overview/instructions and both transcripts before launch; preserve default dice-only capacities.

The 36-call generic ceiling is not a promise that every provider can fit it. Report lower verified per-provider limits explicitly. Actual Windows rule→dice→rule→final and malicious-text tests must pass before enablement. Run pre-enable validation through an explicit isolated opt-in test harness that calls candidate adapters directly with synthetic fixtures and the owned registry. It bypasses only the production catalog’s unverified-book capability flag, never native version/isolation/budget checks, and never adds a normal-app enablement override. If budgets/transport cannot be proven, revise the adapter before claiming book release complete; default stays available.

## HTTP and frontend

Use existing data envelopes, problem code/detail, Host/Origin/device protections and revision semantics; serve domain values/limits through settings.

- GET/POST `/rule-systems`: paginated metadata/create `{systemKey,name}`; user-created systems are library kind, default is protected.
- GET `/rule-systems/:id`: current metadata/revision/hash/instructions/source descriptors/compact mapping, never complete books by default.
- PATCH `/rule-systems/:id/instructions`: `{revision,requestId,instructions}`; reject book/node edits.
- POST `/rule-systems/:id/imports`: bounded multipart preview with revision. POST `/rule-systems/:id/imports/:previewId/confirm`: revision/requestId.
- GET `/rule-systems/:id/search`, `/nodes`, `/mapping`: bounded read logic shared with tools. Reads use current table only; archived citations open stored short receipts, not historical books. Browser response ≤16 KiB/page; GM result remains ≤4,096 bytes.
- PATCH `/campaigns/:id/rule-system`: `{revision,requestId,systemId:null|uuid}`, idle campaign check; null means default. Selection changes future rule authority, not narrative memory/history/state.
- GET `/rule-systems/:id/export`, POST `/rule-systems/backups/imports` and `/rule-systems/backups/imports/:previewId/confirm`: separate bounded private-backup restore preview/confirmation. No deletion/pruning API in v1.
- GET `/campaigns/:id/turns/:turnId/rule-reads`: paginated bounded historical receipts, checked against campaign/turn ownership; response ≤16 KiB/page. Do not return running partial results or cross-campaign receipt IDs.
- POST `/campaigns/:id/rule-system/resolve`: `{revision,requestId,systemId:null|uuid}` for unresolved archive refs; explicit current-hash disclosure.

Add Rules library navigation, `/rules` and `/rules/:id`. Detail editor has Instructions, Books/import preview and Browse/Search. Explain derived/extracted evidence; do not render unsafe Markdown/HTML. Real file selection, no hardcoded machine paths. Save keeps editor open; errors preserve draft/location. Single-flight guards and revision-owned edits must ignore stale navigation.

Setup/play picker includes served default and published systems. Empty/missing/incompatible selections explain blocked Send and offer explicit default choice. Current revision refresh happens after turns without losing drafts. Complete chat narration/dice remains; add expandable citations/source audit, not full books/live tool tickers.

## Archive/backup contract

Campaign v3, rules package v1 and library backup v1 use separate constants. Campaign export includes reference `{systemKey,systemName,kind,contentHash}` and captured RuleContexts/short read/citation audit, not complete books/PDFs/local paths. Short previously retrieved quotes are intentionally retained as historical evidence: reference-only does not remove every quoted sentence.

Normalize v1/v2 missing system fields to default and absent rule audit to empty. Explicitly remap UUID references, never arbitrary text. A missing local library keeps unresolved metadata and bounded historical evidence without dangling FKs. Imported campaign stays readable; new book-backed turns block pending explicit library/default resolution. Match stable key/hash, not fuzzy name; disclose a newer/different head. New turns then follow latest. Imported sessions remain non-executable.

Private backups contain current system row with hashes. Validate source paths/content/limits before publication. Fresh restore creates local identities; existing key collision requires explicit preview/revision-owned replacement. Do not include scripts, provider tokens, absolute paths or raw PDFs. Templates contain system references/resolution status only, never books or read/dice history.

## Complexity and assumptions

| Addition                                                   | Reason                                                                 | Simpler rejected option                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Lightweight revision guards and short read receipts.       | Prevent mixed output without copying the books.                        | Historical snapshots/per-campaign book copies.     |
| Bounded external preview staging.                          | Validate/diff multiple files before atomic confirmation.               | Partial publication or parsing under locks.        |
| Shared gameplay registry with broader verified allowlists. | Four read tools must coexist with preserved dice.                      | Duplicate dispatch or ambient MCP.                 |
| Separate campaign v3/private backup v1.                    | Strict legacy formats lack refs/audit; privacy/size boundaries differ. | Break old formats or bundle books into every save. |

Assumptions: no automatic book priority; explain conflicts. Confirmed campaign sources remain available, but do not silently override a selected book's covered mechanic. Empty libraries block book mode with explicit default alternative. No node edits/deletion/history management in v1. Enrichment optional. Instruction edits never rewrite book mechanics. Extraction-owner handoff is the only external deliverable dependency.

Risks: OCR correctness cannot be proven by hash/structural import; distinguish external coverage/manual review. Mapping/large fields can exceed context; paginate/reject honestly. New tools may weaken isolation; exact allowlists and actual native gates are mandatory. Updates may invalidate an in-flight attempt; check head before every tool/final commit. Old evidence is quoted audit, not current rules. Duplicate imports no-op and backups have explicit size limits.

## How to verify

1. Dedicated `RPG_TEST_DATABASE_URL`, NODE_ENV=test; fresh/upgrade/idempotent migration/default tests, never production fallback.
2. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`; explicitly check/format this plan since docs/plans is ignored by normal Prettier.
3. `npm run test:e2e --workspace rpg-fe-local` with Windows Chrome: synthetic import/draft/latest/citation/missing-library/default flows.
4. Isolated SQL: same-name nodes across books; complete replacement; stale/duplicate confirm; mid-turn update/rejected outdated lookup/latest new action; outdated retry preserving exact dice; cancellation/restart/undo/archive and publication concurrency.
5. Synthetic 596/10,000-node benchmark: 30 sequential queries, real p95/serialized sizes, no whole-book provider prompt.
6. Opt-in actual Windows Codex/Claude/Antigravity: two rule→dice→rule→cited-answer turns, CLI switching, unchanged retry and malicious reference text. Original synthetic rules, owned temp dirs, UUID isolated DB schemas, no shared CLI configuration. Record versions/models/efforts, exact tool exposure, usage/peak-vs-aggregate distinction, latency and skipped alternatives.
7. Reference-only campaign then separate library restore: unresolved campaign viewable, Send blocked; explicit resolution continues; old audit survives. v1/v2/default/templates remain compatible.
8. `npm run audit:public` using gitleaks/production bundles: zero private book artifacts, credentials or source snippets in committed fixtures.

## Tasks

All tasks are application work except T001's extraction contract handoff. The user subsequently authorized full implementation and the native-loop/cache/extension changes. Each implementation/test pair is one green boundary. No commits or pushes are authorized. No [P] labels: these contracts share dependencies. Existing default behavior stays green throughout.

### Phase 1 — Foundation

- [ ] T001 Confirm manifest v1/marker/page/enrichment semantics with the extraction owner and record the handoff in `docs/plans/rules-library.md`; preserve the original reported external T001 evidence, without editing scripts/books.
- [x] T002 Write failing node/default/limits/provenance/canonical-hash contract tests in `rpg_be_local/tests/rules.test.ts` (pair with T003).
- [x] T003 Define backend kinds/eleven columns, node/package schemas and all Named limits in `rpg_be_local/src/domain/rules.ts`: instructions ≤8,192 bytes; ≤20 books/10,000 nodes/20 MiB/system; ≤2,000 pages/book; text ≤512 KiB/node; enrichment ≤16 KiB/node; slugs `[a-z0-9][a-z0-9_-]{0,79}`, full path ≤512 chars/depth ≤12; reserved keys rejected (after T001, pair with T002).
- [x] T004 Define shared system/revision/RuleContext/read/citation/reference types and optional legacy campaign/turn fields in `rpg_be_local/src/domain/types.ts`, deriving closed values from T003.
- [x] T005 Add optional book-gameplay generation/capacity ports in `rpg_be_local/src/providers/service.ts`; existing dice-only Generator fixtures/calls remain valid, rule capability defaults unavailable until T062.
- [x] T006 Define distinct package v1, private backup v1, GM rule-response v3 and campaign archive v3 constants in `rpg_be_local/src/domain/versions.ts`; do not switch current exports before T075.
- [x] T007 Write failing legacy v1/v2/default metadata compatibility, retained v2 acceptance after latest=v3 and unsupported book-export guard tests in `rpg_be_local/tests/ruleArchiveCompatibility.test.ts` (pair with T008).
- [x] T008 Extend strict internal campaign/context/read metadata validators and explicit v1/v2/v3 format branching in `rpg_be_local/src/services/library.ts` before new fields enter persisted documents; old saves/default exports remain readable, unimplemented book-bound export fails explicitly rather than losing its reference; full v3 support follows T074 (pair with T007).
- [x] T009 Write failing fresh/upgrade/idempotent seed/FK/document-mirror/unique read transport identity migration tests in `rpg_be_local/tests/rules.database.test.ts` (pair with T010).
- [x] T010 Add immutable `rpg_be_local/migrationssql/0005_rule_systems.sql` for current rows, current revision/hash, receipts, turn_rule_reads and nullable campaign mirror/default seed (pair with T009); check next unused number before implementation, never renumber another applied migration.
- [x] T011 Write failing locked publication, idempotent read counters/receipt replay, monotonic restore revision and default-only instructions tests in `rpg_be_local/tests/rulesStore.database.test.ts` (pair with T012).
- [x] T012 Implement parameterized rule persistence/atomic publication/receipt replay in `rpg_be_local/src/services/ruleStore.ts`; no external I/O under locks (pair with T011).

**Checkpoint**: Isolated migration/store pairs pass; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green. No gameplay path is changed yet.

### Phase 2 — US1: Import and maintain systems

**Goal**: Usable source imports/editor without model calls.
**Independent test**: Import synthetic books, replace one, observe exact body/page coverage and preserved other book/instructions.

- [x] T013 [US1] Write failing annotated Markdown parsing tests for parent text/pages/ranges/page-span offsets across stripped markers and Unicode/fences/deep headings/duplicate markers/body coverage/optional enrichment in `rpg_be_local/tests/ruleImport.test.ts` (pair with T014).
- [x] T014 [US1] Parse manifest/columns deterministically in `rpg_be_local/src/domain/ruleImport.ts`; ≤12 files/10 MiB each/20 MiB total, mandatory hashes, strict UTF-8, existing parents, unique safe paths, preserved canonical pageSpans and explicit evidence; no AI/traversal (pair with T013).
- [x] T015 [US1] Write failing generated mapping/layout drift, metadata hints, non-enumerating 10,000-node layout and compact-overview bounds tests in `rpg_be_local/tests/ruleMapping.test.ts` (pair with T016).
- [x] T016 [US1] Generate node-derived mapping in `rpg_be_local/src/domain/ruleMapping.ts`; ≤32 KiB detailed/1,024 bytes injected, summaries labelled derived, hints cannot invent paths/columns, mapping is a compact layout rather than an exhaustive node index (pair with T015).
- [x] T017 [US1] Write failing deterministic search/own-property paths/scalar filters/192-character tokens/deep-match locators/remaining-budget pagination/stale cursor/original-text provenance tests in `rpg_be_local/tests/ruleLookup.test.ts` (pair with T018).
- [x] T018 [US1] Implement map/search/get/list in `rpg_be_local/src/services/ruleLookup.ts`; requests ≤1,024 bytes, query 1–240 chars/≤12 terms, ≤10 hits/20 children, serialized GM results ≤4,096 bytes, ≤192-character cursor/locator, deep-match windows, remaining-budget honest continuation/no descendant text (pair with T017).
- [x] T019 [US1] Write failing book/32-MiB backup preview expiry/quota/aggregate/consume/cancel/startup cleanup tests in `rpg_be_local/tests/rulePreview.test.ts` (pair with T020).
- [x] T020 [US1] Implement owned external temp preview staging in `rpg_be_local/src/services/rulePreview.ts`; TTL 30 minutes, ≤2/system or fresh key/8/server, book ≤20 MiB/backup ≤32 MiB each and total ≤256 MiB, validation deadline 30 seconds, cleanup all terminal paths (pair with T019).
- [x] T021 [US1] Write failing complete-book replacement/no-op/stale/duplicate confirm/lost-response replay after consumed or expired preview and later publication/changed request-ID reuse/instruction preservation tests in `rpg_be_local/tests/ruleLibrary.database.test.ts` (pair with T022).
- [x] T022 [US1] Implement preview/diff/confirm/instructions-only workflows in `rpg_be_local/src/services/ruleLibrary.ts`, binding revision/request/input hash; replay persisted confirmations before stale-preview validation, never store raw uploads in confirmation receipts; replace one source partition and atomically publish mapping/current revision without overwriting instructions (pair with T021).
- [x] T023 [US1] Write failing library metadata/search/nodes/mapping/settings/instructions/multipart/confirm/access boundary tests in `rpg_be_local/tests/rules.http.test.ts` (pair with T024).
- [x] T024 [US1] Wire library endpoints, bounded current-table search/nodes/mapping routes and backend-served limits in `rpg_be_local/src/app.ts`; strict payloads, ≤12 files/20 MiB aggregate, existing envelopes/access checks, no global JSON-limit increase (pair with T023).
- [x] T025 [US1] Add served system/revision/preview/read/reference/capability types in `rpg_fe_local/src/services/types.ts`, not recreated domain option enums.
- [x] T026 [US1] Write failing paginated tree/search/direct-text browsing, locator navigation, stale cursor, safe rendering and unknown/approximate page tests in `rpg_fe_local/tests/rule-browser.test.tsx` (pair with T027).
- [x] T027 [US1] Build `rpg_fe_local/src/features/rules/RuleBrowser.tsx` against served search/nodes/mapping endpoints; load bounded pages on demand, preserve Unicode and distinguish exact/approximate/unknown page provenance, never download whole books or render unsafe imported HTML (pair with T026).
- [x] T028 [US1] Write failing preview/stale publish/instruction draft/default-only editor and safe rendering tests in `rpg_fe_local/tests/rules-library.test.tsx` (pair with T029).
- [x] T029 [US1] Build detail/import/instructions editor and mount T027 browsing in `rpg_fe_local/src/features/rules/RuleSystemEditor.tsx`; synchronous guards, revision-owned save, uploaded manifest/files, no node/field edits (pair with T028).
- [x] T030 [US1] Wire rules list/detail/navigation and T029 in `rpg_fe_local/src/App.tsx`, preserving modified-click/empty/error/loading behavior.

**Checkpoint**: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` green. Library imports/editing invoke no CLI; existing play unchanged.

### Phase 3 — US2: Latest-version campaigns and bounded tools

**Goal**: Cited book-backed gameplay with preserved dice and verified provider isolation; default stays usable.
**Independent test**: rule read→roll→read→validated final; update mid-turn, verify changed-head rejection/latest new action and outdated retry rejection.

- [x] T031 [US2] Write failing legacy/default/FK/document mirror campaign persistence tests in `rpg_be_local/tests/ruleCampaignStore.database.test.ts` (pair with T032).
- [x] T032 [US2] Synchronize campaign FK/JSON insertion/save/read in `rpg_be_local/src/store.ts`; missing legacy field resolves default, unresolved archive reference remains explicitly unresolved (pair with T031).
- [x] T033 [US2] Extend strict campaign create/bind schemas in `rpg_be_local/src/domain/schemas.ts` with nullable systemId and revision/request identity, not arbitrary version/node edits.
- [x] T034 [US2] Write failing selected/default/empty/missing binding, idle/revision/idempotency and memory transition tests in `rpg_be_local/tests/ruleCampaign.database.test.ts` (pair with T035).
- [x] T035 [US2] Resolve/create/rebind latest system selection in `rpg_be_local/src/services/campaigns.ts`; null default, explicit unresolved/empty failures, current rule-authority changes with preserved memory/state/history (pair with T034).
- [x] T036 [US2] Wire system binding/status endpoints in `rpg_be_local/src/app.ts` with idle/revision/write protections (after T035).
- [x] T037 [US2] Write failing default model-knowledge/book-authority/five-tool narrator scope tests in `rpg_be_local/tests/gameplayNarrator.test.ts` (pair with T038).
- [x] T038 [US2] Define purpose-specific narrator contracts in `rpg_be_local/src/domain/gameplayNarrator.ts`; default permits model knowledge with owned dice only, book mode permits exactly the owned five tools and original-text authority, neither permits native shell/files/network/customizations. Replace the incompatible no-other-tools wording instead of concatenating it with rule instructions (pair with T037).
- [x] T039 [US2] Write failing owned five-tool/default gates, independent/shared counters, receipt replay and cancellation tests in `rpg_be_local/tests/gameplayTools.test.ts` (pair with T040).
- [x] T040 [US2] Implement registry and reusable owned MCP endpoint in `rpg_be_local/src/providers/gameplayTools.ts`; default dice-only, book exactly five tools, ≤12 rule/24 dice/36 combined calls, ≤8,192-byte rule and existing dice transcripts, 180 seconds/2,000,000 output bytes, sequential dispatch using T038 narrator contracts (pair with T039).
- [x] T041 [US2] Write failing legacy dice-only endpoint delegation/isolation regression tests in `rpg_be_local/tests/diceMcp.test.ts` (pair with T042).
- [x] T042 [US2] Delegate existing `rpg_be_local/src/providers/diceMcp.ts` to T040's generic endpoint with the original dice-only registry; preserve private authorization/receipt/cleanup behavior without duplicate MCP implementations (pair with T041).
- [x] T043 [US2] Write failing default/current RuleContext/mandatory overflow/event-memory authority/no whole-book context tests in `rpg_be_local/tests/ruleContext.test.ts` (pair with T044).
- [x] T044 [US2] Assemble optional rules metadata/instructions/≤1,024-byte overview and matching v2/v3 final schema in `rpg_be_local/src/domain/context.ts`, preserving existing serialized budgets/history completeness and no-tools compaction; default explicitly permits model knowledge, book mode uses the T038 authority contract (pair with T043).
- [x] T045 [US2] Write failing v3 wrong receipt/version/path/quote/quote-page spans/search-only/field-only citation and shared runtime/JSON-schema selection tests and v2 default compatibility in `rpg_be_local/tests/ruleResponse.test.ts` (pair with T046).
- [x] T046 [US2] Define and export strict v3 gameplay/citation runtime validation and JSON schema in `rpg_be_local/src/domain/ruleResponse.ts`, preserving dice/operations and original-text receipt quotes ≤600 characters (pair with T045).
- [x] T047 [US2] Write failing persist-before-reveal/idempotent replay/lease/compaction head changes/session-creation race/final-commit race/cancel/undo tests in `rpg_be_local/tests/ruleTurns.database.test.ts` (pair with T048).
- [x] T048 [US2] Connect atomic current-row RuleContext guards on acceptance/rebuild/session/read/final commit, registry/read audit and v3 validation in `rpg_be_local/src/services/turns.ts`; keep existing event memory without new rule checkpoint copies, keep default v2 and reject late output (pair with T047).
- [x] T049 [US2] Write failing effective system ID/revision/hash, A→B→A restore and default-instruction retry identity tests in `rpg_be_local/tests/ruleDiceContext.test.ts` (pair with T050).
- [x] T050 [US2] Include effective system ID/revision/kind/content hash in `rpg_be_local/src/domain/diceContext.ts` identity, never books/timestamps/provider preferences (pair with T049).
- [x] T051 [US2] Write failing concurrent publication between pre-check and random draw/current-rule receipt persistence tests in `rpg_be_local/tests/ruleDiceGuard.database.test.ts` (pair with T052).
- [x] T052 [US2] Add an optional current-rule guard inside `rpg_be_local/src/services/dice.ts` roll transaction, checking the captured row revision/hash under a shared system lock before drawing/persisting/revealing; existing default dice behavior and receipt replay stay valid (pair with T051).
- [x] T053 [US2] Write failing unchanged cross-provider retry/changed-rule rejection/original face retention tests in `rpg_be_local/tests/ruleRetry.database.test.ts` (pair with T054).
- [x] T054 [US2] Enforce current system ID/revision/kind/hash retry checks and new-attempt read receipts/reasons in `rpg_be_local/src/services/turns.ts`; changed rules block, unchanged replay preserves dice, imported sessions non-executable (pair with T053).
- [x] T055 [US2] Write failing private exact-five-tool native MCP/init/foreign resource/continuation bounds and valid book-v3/default-v2 final tests in `rpg_be_local/tests/claudeRules.test.ts` (pair with T056).
- [x] T056 [US2] Extend `rpg_be_local/src/providers/claudeDice.ts` through T040 registry only for book mode; verify context/output/turn reserves before raising old 25-turn limit, use T038 purpose-specific narrator scopes and selected v2/v3 final schemas in both gameplay modes, retain no-tools safe-mode paths (pair with T055).
- [x] T057 [US2] Verify native dynamic reply continuations, bounded canonical transcript, foreign-tool/overflow rejection and selected v3/v2 finals in `codexDice.runtime.test.ts`, `diceProtocol.test.ts` and `rulesAdapters.test.ts` (pair with T058; updated native-loop direction).
- [x] T058 [US2] Extend `rpg_be_local/src/providers/codexDice.ts` through T040: registry definitions, pending native replies in one bounded ephemeral turn, existing auth/context/version gates, T038 scopes and selected v2/v3 finals (pair with T057).
- [x] T059 [US2] Verify private native MCP, input/usage bounds, ambient capability rejection, reused RPC IDs and v3/v2 finals in `antigravityDice.test.ts`, `antigravityMcp.native.test.ts`, `rulesAdapters.test.ts` and actual `rules.native.test.ts` (pair with T060).
- [x] T060 [US2] Extend `antigravityDice.ts` and `antigravityMcpBook.ts` through T040: owned-profile private MCP, one continuous bounded logical turn, ≤12,800-byte serialized input and per-inference usage/version checks in both gameplay modes (pair with T059).
- [x] T061 [US2] Write failing independent rules/model capability/default dispatch/no-tools capacity regression tests in `rpg_be_local/tests/providers.test.ts` (pair with T062).
- [x] T062 [US2] Dispatch book/default paths and serve verified rules capabilities/reserves in `rpg_be_local/src/providers/service.ts`; production enablement additionally requires T085 evidence, no guessed native budgets (pair with T061).
- [x] T063 [US2] Write failing terminal read/citation hydration, historical receipt ownership and failed/undone audit separation tests in `rpg_be_local/tests/ruleReads.database.test.ts` (pair with T064).
- [x] T064 [US2] Hydrate bounded terminal rule reads/citations through `rpg_be_local/src/store.ts`; retain captured identity and attempt provenance, exclude failed/undone evidence from active context, never reconstruct old books (pair with T063).
- [x] T065 [US2] Write failing cross-campaign denial, terminal-only pagination and 16-KiB response-limit tests in `rpg_be_local/tests/ruleReads.http.test.ts` (pair with T066).
- [x] T066 [US2] Wire paginated historical receipt reads in `rpg_be_local/src/app.ts` at GET /campaigns/:id/turns/:turnId/rule-reads; validate campaign/turn ownership, expose terminal attempts only, serialized response ≤16 KiB and explicit continuation (pair with T065).
- [x] T067 [US2] Write failing served default/published/unresolved/latest selection/draft behavior tests in `rpg_fe_local/tests/rule-picker.test.tsx` (pair with T068).
- [x] T068 [US2] Build `rpg_fe_local/src/features/rules/RuleSystemPicker.tsx` with backend options, latest-at-next-turn explanation and explicit default choice (pair with T067).
- [x] T069 [US2] Mount picker and submit selected/null system in `rpg_fe_local/src/pages/Setup.tsx`, retaining provider setup and unchanged defaults.
- [x] T070 [US2] Write failing expandable historical citations/safe quotes/outdated retry audit rendering tests in `rpg_fe_local/tests/rule-evidence.test.tsx` (pair with T071).
- [x] T071 [US2] Render bounded original quote/page/version/read evidence in `rpg_fe_local/src/features/rules/RuleEvidence.tsx`, linking current nodes with hash mismatch warnings and retaining failed/undone audit labels (pair with T070).
- [x] T072 [US2] Integrate picker/evidence and rule capability Send gating in `rpg_fe_local/src/pages/Play.tsx`, preserving composer drafts, explicit recovery and complete terminal answers.

**Checkpoint**: Full lint/typecheck/format/unit/isolated DB/build green. Default dice/source/compaction/undo/retry regressions pass. Book mode remains capability-disabled per provider until actual T085 validation; no all-provider release claim from fixtures alone.

### Phase 4 — US3: Reference-only campaigns and private backups

**Goal**: Restore games/libraries independently without public book bundles.
**Independent test**: Restore campaign first (viewable/unresolved/Send blocked), then library and explicit resolution; historical dice/citations intact.

- [x] T073 [US3] Write failing complete v3 reference/read/citation remapping, missing-library resolution, legacy normalization and template-reference tests in `rpg_be_local/tests/ruleArchives.database.test.ts` (pair with T074).
- [x] T074 [US3] Complete campaign v3 export/import/resolution and templates in `rpg_be_local/src/services/library.ts`; no full books, explicit ID remaps/unknown library status, v1/v2 default normalization, imported dice non-executable (pair with T073).
- [x] T075 [US3] Set the current campaign export version to the already supported v3 in `rpg_be_local/src/domain/versions.ts`; explicitly accept named legacy v1 and dice v2 independently of latest v3; do not use just [legacy,current] as today. Before this switch, T074 may select v3 explicitly for book-backed saves, retaining old default exports.
- [x] T076 [US3] Write failing private current-row backup/default restore, monotonic local revisions, 32-MiB staging, key collisions and atomic stale restore tests in `rpg_be_local/tests/ruleBackup.database.test.ts` (pair with T077).
- [x] T077 [US3] Implement backup/restore preview and local identity/current-row reconstruction in `rpg_be_local/src/services/ruleBackup.ts`; ≤32 MiB, no credentials/paths/scripts/PDFs, no silent existing-key replacement (pair with T076).
- [x] T078 [US3] Write failing bounded backup download/upload/confirm, static-route-vs-UUID routing and explicit reference-resolution HTTP tests in `rpg_be_local/tests/ruleBackup.http.test.ts` (pair with T079).
- [x] T079 [US3] Wire private backup preview/confirm and campaign reference resolution in `rpg_be_local/src/app.ts`; static /backups/imports routes precede or cannot match UUID :id routes; ordinary campaign upload remains 20 MiB, backup and its staging alone allow ≤32 MiB (pair with T078).
- [x] T080 [US3] Write failing separate backups/unresolved restore/default choice/hash-change disclosure UI tests in `rpg_fe_local/tests/rule-backup.test.tsx` (pair with T081).
- [x] T081 [US3] Build separate private backup/restore/resolution controls in `rpg_fe_local/src/features/rules/RuleBackup.tsx` with revision/single-flight/stale guards (pair with T080).
- [x] T082 [US3] Mount backup controls in `rpg_fe_local/src/features/rules/RuleSystemEditor.tsx`; campaign resolution links explicitly return to selected play view.

**Checkpoint**: Full suite/build green; old archives/default/templates and private/reference-only boundaries verified in isolated PostgreSQL.

### Phase 5 — Release evidence and documentation

- [x] T083 Add original synthetic Windows browser import/instructions/latest/citations/unresolved/default acceptance in `rpg_fe_local/tests/e2e/rules-library.spec.ts`; no live AI/book text in default tests.
- [x] T084 Add synthetic 596-node and 10,000-node/20-MiB lookup/context benchmark in `rpg_be_local/tests/rules.performance.test.ts`; 30 sequential queries, p95 warm <500 ms/cold <2 seconds, no whole-book prompt. Expensive benchmark is explicit opt-in; correctness/size regressions remain ordinary tests.
- [x] T085 Record actual Windows Codex/Claude/Antigravity rule→dice→rule→final through the isolated pre-enable harness, malicious reference, latest/retry and CLI-switch checks in `docs/reviews/rules-library-capabilities.md` and `rules-library-native-mcp.md`; versions/models/efforts/tool exposure/usage/latency and unverified alternatives, never infer native support from mocks. Prior Claude evidence is historical; fresh repeat is an explicitly deferred TODO until its weekly allowance is available.
- [x] T086 Enable only evidenced rule provider/model version gates in `rpg_be_local/src/providers/service.ts` after T085; blocked/unverified adapters remain explicitly unavailable for book mode, default gameplay remains supported.
- [x] T087 Document packages/endpoints/errors/page/provenance/tool limits/v3/default/private-backup semantics in `rpg_be_local/docs/api-contract.md`, aligned to actual backend owners.
- [x] T088 Explain source authority, instructions-only default, latest updates/outdated retry and external extraction/private backups in `README.md`; correct old dice-only exclusivity wording for book-backed mode.
- [x] T089 Record actual backend/native/DB/performance checks and limitations in `rpg_be_local/IMPLEMENTATION.md`.
- [x] T090 Record frontend/browser/draft/citation/restore checks and limits in `rpg_fe_local/IMPLEMENTATION.md`.
- [x] T091 Run final isolated migrations/full regression/browser/build/format/public audit and reconcile completion/evidence in `docs/plans/rules-library.md`; external extraction milestones are not app completion.

**Checkpoint**: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e --workspace rpg-fe-local`, `npm run audit:public` pass with isolated DB. Three actual Windows provider gates evidenced. Android/macOS/Linux excluded.

## Requirements and coverage

| ID      | Requirement                                                                                   | Tasks                                                 |
| ------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| FR-001  | Current fixed-column systems and protected instructions-only default.                         | T002–T012, T022–T025, T028–T030                       |
| FR-002  | Deterministic annotated Markdown with optional explicit enrichment evidence.                  | T001, T013–T016                                       |
| FR-003  | Preview/diff/atomic idempotent book replacement and manual instructions.                      | T019–T025, T028–T030                                  |
| FR-004  | Latest campaign selection and current-row revision guards.                                    | T031–T036, T043–T054, T067–T072                       |
| FR-005  | Four bounded read-only tools with page/source/hash provenance.                                | T017–T018, T039–T042                                  |
| FR-006  | Combine rule reads and preserved crypto dice through isolated providers.                      | T037–T062, T085–T086                                  |
| FR-007  | Original-text citations/audit and visible default/provisional behavior.                       | T045–T048, T063–T072                                  |
| FR-008  | Reference-only saves/private library backups/explicit missing-library restore.                | T073–T082                                             |
| FR-009  | Preserve legacy archives, default play, templates, undo and no-tools work.                    | T007–T008, T031–T036, T041–T054, T073–T075, T091      |
| NFR-001 | Named import/depth/call/transcript/native/output/deadline limits.                             | T002–T022, T039–T062, T084                            |
| NFR-002 | Sequential I/O, immutable migrations and current-row/read ownership, revision/lock ownership. | T009–T016, T019–T024, T031–T036, T047–T054, T076–T079 |
| NFR-003 | No books/secrets/executable reference text in public or shared CLI configuration.             | T013–T014, T055–T062, T076–T091                       |
| NFR-004 | Preserve drafts, accessible safe rendering, honest pagination/failure feedback.               | T026–T027, T025, T028–T030, T067–T072, T080–T083      |
| NFR-005 | Actual isolated DB, browser, performance and Windows provider evidence.                       | Test pairs, T083–T086, T089–T091                      |

## Self-review

| ID  | Severity | Finding                                                                                        | Resolution                                                                                                     |
| --- | -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R1  | High     | Mutable row mixes new rules with old rolls.                                                    | Check current row; changed head aborts old attempt/retry while preserving dice.                                |
| R2  | High     | Existing dice-only adapters lack rule allowlists/budgets.                                      | Owned registry, separate capabilities, native/byte gates, real acceptance before enabling.                     |
| R3  | High     | Cross-book same names overwrite sources.                                                       | Book namespace/complete single-source replacement, no inferred precedence.                                     |
| R4  | High     | Full nodes/mapping/fields exceed context.                                                      | Compact map, paginated results, serialized aggregate bounds and honest complete flags.                         |
| R5  | High     | Strict archives/JSON persistence omit new references.                                          | Compatibility groundwork before campaign fields, FK mirror and complete v3/private restore.                    |
| R6  | High     | Text matching falsely certifies visual/OCR fields.                                             | Explicit manual visual provenance; text remains authority, import never auto-verifies.                         |
| R7  | Medium   | Empty library resembles no-system model knowledge.                                             | Protected distinct kind and explicit selection/status, no silent fallback.                                     |
| R8  | Medium   | Automatic updates leave obsolete rules in memory.                                              | Keep bounded event memory; current books outrank old interpretations, no full-history rebuild.                 |
| R9  | Medium   | Extraction output is evolving independently.                                                   | T001 handoff, optional enrichment, recorded external milestone not claimed app verification.                   |
| R10 | High     | Browsing preceded its lookup service and saved rule evidence had no API hydration path.        | Move lookup into US1; add terminal receipt persistence/API tasks before chat components.                       |
| R11 | High     | Dice-only narrator instructions forbid rule tools and default model knowledge.                 | Add distinct default/book narrator contracts and adapter regression coverage.                                  |
| R12 | High     | Switching current archive version from v2 to v3 can reject v2 saves.                           | Accept named v1/v2/v3 independently of the current export version, with regression checks.                     |
| R13 | High     | External head checks leave races during dice draw, session creation and final commit.          | Validate under transaction locks; retain the initial RuleContext during compaction rebuild.                    |
| R14 | Medium   | Long cursors and large-node paging prevent affordable access to relevant passages.             | Compact bounded tokens, search-to-text locators and remaining-budget projections.                              |
| R15 | Medium   | Valid 32-MiB backups exceed the 20-MiB book-preview staging limit.                             | Separate preview limits, explicit static backup routing and monotonic restore revisions.                       |
| R16 | Medium   | Hash-only retries and duplicated transport requests undermine consistent audit/budgets.        | Compare local identity/revision/kind/hash; charge and replay once per transport request identity.              |
| R17 | High     | Native final validation can still reject valid book-v3 responses.                              | One selected runtime/JSON schema through context, each adapter and final commit; positive v3/v2 adapter tests. |
| R18 | High     | Removing page markers loses passage-level citation provenance.                                 | Preserve canonical direct-text page spans; exact pages only where known, otherwise approximate range/unknown.  |
| R19 | Medium   | Consumed previews and advanced revisions can reject a successful confirmation retry.           | Resolve persisted confirmation identity before preview/revision checks; changed reuse conflicts.               |
| R20 | Medium   | Browse/Search UI was promised without its own implementation/behavior tests.                   | Add a bounded browser component/test pair before editor integration.                                           |
| R21 | Medium   | Exhaustive mapping cannot fit 10,000 nodes in 32 KiB.                                          | Map generic layouts only; discover paths through bounded search/list.                                          |
| R22 | Medium   | Live evidence is required before enablement but ordinary dispatch blocks unverified providers. | Isolated opt-in pre-enable harness invokes candidate adapters without relaxing native checks.                  |

**Coverage**: 14/14 requirements. **Stories**: 3. **Original tasks**: 91, 90 checked. **Open product clarifications**: 0. **External gate**: extraction-owner handoff confirmation after actual package validation. **Technical evidence**: measured lookup/cache and actual native provider accounting; Claude historical acceptance plus current Codex/Antigravity continuous-loop acceptance. Fresh Claude recheck is a user-deferred weekly-quota TODO.


## Implementation evidence and remaining handoff (updated 2026-10-02)

90 original tasks are implemented/verified. The test filenames in the original design were grouping suggestions: related ownership/database/HTTP scenarios were consolidated rather than duplicated across tiny files. This mapping identifies actual evidence; checked tasks do not infer native support from fixtures or invent owner confirmation.

| Tasks | Actual evidence |
| --- | --- |
| T002–T008 | rules.test.ts, ruleArchiveCompatibility.test.ts; strict schemas, kinds, limits, UTF-16 provenance, named v1/v2/v3 compatibility and positive default/book contracts. |
| T009–T012, T019–T024, T031–T036 | rules.database.test.ts (12 isolated-PG tests), rulePreview.test.ts; fresh migrations/protected seed, mirrors, locks, receipts, publication/no-op/replay, staging, HTTP protections, selection, streaming aggregate limits. |
| T013–T018 | ruleImport.test.ts, ruleMapping.test.ts, ruleLookup.test.ts, rules.performance.test.ts; original annotated fixtures, page spans/UTF-8/hashes, derived non-enumerating layouts/drift/field omissions, opaque token bindings, Unicode case-fold offsets, numeric filters, per-column map continuation and bounded original windows. |
| T025–T030 | rules-library.test.tsx, rule-browser.test.tsx; served metadata, safe import/editor drafts and paginated on-demand browser. |
| T037–T046 | gameplayNarrator.test.ts, gameplayTools.test.ts, diceMcp.test.ts, ruleContext.test.ts, ruleResponse.test.ts; exactly owned tools/default scope, lower verified/native independent budgets, cancellation/replay, no-books bounded prompt, overflow and original receipt quotes/pages. |
| T047–T054, T063–T066 | ruleGameplay.database.test.ts (3 isolated-PG tests), rules.database.test.ts and existing dice.database.test.ts; publication during compaction/session/draw/final, retained audit/face, ownership/lease/cancellation/undo, latest action and retry digest, terminal-only/cross-campaign/16-KiB pagination. |
| T055–T062 | rulesAdapters.test.ts plus existing claudeDice/codexDice/antigravityDice/provider boundary tests; positive strict v3/default v2 and shared native isolation/allowlists/overflow regression. Native evidence is separate below. |
| T067–T072, T080–T082 | rule-play-backup.test.tsx plus existing Play/Setup/provider tests; backend options, literal quote/current mismatch/undone audit, explicit private replacement and stable uncertain-confirm replay. |
| T073–T079 | rules.database.test.ts, ruleArchiveCompatibility.test.ts and dice.database.test.ts; v3 reference/read remaps, absent/exact-key/hash resolution, no full books, named legacy compatibility, local monotonic restore and static HTTP/write boundaries. |
| T083–T084 | Windows Chrome rules-library.spec.ts: real isolated-PG import/instructions/reference/unresolved/default recovery; synthetic citation/latest warning scenario. Explicit real-PG maximum-size benchmark: 30 sequential warm/cold queries per fixture. |
| T085–T090 | rules-library-capabilities.md, rules-library-native-mcp.md, api-contract.md, README.md and both IMPLEMENTATION.md files; exact independently enabled Windows gates for all three providers, measured native/cache budgets and explicit limitations. |

T001 remains unchecked only for extraction-owner confirmation. Authorized read-only inspection located the actual splitter, original PDF and eleven private annotated Markdown columns. All 598 nodes/4599 nonempty body lines/1180557 bytes passed literal digest/order and sampled UTF-16 validation with unchanged file hashes; PDF metadata confirms 431 pages. No manifest was delivered, so the maintained read-only `rules:manifest` command prepared and validated one outside the private columns. Nothing private was edited or committed. The precise owner input still required is acceptance of manifest metadata and the canonical direct-text/LF/UTF-16 contract for future enrichment. See [handoff evidence](../reviews/rules-library-handoff.md); earlier external 596-node milestones remain historical and do not certify OCR coverage.

T085 is now checked on actual evidence. Claude 2.1.232/sonnet/medium retains its previously successful real MCP and complete campaign runs. Current Codex 0.159.2/gpt-5.6-sol/medium replies to pending calls continuously and passed direct and complete campaign checks. Antigravity 1.2.14/Gemini 3.8 Flash uses proper owned private MCP, passed low direct/full scenarios and medium direct plus two full Codex→Antigravity campaigns (46.728/45.528 seconds). Late publication, failed audit, retry denial, provider switch and latest literal citation remain enforced. Initial JSON-phase native failures remain historical failures; they were fixed by the transport change, not an expanded intrinsic tool allowlist. Fresh Claude validation is a user-requested TODO after weekly quota availability. Other models/efforts and Android/macOS/Linux remain unverified.

T091 records executed checks and reconciliation. Final verification uses PostgreSQL 18 in the separate owned loopback cluster on port 55439, release test database rpg_rules_release_test, a new browser-only test database and disposable schemas; migrations 0001–0007 succeeded. Test/build/audit outputs and native/cache measurements support checked tasks. No commit/push or changes to shared skills/shared CLI configuration were made.

### Final executed checks (2026-10-02)

| Check | Result |
| --- | --- |
| Fresh isolated PostgreSQL migrations 0001–0007 and migration-runner upgrade/replay regression | Passed; release_test database plus owned disposable schemas. |
| NODE_ENV=test + RPG_TEST_DATABASE_URL, npm test | Backend 110 passed, 12 explicitly skipped opt-in checks (122 total); frontend 35 passed across 10 files. Normal parallel root script passed; sequential backend diagnostic also passed. |
| npm run typecheck; npm run lint; npm run format:check | Passed; zero lint warnings. |
| npm run build (NODE_ENV unset) | Passed; production client 342.63 KiB JavaScript, 9.69 KiB CSS. |
| Windows Chrome npm run test:e2e --workspace rpg-fe-local | 10 passed, 5 explicitly skipped unrelated opt-in runtime checks. LOCAL_RPG_RULES_SMOKE=1 enables the real isolated-PG rules browser scenario. |
| RPG_RULES_BENCHMARK=1, rules.performance.test.ts | 2 passed; maximum 20 MiB cold/warm p95 161.672/48.629 ms; guarded cached repeat p95 0.749 ms. Thirty sequential samples, four primed repeat queries; exact methods in native MCP report. |
| Explicit actual native rules probes / complete campaign scenario | Current Codex and Antigravity direct/full continuous-loop checks passed; Claude historical passes retained and fresh repeat explicitly deferred. Current real persisted default dice→v2 checks: Antigravity 14.325 s, Codex 10.200 s. Native Codex anonymous loopback protocol fixture independently passed. Ordinary tests skip live models. |
| npm run audit:public with official portable Gitleaks 8.30.1 | Passed after documentation alignment: 226 public files, two built bundles, seven existing commits, zero findings. Scanner/report live in owned local TEMP outside repository. |
| git diff --check | Passed. |

Backend opt-in skips: native Codex offline/context tests, the separate 1000-turn real-PG stress scenario, the four live rules-provider/integration scenarios, expensive rules benchmark and local PDF/audio runtime checks. Rules-native/benchmark checks listed above ran independently; other skipped runtimes are not certified by this feature run. Browser opt-in skips: actual Antigravity selector, additional manual real-PG roundtrip, local voice, production NIC LAN and local dictation. Synthetic 1000-turn context regression, existing isolated-PG dice/source/compaction/undo/retry and Windows browser regressions passed.

The finished application work is reviewable in the working tree. Remaining original work is specifically T001 extraction-owner confirmation; actual package compatibility was independently validated. Fresh Claude recheck is explicitly deferred by the user until weekly quota availability, with no scheduled retry or new login requirement asserted. Cross-logical-turn warm process pooling is intentionally not implemented or claimed: native tools are continuous within each bounded action, with authoritative reconstruction for the next action.

### User-authorized continuation evidence

- Native owned tools now continue within one bounded logical turn for all three CLIs; no fresh process per tool. Antigravity default mode also uses native MCP and keeps v2 finals.
- Shared immutable revision-keyed snapshot/search caches remain behind authoritative head, ownership and receipt-persistence guards; real PG stale-head/mutation tests and fresh native receipts passed.
- The canonical gameplay registry owns name/description/schema/runtime validation/purpose/capability/handler. Providers translate its definitions and dispatch generically; one original synthetic extension crossed authenticated MCP and rejected foreign tools/arguments without being exposed in production.
- Native cache telemetry is recorded where present; Codex reported actual cached input, Antigravity zero, and fresh Claude measurement remains TODO. No subscription credit-saving promise is inferred from API docs.
- Fresh Claude native repeat after weekly subscription availability is **TODO (explicitly deferred by user)**. No automation was requested or created.

See [current native MCP/cache/extension report](../reviews/rules-library-native-mcp.md) for the complete measured evidence, failed diagnostic attempts and practical transport limitations.
