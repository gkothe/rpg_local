# Plan: Campaign knowledge and instruction cleanup

**Status:** Ready for implementation — two independent rounds completed | **Date:** 2026-10-03 | **Mode:** default

**Request:** “ok, pode no plano junto com a parte de salvar as infos”;
“NPCs e fatos importantes, automaticamente”; “Sim; salvar automaticamente e
distinguir rumores de fatos”; “Só salvar para o GM lembrar, sem interface específica”.

## Summary

Preserve the entire selected `rule_systems.instructions` text as the principal
GM behavior prompt, with optional campaign instructions. Remove duplicated
application narration instructions and keep a single technical integration
contract per CLI request. Persist important established/improvised campaign
knowledge with provenance and belief status, automatically and atomically with
the turn. Give the GM access to durable knowledge without depending on a provider
session or a lossy memory summary. No dedicated knowledge editor or Journal view.

## Context and evidence

- Windows, Node/TypeScript ESM, Express, Zod, PostgreSQL JSONB campaign documents,
  React/Vite frontend; root workspaces and existing migration runner.
- `docs/reviews/prompt-instruction-duplication.md` contains the verified review.
  One Antigravity gameplay input repeats the same 1,783-character narrator block
  in user context and agent instructions. This is approximately 8.5% of that
  input's characters, not measured tokens. Claude/Codex have the same code pattern.
- `domain/context.ts` owns context; `domain/gameplayNarrator.ts` owns current policy;
  native adapters install agent instructions.
- `domain/state.ts` applies character/state operations and produces undo snapshots;
  `services/turns.ts` validates and commits turn, state and snapshot together.
- `src/store.ts` stores campaign documents; `services/library.ts` validates and
  remaps archives/templates; `domain/diceContext.ts` owns retry-context identity.
- Old `rpg_be/src/services/rpgLogic.js` requests `existingInfo` but does not consume
  that field on save. `generated_things` contains chat and others, not reliable
  per-fact source provenance. Do not reproduce that unused boolean.
- Existing behavior tests live in `rpg_be_local/tests`; frontend Vitest tests in
  `rpg_fe_local/tests`; gated DB/native tests must be reported separately.

## Clarifications

- Q: Keep the entire selected system instructions column? → A: Yes; it should be
  the principal GM text. Additional app instructions should be technical only.
- Q: What is registered? → A: NPCs and important continuity facts automatically;
  not every descriptive detail.
- Q: Approval? → A: No approval step. Distinguish established facts from rumors/beliefs.
- Q: Dedicated UI? → A: No; persist information so the GM remembers it.

## Must not change

- Never rewrite, summarize or update the system instructions column during cleanup.
  Keep optional campaign instructions intact; preserve each column's content,
  including whitespace, without a new prompt-size rejection.
- Fresh provider session per player action; native tool continuations within that
  action share a session. Preserve existing subscription authentication/isolation.
- Trusted dice, saved faces across retries, original-book citations, automatic
  validated changes, revision checks, cancellation and complete undo.
- Latest selected rules for new turns, frozen context for in-flight turns/retries.
- Private notes stay out of prompts and knowledge. No automatic book modification,
  house-rule authoring, extra summarization call every turn, network service or dependency.
- No Android/macOS/Linux acceptance work; Claude live verification remains deferred
  while the user's weekly quota is exhausted. Mocked checks cover its adapter contract.

## User stories and acceptance

### US1 — One clear instruction hierarchy (P1)

The player-selected system prompt controls GM behavior; the app adds one minimal
technical contract, rather than competing generic narrator prompts.

Acceptance: exact selected instructions and optional campaign instructions arrive
once per request; generic rules occur once across user and system input; the rule
overview describes available content without restating policy. Dice/citations/JSON
still work for book and model-knowledge systems across all three adapters.

### US2 — Durable campaign knowledge (P1)

Important new NPCs, places, relationships, debts, objectives and events persist with
their origin and belief status when a valid turn completes.

Acceptance: an improvised tavern remains available after history compaction and a
CLI switch; an NPC's allegation stays an allegation; a source-derived fact retains
its source reference; failed/cancelled attempts save no knowledge changes. Undo
removes/restores every knowledge change from the turn, alongside characters/state.

### US3 — Recall without copying the entire registry (P1)

The GM gets relevant established knowledge and can query older records within the
same turn, even with no rule system/library selected.

Acceptance: a long campaign can retrieve an old named location outside recent
history. Tool access is restricted to the frozen campaign registry, with no write
tool, SQL, filesystem or other campaign access. Memory never silently converts
rumors into facts or replaces registry state.

### US4 — Existing saves and portable knowledge (P1)

Old campaigns continue without guessed historical origins; new exports preserve
knowledge and undo links. The existing chat change list includes saved knowledge.

Acceptance: archives v1–v3 still import; new-format export/import remaps record,
character, source and turn links consistently; templates do not inherit another
campaign's timeline or dangling provenance. No dedicated frontend view is added.

## Requirements

- FR-001: Selected system instructions and optional campaign instructions are full
  texts, once each. The sole technical contract defines response/operations,
  trusted tool use, source treatment, citation requirements and ownership boundaries;
  it must not invent tone, pacing, difficulty, narration length or game mechanics.
- FR-002: Each persisted knowledge record has stable identity, structured origin,
  belief status, lifecycle and creating/updating event attribution. There is no
  answer-wide `existingInfo` flag.
- FR-003: Automatic knowledge changes are produced in the same final structured
  response as narration/character/state changes, not an additional extraction call.
- FR-004: Source references are validated against frozen supplied campaign-source text or current-turn original-book receipts; a claimed book/source origin without
  supporting material is rejected, not silently converted to invented canon.
- FR-005: All changes apply atomically after validation; retries do not duplicate
  records and cancelled/failed attempts do not establish facts. Undo checks actual
  touched records to avoid overwriting subsequent manual/external changes.
- FR-006: Relevant knowledge is supplied as data, and older knowledge remains
  queryable through owned native tools. Retrieval targets are soft; no new AI
  token/output/time limits or silent fact deletion.
- FR-007: Origins/statuses survive memory compaction, archive remapping and provider
  switching. Imported/legacy uncertainty must remain explicit.
- FR-008: Reuse existing change list and Advanced state/debug inspection; add no
  dedicated editor, approval step or Journal subsection.
- NFR-001: Zero additional LLM calls for normal knowledge persistence. All DB writes
  stay in existing short locked transactions; no database transaction spans CLI work.
- NFR-002: Prompt logs record the exact post-assembly system/user inputs. Deterministic
  checks count policy occurrences and text preservation; do not promise measured
  cost, caching or latency gains without native evidence.

## Decisions

| Decision | Why | Alternative rejected |
|---|---|---|
| Preserve system column; one technical agent block | User owns behavior; app owns integration | Editing the Vampire column to fit duplicate app policy |
| Typed campaign knowledge in campaign JSONB | Matches existing state/snapshot/archive pattern | A parallel `generated_things` table duplicating turn storage |
| Per-record origin, not per-response boolean | Mixed responses contain source and improvised material | Treating the entire answer as original or invented |
| Save via final response; read via tools | One commit, existing retries and no extra AI call | Side-effecting knowledge MCP writes during generation |
| Reuse tool registry for read tools | All CLIs already have owned tool definitions | Prompt-specific JSON pseudo-tools |
| No dedicated knowledge UI | Explicit user answer | New Journal editor/approval workflow |

## Data and contracts

### Campaign knowledge

Add `Campaign.knowledge: CampaignKnowledge[]`, default `[]`. Store this top-level
typed field separately from the free-form `state` object. Character statistics and
inventory remain owned by characters, not mirrored into knowledge; knowledge links
an NPC introduction, relationship or narrative fact to its character when relevant.

Each record:

- `id`: server-generated UUID; `kind`: backend enum `npc`, `place`, `relationship`,
  `debt`, `objective`, `event`, `other`; `title`: trimmed nonempty string, using the
  existing `MAX_ENTITY_NAME_CHARS`; `text`: trimmed nonempty string, using existing
  `MAX_LONG_TEXT_CHARS`. These are persisted data validation, not AI capacity limits.
- `origin`: backend enum `source`, `gm`, `player`, `unknown`. Creation attribution
  is immutable; updates retain their own attribution. A mixed paragraph is split
  into facts rather than assigning a misleading single origin to all its clauses.
- `certainty`: backend enum `established`, `rumor`, `belief`; optional `holderId`
  refers to a campaign character at linking time. Rumor/belief can exist without a named holder,
  but its text must describe who/what claims it rather than assert it as truth.
- `status`: backend enum `active`, `resolved`, `retracted`; `characterIds`: unique
  campaign character UUIDs, validated as existing at creation/link update. Persist
  server-captured display names alongside each reference, including an optional
  holder, for historical identity after deletion. Duplicate names are allowed;
  identity is by ID, not name. Deleted character references remain historical,
  are labeled as such on lookup, and never imply a live character available to
  modify. Do not block existing character deletion merely to keep facts valid.
- `createdTurnId`/`updatedTurnId`: owning turn UUID or null for non-turn creation;
  UTC timestamps and monotonic record revision assigned by backend, not the LLM.
- `evidence`: discriminated source references: campaign source ID/version/quote/
  UTF-16 offsets, or validated original-book receipt identity and provenance from
  current-turn rule reads. Campaign-source coordinates are absolute UTF-16
  offsets into the saved source text: `end = start + quote.length`. Every supplied
  excerpt carries source ID, version, name and absolute span start/end. Reuse
  `sourceSections` metadata for pinned and retrieved sections. Verify that the
  claimed quote lies wholly within one actually supplied frozen span; normalize
  quote coordinates relative to that span only inside validation. Multiple
  excerpts with the same ID/version remain distinguishable by their span.
  These are campaign evidence references, not original-book rule receipts. Existing book citation validation is reused. `source`
  requires evidence; other origins cannot masquerade as book receipts.
- `attributions`: append-only update entries with event origin, turn identity and
  supporting references; schema/ownership server controlled. Do not copy full
  character sheets, book sections or entire narration into each entry.

`existingInfo` is a display/debug interpretation of origin: source = existing in
supplied material, gm = improvised, player = player-established, unknown = legacy
unclassified. Do not expose a boolean that hides those distinctions. Identifying
origin is the model's assertion plus backend reference validation; the app cannot
prove semantic truth or automatically discover every contradiction.

### Final response and operations

Introduce a named gameplay response version 4 and archive version 4 in
`domain/versions.ts`, retaining legacy v1–v3 parsers for stored artifacts. New book
and no-library turns use one v4 shape: narration, existing operations,
rollInterpretations, ruleCitations (empty without a library), and `knowledgeChanges`.
Do not feed v4 into `responseSchema` v1 without an explicit validated conversion.
All v4 adapter validators remain strict; old versions are accepted only through
explicit archive or original-frozen-retry paths, not as a downgrade of a new turn.

`knowledgeChanges` supports create and update; no physical delete. Creates receive
server IDs. Updates use an existing record ID plus exact expected prior revision
and validated changed fields; origin/IDs/audit metadata cannot be overwritten.
Changes explicitly mark retraction/resolution or rumor-to-established transition.

A new character operation carries provenance for its introduction. The backend
automatically creates exactly one linked NPC introduction record per created
character ID for `type=npc`; explicit facts must not create a second introduction; this avoids
requiring the model to invent the character's eventual UUID. Additional facts in
the same response can link to a newly created character by its zero-based character
operation index in the complete `operations` array (not its filtered create
subsequence); resolve that alias after staging operations, reject invalid
or non-create indexes, and never persist the alias. Existing characters use UUIDs.
Imported player sheets are not automatically invented GM content.

For a source NPC whose debt is improvised, store the NPC introduction as source
and the debt as GM origin. Player questions, intentions, guesses and hypothetical
actions are not established facts; only accepted contributions/results qualify.
Provisional mechanical rulings are not promoted into permanent house rules. This
version does not add a rule-authoring or ruling-precedence registry.

Validate the whole response before any canonical write. Missing/invalid required
knowledge metadata enters the existing bounded malformed-response recovery,
preserving saved dice. Exact record changes produce human-readable entries in
`turn.changes`; history already stores those results. No promise to capture every
important detail is technically enforceable; use prompt instructions and scenario
acceptance tests, not fabricated backend inference from prose.

### Recall and frozen context

Always include unresolved debts/objectives, knowledge linked to current player and
relevant scene entities, and records explicitly referenced by the action. Other
relevant records use deterministic case-folded title/text matching and recency with
the existing soft retrieval budget; do not add fixed history/fact truncation as a
hard rejection. Include compact IDs/titles/kind/origin/certainty for navigation,
with paginated access when the registry grows; the full registry stays durable.

Add owned read-only `campaign_knowledge_search` and `campaign_knowledge_get` tool
registrations using the same backend definitions for every CLI. Search accepts a
query, optional kind/status filters and opaque cursor; get accepts an existing
knowledge UUID. IDs are scoped to the captured campaign, not arbitrary DB keys.
Both read the turn's immutable captured registry in memory, never live mutable
campaign state. Search returns summaries/status/origin; get returns the complete
fact and evidence. Default search and initial selection include active records;
resolved/retracted results require an explicit status filter or exact-ID retrieval
and retain their status label. Knowledge reads have their own capability category;
they must not consume dice request/face counters or count as authoritative rule
reads. Presence of a registry must not be used as a proxy for library mode: today
several adapters use `!!book` to select their schema/MCP path. Carry the actual
rule-context mode independently so no-library knowledge does not activate book
requirements or misselect a response schema. Registry reads create no new authority receipts for books.

Persist the frozen registry snapshot once per root dice session, not once per tool
call or retry. The authoritative container is the existing `dice_sessions` row,
extended with `prompt_contract_version`, `digest_version`, `system_prompt` and
`frozen_knowledge` and `tool_definitions` nullable JSONB for legacy sessions. Its existing `frozen_prompt`
remains the user input. New-session fields, including the frozen registered-tool names/schemas needed for retry, are populated atomically at creation;
legacy missing metadata means legacy contract/digest, not v4. New fields are
protected by an updated immutable-session trigger in the new migration. Never
backfill fabricated historical instructions/knowledge into old sessions.

New canonical turn manifests persist session identity/contract version and user
context, not another complete knowledge snapshot or native system text. Context
inspection may hydrate those fields from the authoritative session without storing
a second copy; pending assembly can carry a transient envelope until session
creation. Do not discard selected system/campaign text before freezing the native
envelope. Manual retries load saved session metadata; automatic recovery uses the
same captured data. Export/import includes the authoritative session metadata. For new sessions include knowledge in a versioned gameplay digest; changes between turns invalidate
obsolete executable retries using the existing conflict behavior. Legacy sessions
use the original digest algorithm with its exact original keys; do not add even
`knowledge: []` to legacy hash inputs. Both manual retry and advertised retry
availability must select digest version from the saved session, not current code
defaults. A legacy retry cannot silently ignore nonempty new knowledge: report a
context-change conflict in that case. Memory summaries
are derived and cannot override registry certainty/status or sources. New sessions
remain stateless at the provider level. No duplicate copy of the full registry in
both the prompt and frozen snapshot unless required for the selected initial subset.

### Persistence, migration and compatibility

Use a new `0008_campaign_knowledge.sql` only if that ordinal is still free at
implementation time. Add nullable/default-legacy session metadata columns and replace the immutable
function in this new migration; initialize campaign knowledge only after the
archive compatibility gate. Preserve untouched legacy session hashes and prompts.
Use the existing migration system; no applied migration
edits. Existing characters keep their current schemas, with unknown origin unless
new evidence is deliberately added. Do not reconstruct past provenance by an LLM.

Snapshots record before/after touched knowledge and created IDs; undo checks those
records just as it checks touched characters. Legacy snapshots without knowledge
metadata mean “this turn changed no tracked knowledge”, never “clear all knowledge”.

New exports contain registry, attribution and snapshot metadata. Old archives default
missing knowledge to empty. Remap source/character/turn/knowledge UUIDs in records,
attributions and snapshots; preserve external system/hash/path references. Imported
archive sessions keep existing non-executable retry rules. Historical source versions
may no longer be available after a replacement: retain saved evidence and explicitly
identify historical/unavailable material; do not relabel it as a current citation.
Physical campaign-source deletion follows the same policy: retain the existing
validated quote, captured source name/version and historical identity in knowledge,
attribution and snapshots. Do not block deletion or retain the full original upload
just to preserve that evidence. Archive remapping must allocate historical source
IDs even when no current source object exists. Lookup clearly distinguishes the
retained quote from an available current document; it cannot mint a new book-rule
citation from historical campaign evidence. New origin claims still require actual
supplied text; existing validated evidence remains historical evidence after deletion.

Templates are reusable setup, not live-history backup: omit timeline knowledge and
turn attribution. Preserve character setup as today, without copying historical
origin links to old campaigns. Newly instantiated template characters begin with
unknown origin until actual source evidence is attached. Full campaign export is
the supported path for retaining the entire played campaign.

New frozen failed turns must retain their stored native system envelope, user input,
registered capability set and response contract on retry. For legacy sessions, the
original native system text was not persisted: preserve the frozen user prompt and
its response schema, reconstruct the known legacy narrator block from that frozen
input, and use explicit legacy adapter compatibility. Do not claim byte-identical
reconstruction of unrecorded historical native instructions. If an unknown legacy
contract cannot be reconstructed, surface that limitation and preserve saved dice
instead of silently upgrading it. Infer legacy response version from its frozen
schema only; this is not evidence of the exact historical native system text.
Use legacy response parsers without retroactive knowledge invention. No new turn may
use legacy narration policy after the new contract is enabled.

### Instruction assembly

Keep selected system instructions once in native agent/system input, followed by a
single technical contract and optional campaign instructions clearly labeled as
preferences. User input contains context/data/output schema; it does not duplicate
these instruction texts. The inspectable manifest/log must explicitly identify both
system and user input, hydrating the frozen system envelope from the root session. Update consumers currently parsing `mandatory.characters`
without breaking their data paths. Empty instructions remain valid: add only a short
neutral GM role fallback when neither system nor campaign supplies behavior, plus
the technical contract. No-library mode remains playable.

System behavior/campaign preferences cannot change tool ownership, validation or
book provenance. Do not rely on word order to enforce this: isolation and validation
remain in code. Contract mentions only actually registered tools. Rule overview
contains dynamic categories/navigation; remove its duplicated policy prose.

Antigravity's explicit textual tool schemas are a separate validation gate. Remove
them only after a successful live native MCP discovery, dice and rule/knowledge
lookup check. If this runtime needs guidance, retain a minimal exact tool/server
instruction and document evidence. Do not require that optimization for US2–US4,
nor remove tool definitions from MCP. Codex's transport JSON wrapper remains intact.

## Assumptions and risks

- No UI for knowledge correction in this scope. Context/tool logs support inspection
  of supplied/retrieved records; do not claim a full-registry UI already exists; no raw state editor may bypass typed knowledge validation.
- Only important continuity data is registered. Automatic selection by the model
  can miss facts; audit with completed-turn examples and show saved changes in chat.
- Source provenance proves the cited text was supplied, not that an interpretation
  is correct. Contradictions must be labeled; never claim hallucinations are prevented.
- Schema/UUID remapping and legacy retry contracts are the highest compatibility
  risks; their regressions are explicit acceptance gates below.
- No private-book dump, real log, campaign source or credentials enters Git.

## Complexity

| Addition | Why needed | Simpler alternative rejected |
|---|---|---|
| Typed knowledge registry | Stable identity/origin/rumor status survives compaction | Free-form state cannot reliably validate those distinctions |
| Two owned read tools | Old knowledge remains reachable without huge turn prompts | Sending all facts or relying only on summaries |
| Response/archive v4 | Explicit strict contract transition | Strict parsers reject unknown fields; unversioned extensions cannot express safe legacy/new dispatch |
| Frozen registry metadata | Deterministic native lookup across retries | Live reads mix changed facts into an older turn |

## Tasks

All paths are relative to the monorepo root. Tasks are ordered; do not publish a
half-enabled response contract. All new persisted fields and instruction envelopes, not only knowledge writes,
remain dormant until the activation gate at T051.
Test/implementation pairs must pass before advancing. No parallel task flags: schema
and archive dependencies require coordinated sequential work. Until the activation
gate, neither migration execution nor new campaign/manifest fields may alter live
exported documents. Additive schemas can be tested before activation; writing new
fields requires updated archive acceptance/export in the same release. The release
procedure is stop app, migrate, start the compatible build; no mixed-version server
rolling deployment is required for this local Windows app.

### Phase 1 — Contract foundation

- [ ] T001 Define record/operation/evidence Zod schemas, backend enums and the existing text constraints above in `rpg_be_local/src/domain/knowledge.ts`.
- [ ] T002 Add legacy-compatible campaign/snapshot/frozen knowledge and system/user instruction envelope types in `rpg_be_local/src/domain/types.ts` (after T001).
- [ ] T003 Add named v4 response/archive constants while keeping current enabled versions unchanged in `rpg_be_local/src/domain/versions.ts`.
- [ ] T004 Add the new v4 response parser with strict knowledge fields and legacy dispatch in `rpg_be_local/src/domain/gameplayResponse.ts` (after T001–T003).
- [ ] T005 Create the additive knowledge initialization migration in `rpg_be_local/migrationssql/0008_campaign_knowledge.sql`; verify filename remains unused.
- [ ] T006 Prepare dormant new-campaign knowledge initialization in `rpg_be_local/src/domain/campaign.ts`; do not emit the new field before archive activation.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm test` pass; run migration on an isolated test DB and prove repeat execution is a no-op.

### Phase 2 — US1: Instruction cleanup

**Independent test:** count the policy block in composed inputs and compare system/campaign strings byte-for-byte for book/no-library prompts.

- [ ] T007 [US1] Add preservation/deduplication and empty-instruction tests in `rpg_be_local/tests/gameplayNarrator.test.ts` (pair T008).
- [ ] T008 [US1] Implement one neutral technical-contract builder in `rpg_be_local/src/domain/gameplayNarrator.ts`, retaining legacy narrator exports for frozen retries.
- [ ] T009 [US1] Add full-instructions and data-only context regression tests in `rpg_be_local/tests/context.test.ts` (pair T010).
- [ ] T010 [US1] Prepare version-selected native instruction envelope/user context assembly in `rpg_be_local/src/domain/context.ts`; preserve exact column content and keep legacy output enabled until the shared archive activation gate.
- [ ] T011 [US1] Make overview navigation-only in `rpg_be_local/src/domain/ruleMapping.ts`.
- [ ] T012 [US1] Extend exact system/user input logging in `rpg_be_local/src/providers/promptLog.ts` without recording credentials.
- [ ] T013 [US1] Pass the one composed instruction block to native Claude in `rpg_be_local/src/providers/claudeDice.ts`.
- [ ] T014 [US1] Pass the one composed instruction block without duplicating model-base/file policy in `rpg_be_local/src/providers/codexDice.ts`.
- [ ] T015 [US1] Pass the one composed instruction block to Antigravity in `rpg_be_local/src/providers/antigravityMcpBook.ts`; retain textual tool schemas until the live gate.
- [ ] T016 [US1] Verify all native-adapter payloads, actual tool names, schema presence and extraction/memory independence in `rpg_be_local/tests/rulesAdapters.test.ts`.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; no system-column edit; new-contract test inputs have no duplicate narrator policy while live manifests remain compatible until activation.

### Phase 3 — US2: Atomic knowledge and undo

**Independent test:** an NPC plus invented debt is saved with distinct origins; an NPC rumor remains a rumor; undo restores exact prior records.

- [ ] T017 [US2] Add create/update/rumor/source-evidence/alias/conflict tests in `rpg_be_local/tests/knowledge.test.ts` (pair T018).
- [ ] T018 [US2] Implement staged knowledge validation/application in `rpg_be_local/src/domain/knowledge.ts`; server IDs/audit fields, exact prior revision, evidence checks, no physical delete.
- [ ] T019 [US2] Add mixed character/state/knowledge atomic application and undo conflict tests in `rpg_be_local/tests/state.test.ts` (pair T020).
- [ ] T020 [US2] Integrate v4 operations, NPC introduction records and touched-record snapshots into `rpg_be_local/src/domain/state.ts`; preserve legacy snapshot semantics.
- [ ] T021 [US2] Add old-session digest/empty-registry compatibility tests in `rpg_be_local/tests/diceContext.test.ts` (pair T022).
- [ ] T022 [US2] Implement legacy/new digest version dispatch in `rpg_be_local/src/domain/diceContext.ts`; legacy hashing retains exactly the original keys and empty-knowledge retry identity.
- [ ] T023 [US2] Select saved digest version in retry availability/hydration in `rpg_be_local/src/store.ts` (after T022).
- [ ] T024 [US2] Add malformed-knowledge recovery classification in `rpg_be_local/src/domain/responseRetry.ts`; retain existing retry counts and dice preservation.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm test` pass; v4 remains dormant until its tool/provider wiring is ready.

### Phase 4 — US3: Frozen recall and enable gameplay

**Independent test:** retrieve an old location after compaction and provider switch, without reading a different campaign or changed live state.

- [ ] T025 [US3] Add frozen search/get, relevance, cursor and cross-campaign rejection tests in `rpg_be_local/tests/knowledgeRecall.test.ts` (pair T026).
- [ ] T026 [US3] Implement frozen search/get, relevance selection and opaque pagination in `rpg_be_local/src/domain/knowledgeRecall.ts` (after T025).
- [ ] T027 [US3] Register backend-owned read-only knowledge tools for library and no-library turns in `rpg_be_local/src/providers/gameplayTools.ts`; add a distinct knowledge capability, avoid counting reads as dice/rules, and derive actual definitions from the registry.
- [ ] T028 [US3] Add no-library native registry/schema dispatch regression tests in `rpg_be_local/tests/gameplayExtension.test.ts` (pair T029).
- [ ] T029 [US3] Extend the `Generator` gameplay interface and CLI routing to carry explicit schema, instruction envelope and owned registry independently of book mode in `rpg_be_local/src/providers/service.ts`; leave extraction/memory generation interfaces unchanged.
- [ ] T030 [US3] Add optional strict frozen-session metadata to `rpg_be_local/src/domain/dice.ts`, preserving legacy archive acceptance.
- [ ] T031 [US3] Write native envelope/frozen knowledge/digest versions at root session creation in `rpg_be_local/src/services/dice.ts`; load the same data for retries, protected by the new migration (after T030).
- [ ] T032 [US2] Wire v4 turn generation/validation and atomically commit knowledge/frozen registry metadata in `rpg_be_local/src/services/turns.ts`; preserve legacy frozen retry parsing, consume complete v4 knowledge changes without stripping them in the current v1 conversion, and use the same versioned digest as retry availability (after T017–T027 and T029–T031).
- [ ] T033 [US3] Include relevance-selected knowledge and explicit rumor/status labels in `rpg_be_local/src/domain/context.ts`; keep complete records available through frozen tools.
- [ ] T034 [US3] Update Claude response dispatch/tool ownership to v4 and the registered knowledge tools in `rpg_be_local/src/providers/claudeDice.ts`.
- [ ] T035 [US3] Update Codex response dispatch/tool ownership to v4 and the registered knowledge tools in `rpg_be_local/src/providers/codexDice.ts`.
- [ ] T036 [US3] Update Antigravity response dispatch/tool ownership to v4 and the registered knowledge tools in `rpg_be_local/src/providers/antigravityMcpBook.ts`.
- [ ] T037 [US2] Add isolated DB acceptance covering success, invalid response, cancellation, duplicate request, retry and undo in `rpg_be_local/tests/knowledge.database.test.ts`.
- [ ] T038 [US3] Add compaction/old-fact lookup/provider-switch tests in `rpg_be_local/tests/longCampaign.test.ts`.
- [ ] T039 [US3] Preserve registry certainty and source/status distinctions during memory compaction in `rpg_be_local/src/domain/context.ts`; memory remains derived rather than a canonical facts store.
- [ ] T040 [US3] Update owned-tool contract assertions for actual registry definitions in `rpg_be_local/tests/gameplayTools.test.ts`.

T032–T036 are one wiring checkpoint: do not enable v4 for a provider before its
parser and tools are ready. Keep intermediate implementations behind explicit schema
selection until all are green; no simulated provider fallback. Enable the new default
only at T051 after archive export/import preserves knowledge and instruction/session metadata. An earlier phase
may exercise v4 through tests; it must not produce live saves that old exports lose.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; isolated knowledge DB tests pass with `RPG_TEST_DATABASE_URL` targeting a disposable DB.

### Phase 5 — US4: Archives, templates and existing frontend

**Independent test:** v4 round-trip keeps origins/status/undo with remapped IDs; old archives import without invented origins; existing chat shows fact changes.

- [ ] T041 [US4] Add character-deletion historical-link and export/undo regression tests in `rpg_be_local/tests/knowledge.database.test.ts` (pair T042).
- [ ] T042 [US4] Verify historical knowledge references survive existing physical deletion in `rpg_be_local/src/services/campaigns.ts`; change this service only if retention actually requires it, without blocking deletion or fabricating a live character.
- [ ] T043 [US3] Add absolute source-offset/supplied-span tests for multiple sections, nonzero offsets and Unicode surrogate pairs in `rpg_be_local/tests/knowledge.test.ts` (pair T044).
- [ ] T044 [US3] Validate source evidence against identified frozen absolute spans in `rpg_be_local/src/domain/knowledge.ts`; preserve exact original-book validators.
- [ ] T045 [US3] Carry `sourceSections` absolute start/end and source name in retrieval results in `rpg_be_local/src/store.ts`; keep source ID/version/text unchanged for existing consumers.
- [ ] T046 [US3] Preserve pinned/retrieved source-span metadata in frozen user context in `rpg_be_local/src/domain/context.ts` (after T045).
- [ ] T047 [US4] Add source deletion, retained quote and historical source-ID remapping coverage across records/snapshots/frozen session metadata in `rpg_be_local/tests/library.test.ts`.
- [ ] T048 [US4] Add legacy/new archive, attribution/remapping and template tests in `rpg_be_local/tests/library.test.ts` (pair T049).
- [ ] T049 [US4] Implement v4 archive/session validation/remapping, legacy defaults, historical character/source-link acceptance and template timeline exclusion in `rpg_be_local/src/services/library.ts`.
- [ ] T050 [US4] Verify the complete migrate/new save/export/self-import activation flow and immutable root metadata in `rpg_be_local/tests/knowledge.database.test.ts`; empty registries/envelope-only turns must round-trip too.
- [ ] T051 [US4] Enable v4 archive export and new-turn response defaults in `rpg_be_local/src/domain/versions.ts` (after T049, T050 and all adapter gates); activate instruction-envelope output and knowledge initialization in the same compatible release.
- [ ] T052 [US4] Publish the enums/labels owned by `domain/knowledge.ts` through the existing backend option catalog in `rpg_be_local/src/domain/options.ts`; no frontend-owned enum copies.
- [ ] T053 [US4] Reflect backend registry metadata in `rpg_fe_local/src/services/types.ts`; no dedicated view or local closed-value fallback.
- [ ] T054 [US4] Verify existing chat changes and ongoing draft/loading behavior with knowledge changes in `rpg_fe_local/tests/turn.test.tsx`.
- [ ] T055 [US4] Verify legacy retry/new v4 archive interaction in `rpg_be_local/tests/ruleArchiveCompatibility.test.ts`.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and frontend `npm run test:e2e --workspace rpg-fe-local` pass.

### Phase 6 — Native verification and documentation

- [ ] T056 Record successful Windows Codex and Antigravity multi-turn fact recall/dice/rules evidence, cancellation and saved-face recovery in `docs/reviews/campaign-knowledge-native.md`; use a disposable campaign, not the user's active game.
- [ ] T057 Evaluate Antigravity MCP-only schema discovery in `rpg_be_local/tests/antigravityMcp.native.test.ts`; removing the textual schema block is conditional on demonstrated success.
- [ ] T058 If T057 passes, remove textual schema duplication in `rpg_be_local/src/providers/antigravityMcpBook.ts`; otherwise document the smallest required guidance and native evidence.
- [ ] T059 Document v4 schemas, knowledge tools, no-editor scope and compatibility in `rpg_be_local/docs/api-contract.md`.
- [ ] T060 Update actual behavior, deferred Claude live gate and knowledge persistence guidance in `README.md`.
- [ ] T061 Record backend checks and remaining live gates in `rpg_be_local/IMPLEMENTATION.md`.
- [ ] T062 Record frontend checks and unchanged UI scope in `rpg_fe_local/IMPLEMENTATION.md`.

**Checkpoint:** root `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`; migrated isolated DB tests; Windows Codex/Antigravity native scenarios. Claude mocked transport coverage must pass; Claude live acceptance is explicitly deferred, not claimed verified.

## Review and handoff

Coverage: FR-001/US1 T007–T016; FR-002–FR-005/US2 T001–T006,
T017–T032/T037; FR-006/US3 T025–T040; FR-007–FR-008/US4
T048–T055. NFR-001 covered by one-response design and DB tests; NFR-002 by
T012/T016/T056. Four stories, 62 numbered tasks.

No open user clarifications. Both independent review rounds are complete; parent
validated and applied the final medium-severity boundary corrections.
Planning does not implement application changes.
Preserve the activation checkpoint and audit native adapters for hard-coded v2/v3
constants when enabling v4.
The user-approved product behavior is settled; source/schema discovery and native
model behavior remain verification gates, not assumptions of success.

Self-check: dependency order preserves additive contracts until adapters and archive
export are ready. Legacy retries keep their frozen contract; old snapshots do not
erase newer knowledge. Creation aliases resolve only to staged character operations.
No full-response origin flag, dedicated knowledge UI, private-note leakage or book
mutation is introduced. Remaining external gate: Claude live testing is deferred.

## Independent review — round 1

Reviewer: internal subagent `plan_review_two_rounds`; read-only code inspection.
Parent validated all six findings before correcting this plan. No application,
DB migration or live provider test was performed.

| ID | Severity | Verified problem | Evidence | Resolution |
|---|---|---|---|---|
| R1-01 | High | Adding empty knowledge changes legacy retry hashes | `domain/diceContext.ts`, `services/turns.ts`, `store.ts` | Versioned digests, both consumers, old-hash regression test |
| R1-02 | High | No-library generator accepts dice callback, not an owned registry | `providers/service.ts`, `services/turns.ts` | Explicit Generator seam and no-library dispatch coverage; book mode separate |
| R1-03 | High | Frozen root metadata had no complete storage/immutability path | `services/dice.ts`, `domain/dice.ts`, `migrationssql/0004_dice_rolls.sql` | Authoritative dice-session metadata, new immutable trigger and explicit consumer tasks |
| R1-04 | High | Early new fields make v3 self-exports fail on re-import | Strict campaign/context validators in `services/library.ts` | All new persisted fields dormant until coordinated migrate/archive activation |
| R1-05 | High | Character deletion conflicts with live-only knowledge references | `services/campaigns.ts` | Server-captured historical identity, deletion-compatible recall/archive tests |
| R1-06 | Medium | Exact old native agent prompts were not persisted | `providers/claudeDice.ts`, `services/dice.ts` | Honest known-legacy reconstruction; exact freezing guaranteed only for new sessions |

False positives rejected: planned new files are intentional; the old plan already
assigned v4 response conversion to the state/turn tasks; migration ordinal 0008 is
free; historical replaced-source evidence was already addressed. Existing archived
prompt-size limits are not automatically a new-feature defect; exercise round-trip
with realistic full instruction/user inputs and fix any feature-dependent loss.
Do not assert duplicate Codex native instructions merely from two configuration
locations; inspect effective native payload precedence before changing it.

## Independent review — round 2

The same reviewer waited for the parent's round-1 corrections, then reread the
saved plan and relevant code. All six first-round corrections were confirmed;
no remaining high-severity planning blocker was identified. The parent subsequently
validated and incorporated these two medium boundary findings without claiming a
third independent round:

| ID | Severity | Evidence | Resolution |
|---|---|---|---|
| R2-01 | Medium | `store.ts` retrieval and `domain/context.ts` lose excerpt offsets; `sourceSections.ts` already computes them | Source-absolute UTF-16 coordinates, supplied span identity, explicit retrieval/context tasks and Unicode/multiple-excerpt tests |
| R2-02 | Medium | `services/sourceLibrary.ts` physically deletes source and upload | Historical quote/name/version retention, unavailable-source lookup semantics and historical source UUID remapping tests |

Rejected residual candidates: v4 conversion already has a named owner; selecting
v4 independently of book mode is now explicit; imported historical prompt text is
audit-only and remains non-executable; dormant staging is allowed before activation.
The existing archive prompt-size bound is not automatically a new feature defect;
round-trip behavior with the new real payload remains an implementation acceptance
check. Code review of this plan does not establish actual CLI/cache behavior or
prove every semantic claim is true.

Review completed: six round-1 corrections and two round-2 corrections recorded.
No application or database changes were made. All tasks remain unchecked. Claude
live verification and the optional Antigravity MCP-schema optimization remain the
explicit environment/runtime gates already described above.
