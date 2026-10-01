# Plan: Trusted dice through CLI tool calling

**Status**: Independent foundation implemented (T001–T011); provider compatibility gates still prevent gameplay enablement. See `../reviews/dice-provider-capabilities.md`.
**Date**: 2026-10-01. **Mode**: default, with user clarification.
**Request**: Plan dice tool calling from the backend brainstorm, excluding “Transforming Latency into Engaging UX”.

## Summary

Every random game result must come from an application-owned dice tool, never from the GM model. The tool returns individual random faces only. The AI decides when dice are needed, applies modifiers and interprets the game rules. Rolls appear in chat with the finished answer. Failed-turn retries preserve already recorded dice.

Use fresh application-owned campaign context per game turn, allowing bounded provider-specific dice phases. Claude continues within one isolated invocation; Codex starts fresh phases with an authoritative bounded transcript. Continue owning campaign context in the app and allow switching providers between turns. Do not implement a combat engine, manual dice button, live dice animations or incremental narration.

## Context and evidence

- Stack: Node 22.13+, TypeScript ESM, Express 5, PostgreSQL, Zod 4; React/TypeScript/Vite frontend; root npm workspaces.
- Existing boundaries: `rpg_be_local/src/services/turns.ts` owns generation, leases, cancellation and atomic state commit; `src/store.ts` owns persistence; `src/domain/context.ts` assembles bounded context; `src/providers/service.ts` launches isolated CLIs.
- Existing providers deliberately disable tools. Codex also rejects tool items in output; Antigravity requires a single internal turn. Those contracts cannot be retained unchanged for gameplay with dice. Memory compaction and character extraction must retain their no-tools contracts.
- `rpg_fe_local/src/features/play/useTurn.ts` already handles uncertain HTTP retries with a stable request ID. This does **not** restart a terminal failed generation. Recovery needs a distinct explicit operation.
- Applied migrations include `0003_character_templates.sql`; add `rpg_be_local/migrationssql/0004_dice_rolls.sql`, never edit existing migrations.
- Existing archives have a strict version-1 schema in `src/services/library.ts`; changing roll persistence requires an explicit format transition.
- Backend tests: `tsx --test tests/*.test.ts`; frontend: existing Vitest/Testing Library and Playwright suites. Native CLI protocol canaries and real subscription calls are distinct checks.

Official documentation supports MCP configuration in [Codex](https://developers.openai.com/codex/mcp), tool restrictions and strict MCP configuration in [Claude Code](https://code.claude.com/docs/en/cli-reference), and local/remote MCP servers in [Antigravity](https://antigravity.google/docs/mcp?tab=cli). These documents establish integration mechanisms, **not proof** that the currently pinned isolated launchers can safely expose only dice. Verify installed versions before enabling this path; do not alter the user's global MCP configuration.

The earlier [brainstorm](../../rpg_be_local/docs/dice-rolling-architecture.md) is reference material. This plan supersedes its cache discounts, fixed latency estimates, visible future dice pools and live UX proposals.

## Must not change

- Fresh bounded campaign context each game turn; no dependence on a provider's persisted chat session, private notes or ambient customizations.
- Subscription CLI authentication, no application API keys or direct paid API fallback.
- Provider/model/effort switching between turns; a running attempt captures its settings.
- Short locked database transactions, lease/revision ownership checks, atomic character/state changes and full state undo.
- Existing sources, templates, character sheets, audio, LAN boundary, same-origin API and polling workflow.
- Existing version-1 campaign archives remain importable; old turns remain readable without fabricated dice records.
- Sequential application I/O. A batch of requested dice groups is evaluated sequentially, not through parallel promises.
- Planning changes documentation only. Android validation remains on hold; Windows is the acceptance platform. No macOS/Linux acceptance requirement.

## User stories

### US1 — The GM uses real dice (P1, MVP)

The player sends an action. The GM declares a check, asks the dice tool for faces, receives the recorded result, interprets the rules and returns one finished answer. The player never needs to click a roll button.

**Acceptance**:

1. A requested group of three d10s produces three integers in 1..10, using `node:crypto.randomInt`, with no model-generated or browser-supplied faces.
2. A turn with several dependent checks preserves prior trusted faces in bounded application context; a later damage roll may depend on the earlier attack interpretation. Provider phases must not rely on opaque campaign history.
3. The tool returns faces and audit identity, not bonuses, totals, successes, damage, criticals, Hunger rules or initiative decisions.
4. Known modifiers/difficulty are declared before dice are revealed. Later corrections have a visible explanation; original faces and declaration remain immutable.
5. Only the owned `roll_dice` tool is exposed. Unexpected tools, unavailable isolation or exhausted budgets fail explicitly without applying partial game state.
6. Compaction/extraction calls cannot access dice. A narrative turn that needs no randomness may complete without a roll.

### US2 — Recovery preserves rolls (P1)

When a generation fails after rolling, the player can explicitly retry that attempt using the original context and dice. Network uncertainty, terminal failure, legitimate game rerolls and undo have different behavior.

**Acceptance**:

1. An uncertain HTTP retry returns the existing turn without starting another CLI or drawing another die.
2. An explicit failed/cancelled-turn retry creates an audited attempt linked to the original roll session. Replayed slots return the identical stored faces.
3. A changed dice specification for an existing slot is a conflict, never an automatic new roll. Original declarations remain visible even if the AI proposes a correction.
4. Retry is refused after a change to canonical gameplay context or after another action supersedes the failed turn. Provider-only switching can be allowed if the frozen prompt fits the new provider.
5. Cancellation, timeout, process crash, database failure and late output cannot mutate canonical campaign state. A successfully persisted roll remains in the audit even if narration fails.
6. Undo restores state and removes that turn from active history; it retains the roll audit marked undone. A subsequent deliberately new action is a new roll session, not a retry.

### US3 — See and retain the evidence (P1)

The finished chat answer shows the actual faces, original declaration and the GM's separate interpretation. Failed or cancelled attempts show any recorded rolls once terminal. Exports retain the roll audit.

**Acceptance**:

1. All player, enemy and secret-check dice are visible; no concealment mode, roll button, live ticker, SSE dice events or dice animation.
2. Chat draws faces from persisted backend records, never from AI-authored text. Corrections are visibly distinct from original declarations.
3. The existing audit can display failed/cancelled/undone attempts, including dice even when no narrative exists.
4. Export/import preserves roll-session links, attempt references, faces, interpretations and undo status, remapping declared entity references without rewriting arbitrary text.
5. Importing an older archive adds empty dice history, not invented rolls. Imported unfinished attempts are historical and cannot launch a preserved retry.

## Requirements and coverage

| ID      | Requirement                                                                               | Tasks                           |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| FR-001  | All requested game randomness uses cryptographic backend dice; generic faces only.        | T003–T006                       |
| FR-002  | Automatic bounded calls using fresh per-turn application context and verified provider phases.                         | T010–T017, T024–T025            |
| FR-003  | Pre-result declarations, immutable faces, explicit later interpretation/corrections.      | T005–T009, T020–T025, T038–T039 |
| FR-004  | Only owned dice tool, no ambient MCP/tools/customizations.                                | T001, T010–T017                 |
| FR-005  | Persist before revealing; exact replay and ordered recovery across failures.              | T007–T009, T026–T029            |
| FR-006  | Preserve uncertain request-ID behavior; explicit terminal retry contract.                 | T028–T035                       |
| FR-007  | Cancellation, ownership/revision checks, atomic state commit and undo.                    | T024–T029                       |
| FR-008  | All recorded dice visible in terminal chat/audit, no live roll UI.                        | T036–T039                       |
| FR-009  | Archive upgrade with backward import and valid remapped references.                       | T030–T031                       |
| FR-010  | Provider switching with saved context and explicit dice capability diagnostics.           | T018–T019, T028–T029, T036–T037 |
| FR-011  | No dice in compaction/extraction; no future roll pool or hidden fallback.                 | T016–T017, T022–T025            |
| NFR-001 | Enforce numeric dice, byte, call, deadline and context limits below.                      | T003–T006, T010–T017, T024–T025 |
| NFR-002 | No tokens, private notes, MCP capability secrets or raw CLI logs in public artifacts.     | T010–T011, T040–T043            |
| NFR-003 | Mocked boundary, isolated DB and Windows live-provider evidence all required for release. | T001, T007–T039, T042–T044      |

## Decisions

| Decision                                                      | Why                                                                                        | Alternatives rejected                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Generic numeric dice groups, individual faces only            | Tool handles randomness, AI handles all game interpretation                                | Combat engine; Vampire-specific critical/Hunger calculation                  |
| Automatic GM calls for every random check                     | User does not want a manual roll interaction                                               | Dice tray button; approval of each roll                                      |
| Declare known modifiers and target before reveal              | Discourages retroactive outcome shaping                                                    | Silent modifier changes after a poor roll                                    |
| Tool results authoritative; AI interpretation separate        | Preserves original dice and explains rule corrections                                      | AI returning supposedly authoritative faces                                  |
| Provider-specific bounded phases, fresh campaign context each turn | Keeps only application-owned bounded history; Codex interrupts before hidden continuation                               | Long-lived campaign session or unverifiable opaque continuation                           |
| Owned private MCP listener bound to loopback                  | Backend can persist each call before replying, without giving a child database credentials | CLI tool with DB credentials; general-purpose user MCP; public dice endpoint |
| No visible future random pool                                 | GM cannot inspect upcoming faces before choosing a check                                   | Brainstorm entropy ledger                                                    |
| Exact ordered replay on retry                                 | Keeps already revealed randomness fixed despite provider failure                           | Regenerate on retry; merge arbitrary model-selected old results              |
| Store dice audit separately from canonical state              | Undo must not erase evidence of previous randomness                                        | Delete rolls when undoing or failing a turn                                  |
| No guaranteed cache savings or latency promise                | Subscription usage and provider caching differ                                             | Treat API cache discounts as subscription savings                            |

## Data and interfaces

### Dice contract and limits

Canonical constants and validators belong in `rpg_be_local/src/domain/dice.ts`; the frontend consumes the served contract rather than duplicating bounds or enums.

The only gameplay tool is `roll_dice`; Claude attaches it through private MCP and Codex through native dynamic tools. The session capability is bearer authorization for an application-owned endpoint, not a provider API key. Its strict input contains:

- `slot`: integer 0..11, sequential within an attempt. This is a stable logical roll position, not a provider-generated tool-call ID.
- `groups`: 1..8 ordered objects `{label, count, sides}`. Label: 1..80 characters, unique within the call; count: 1..50; sides: integer 2..1,000,000. At most 100 faces per call, 200 newly drawn faces per logical turn.
- `reason`: 1..240 characters. Optional actor/target character references must refer to the frozen supplied context.
- `declaration`: 1..600 characters stating known modifiers, target and selection rule, or explicitly stating that they are unknown/not applicable. This is opaque audit text, not executable rules.
- Optional `rerollOf`: existing roll ID plus an explicit reason. The server checks identity and bounds, not whether a game rule authorizes it.

Max input: 4,096 UTF-8 bytes. Up to 12 unique logical roll slots per turn and 24 tool requests per attempt, including duplicate/replayed calls. Invalid calls count against the request cap. A compound request cannot contain code, formulas or dice notation expressions: `1d20+5` becomes one d20 group and an opaque declaration of the +5 bonus. Keep-high/low, exploding dice and dice-pool successes are interpreted by the GM; additional randomness requires another tool call.

Output: `{rollId, slot, groups:[{label,sides,faces}], reused}`. No total, modifier arithmetic, success calculation or resolution. `randomInt(1, sides + 1)` supplies each face sequentially. Production cannot select an injected RNG; tests can inject a deterministic RNG through an internal boundary.

These bounds are implementation defaults, not user-approved game-rule limits. A limit error is visible and applies no partial canonical game state. If live measurements require changes, revise named constants and evidence before release.

### Persistence

New migration `0004_dice_rolls.sql` adds logical roll sessions and append-only roll records with campaign/session/slot uniqueness. A session holds root turn ID, frozen prompt/context digest, allowed attempt ownership and aggregate counters. Records contain UUID, ordered groups/faces, original declaration, reason, explicit entity references, optional reroll link and UTC timestamp. Constraints reject invalid ranges and broken cross-campaign links. Campaign deletion explicitly cascades this audit; undo does not delete it.

Attempts remain existing `Turn` documents with additive, backward-compatible `diceSessionId`, `retryOfTurnId`, `rolls` and `rollInterpretations` fields. The backend hydrates roll views from canonical records; persisted session data is authoritative. Old turns normalize to no dice history.

Each Claude gameplay invocation creates a private MCP listener on `127.0.0.1` with an ephemeral port and a random per-attempt 256-bit capability. It is separate from public Express `/api` and never follows LAN bind settings. Require authorization and reject browser origins/unexpected hosts, methods, request sizes and tools. No resources, prompts, sampling, elicitation, arbitrary URLs, files or shell tools. Generate launch configuration only in the owned temporary directory, with user-only access; never expose its capability to the frontend, prompts, logs or archives. Close the listener and remove temporary configuration on completion, cancellation or failure. Do not alter shared/global CLI settings.

The owned roll callback validates attempt identity, active lease and campaign context under locks, persists a new roll in a short transaction, commits, and only then returns faces. Lost responses replay committed results. Serialize MCP execution even if a CLI issues concurrent calls. RPC message identity protects transport duplicates; logical slot identity protects retries across different CLI processes. A stale/cancelled attempt cannot append a roll.

Codex gameplay uses native app-server dynamic tools because its MCP exec path adds discovery/resource helpers. Each tool phase is interrupted without replying to the native function request after the backend persists faces. A fresh ephemeral process/thread receives the frozen application prompt and bounded canonical request/result transcript. There is at most one call per phase and at most 25 phases including final output. The 32,000-byte assembled phase prompt, 8,192-byte transcript, aggregate 2,000,000-byte stdout/stderr and overall 180-second deadline are checked. Selected models must advertise at least 128,000 native context tokens. No intermediate model history enters the next phase. No nonexistent output-token configuration is used. Fresh empty CODEX_HOME, sanitized catalog/instructions and linked native subscription auth are required; compaction/extraction remain no-tools exec.

### Retry semantics

Keep current POST turn submission semantics unchanged. Add `POST /campaigns/:id/turns/:turnId/retry` with `{revision,requestId,settings?}` and the existing 202 Turn envelope. Require a terminal failed/cancelled local attempt, idle campaign, no later superseding action and unchanged canonical gameplay-context digest. Private-note changes are irrelevant; provider-only settings changes may be allowed. The retry reuses the original prompt, rule/source versions, prior memory and action; it does not compact or rebuild different context. Verify the frozen prompt plus continuation reserve fits the selected provider.

Create a new attempt linked to the same logical roll session. Keep the original failed attempt intact. The retry starts at slot 0. Every existing slot must be replayed in order with the same dice specification; a missing, skipped or changed specification stops recovery with a visible conflict. Once the persisted prefix has been replayed, new slots may be appended. Reasons/declarations cannot silently overwrite old records; proposed corrections are returned separately in final interpretation. Duplicates within an attempt return the stored result without another draw. Do not key preservation solely by prose or provider-generated call IDs.

The retry prompt tells the GM that prior rolls exist and must be requested again in order; it does not expose future dice. Once requested, those faces are not newly random and the output marks them reused. On restart after a server crash, expired attempts become terminal through existing lease recovery; retry is explicit, never automatic. Imported sessions cannot be resumed. A retry conflict offers explanation, not automatic reroll or conversion to a new action.

### Final answer and context

Keep the original response schema for compaction/extraction and legacy stored turns. Introduce a separately versioned dice-gameplay response schema in `src/domain/diceResponse.ts`: existing narrative/operations plus `rollInterpretations`, each referencing an actual recorded roll ID with explanation and optional explicitly explained corrections. Canonical faces never come from this schema. Unknown, duplicate or missing roll references reject final state application; even a discarded/unneeded roll must be acknowledged with a reason. Existing expected-old-value mutation validation still applies.

The app can validate identities, recorded faces and structured corrections. It cannot mechanically prove that free-form narration contains no invented off-screen roll or that an AI chose the correct difficulty. Prompt rules forbid both; live tests exercise adherence. This is trusted randomness with auditable AI adjudication, not a verified rules engine.

Reserve space **before launch** for tool definitions, request/result transcript, bounded intermediate model output and final response. Cumulative session length and cumulative subscription usage are different measures: check both where reported. Existing aggregate input-usage fields may sum multiple inference steps and must not be compared blindly to a one-prompt cap. Enforce a 180-second attempt deadline including tool continuations, 8,192-byte application-owned tool transcript cap and 2,000,000-byte process-output cap; tighten per-provider reserves to its verified context allowance. Abort before another call if the budget cannot accommodate it. No mid-attempt compaction, silent history trimming or unbounded tool loop. If a CLI cannot expose/enforce the needed continuation bounds, its dice capability remains unsupported.

Completed active turns contribute a compact roll summary to bounded history; full records remain in the audit. Failed/cancelled/undone rolls do not enter gameplay memory. Memory compaction preserves consequential roll outcomes through the existing bounded summary path, not the full dice ledger.

### Archives and chat

Export archive version 2 with roll sessions and immutable records. Import both strict v1 and v2; normalize v1 without dice. Validate limits, ranges, references, order, ownership and consistency before writing. Remap declared campaign/turn/session/roll/character references, including reroll and interpretation links; preserve arbitrary narrative/declaration text. Export excludes capabilities, temporary paths and runtime credentials. Templates carry setup only, never a completed roll session.

Serve explicit dice support and reason per provider/model alongside current diagnostics. Installed or narration-supported does not imply dice-supported. ProviderPicker preserves usable narration status for non-gameplay features but blocks a dice gameplay action when isolation is unverified. Do not disable extraction because dice is unsupported. Release acceptance requires Windows checks for Codex, Claude and Antigravity; no silent downgrade to model-invented dice.

Render a `DiceRolls` section under each terminal chat attempt with original faces, declaration, separate interpretation/corrections and reused/undone labels. Existing polling is sufficient. No live dice events, animation, streaming narration or new roll-button workflow. Escape all text and preserve drafts/focus across refresh.

## Complexity

| Addition/deviation                               | Why needed                                                                           | Simpler alternative rejected because                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Codex fresh-phase dynamic-tool transport | Native MCP adds helpers and no verified output-token override exists; interrupting before a tool reply bounds application-owned context | Opaque native continuation or ambient MCP helpers would violate isolation/budget gates |
| Official MCP SDK dependency in backend workspace | Standard transport/protocol validation and lifecycle                                 | Handwritten MCP protocol adds compatibility and parsing risks                                                                    |
| Private per-attempt MCP listener                 | Calls reach backend audit without exposing DB credentials to a CLI child             | Public dice HTTP route increases accidental exposure; independent stdio dice child cannot safely persist without an extra bridge |
| Provider-specific dice launch contracts          | Current no-tools adapters intentionally reject this behavior                         | Simply enabling global MCP would import unrelated tools/customizations                                                           |
| Logical roll session + explicit retry route      | Idempotent results must survive terminal failures and changed CLI call IDs           | Existing uncertain-request retry does not restart generation                                                                     |
| Separate dice response and archive versions      | Existing strict schemas reject new fields; interpretations need validated references | Reusing version 1 ambiguously breaks existing imports/consumers                                                                  |

## Clarifications

- Q: Enforce combat rules or provide trusted dice? → A: All randomness through tool calls; AI applies/interprets rules.
- Q: Which system-specific mechanics? → A: Generic rolling only; the tool does nothing else.
- Q: Manual player rolling or automatic calls? → A: Automatically call the tool whenever anyone needs a roll; no player roll button needed.
- Q: Declare known modifiers/targets first and show corrections? → A: User accepted that recommendation after the outcome-shaping example.
- Q: Visible or secret checks? → A: All rolls visible in chat.
- Q: Roll again after failure? → A: Preserve results.
- Q: Live latency UX? → A: Excluded; waiting for the complete answer is fine.

## Assumptions and technical gates

- Generic integer-sided dice are sufficient; labels allow normal/Hunger or advantage dice to be distinguished without tool-side mechanics. No notation library is needed.
- Undo retains audit, while a deliberately new action draws fresh randomness. Only explicit failed/cancelled recovery preserves a logical session.
- A failed retry after edited gameplay context is refused; it never silently borrows a newer context. Explain this in the UI/docs.
- **Unverified technical gate:** installed CLI versions must accept a verified private MCP or native dynamic-tool transport, expose only the owned tool, complete multiple tool steps with structured final output, and enforce bounded continuation. Official support alone is insufficient.
- Antigravity currently excludes inherited MCP and discovers its owned agent globally. If it cannot attach only the per-attempt MCP server without modifying shared config or inheriting other tools, report that capability as unsupported; stop and revise that adapter's approach before feature release.
- No product questions remain. Transport isolation, usage reporting and Windows model entitlement are verification work, not user decisions. Do not present this plan as a completed compatibility test.

## Risks and mitigations

| Risk                                                            | Mitigation                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| AI invents outcomes, unnecessary rerolls or retroactive bonuses | Persist faces/declaration first; validate structured references; show corrections. Rule interpretation remains an explicit limitation. |
| Retry model changes the planned sequence                        | Exact ordered replay rejects changed dice instead of fishing for new results. Explain conflict; never automatically reroll.            |
| Cancel occurs after commit but before tool response             | Retain committed roll; ownership check prevents later writes; retry replays it.                                                        |
| MCP concurrent calls or duplicated transport IDs                | Serialize handler work, reject out-of-order slots, enforce identity/spec digest and DB uniqueness.                                     |
| Multi-step usage exceeds existing one-shot limits               | Distinguish peak context from cumulative usage, reserve continuation space, caps/deadline and native canaries.                         |
| CLI cannot safely narrow tools or credentials leak into logs    | Fail closed; private capability/configuration lifecycle; malicious-context tests and public audit.                                     |
| Export drops roll links or import permits replay                | Explicit format-2 validation/remap and imported-session historical-only rule.                                                          |

## How to verify

1. Configure only an isolated PostgreSQL test DB using `RPG_TEST_DATABASE_URL`; run `npm test` from the monorepo root. Production campaigns must not be used as fixtures.
2. Run `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`; all must pass with no warnings.
3. Run native protocol canaries against loopback synthetic model/MCP boundaries where supported. Assert advertised tools, multiple dice calls, final schema and rejected unauthorized tools; no subscription call in default tests.
4. Windows live verification: create a disposable synthetic campaign, play a dice-requiring turn with each provider, verify recorded faces reach the GM and appear unchanged in chat, then switch providers and continue. Capture actual selected models/versions, usage and timings without secrets.
5. Force an interrupted attempt after a persisted roll; explicitly retry, verify faces/IDs unchanged and one state commit. Repeat cancellation, late completion, changed context, changed roll specification and restart recovery tests.
6. Undo, export v2, import, inspect chat/audit and import a v1 fixture. Faces and relationships must survive; imported recovery must be disabled.
7. Run `npm run test:e2e --workspace rpg-fe-local` and `npm run audit:public`. Report environment-gated skips separately. Android/macOS/Linux checks are not part of this feature acceptance.

## Tasks

Tasks are sequential. Each test/implementation pair is one green checkpoint; work can stop after a pair. Internal modules remain disconnected from production gameplay until the integration task and provider verification pass.

### Phase 1 — Foundation and capability investigation

- [x] T001 Record installed-version private-MCP/tool-isolation and continuation-budget evidence for all three CLIs in `docs/reviews/dice-provider-capabilities.md`; use owned temporary canaries outside Git and list any blocked gate explicitly. Do not change global configurations.
- [x] T002 [US1] Declare separate dice-gameplay response and archive-format version constants in `rpg_be_local/src/domain/versions.ts`; retain explicit legacy version identifiers for compatibility.

**Checkpoint:** technical feasibility is evidenced or the blocking adapter is explicitly identified; no gameplay behavior has changed. Existing `npm run typecheck`, `npm run lint`, `npm test` remain green with the isolated DB.

### Phase 2 — US1: Trusted dice inside isolated gameplay

**Goal:** Build bounded, auditable random faces and expose only that tool to verified gameplay adapters.
**Independent test:** synthetic GM makes two dependent calls; recorded faces return unchanged; attempted file/shell/MCP access is rejected.

- [x] T003 [US1] Write failing cryptographic-boundary and invalid-input tests in `rpg_be_local/tests/dice.test.ts` (pair with T004).
- [x] T004 [US1] Add generic sequential face generation and strict limits in `rpg_be_local/src/domain/dice.ts`: slot 0..11; groups 1..8; label 1..80; count 1..50; sides 2..1,000,000; reason 1..240; declaration 1..600; 100 faces/call, 200 new faces/session, 24 requests/attempt, 4,096-byte input and 8,192-byte transcript caps.
- [x] T005 [US1] Write failing immutable-declaration/dice-response reference-schema tests in `rpg_be_local/tests/diceResponse.test.ts` (pair with T006).
- [x] T006 [US1] Define a separately versioned strict dice-gameplay response/interpretation contract in `rpg_be_local/src/domain/diceResponse.ts`, preserving existing operation constraints and excluding AI-authored faces.
- [x] T007 [US1] Add append-only sessions/records and relational uniqueness constraints in `rpg_be_local/migrationssql/0004_dice_rolls.sql`; verify fresh and already-migrated isolated DBs without editing prior SQL.
- [x] T008 [US1] Write failing persistence-before-reveal, uniqueness and stale-owner tests in `rpg_be_local/tests/dice.database.test.ts` (pair with T009).
- [x] T009 [US1] Implement locked, sequential, append-only roll persistence/replay in `rpg_be_local/src/services/dice.ts`; check active ownership, context identity, exact spec, counters and commit before returning faces.
- [x] T010 [US1] Write failing private MCP authorization, only-tool discovery, concurrency serialization, size/deadline and cleanup tests in `rpg_be_local/tests/diceMcp.test.ts` (pair with T011).
- [x] T011 [US1] Implement the turn-scoped loopback MCP lifecycle in `rpg_be_local/src/providers/diceMcp.ts` using the official SDK: 256-bit capability, no resources/prompts/sampling/elicitation, only `roll_dice`, max input 4,096 bytes, no browser-origin access, no DB credentials in launch configs. Install its dependency through root workspaces and commit the generated lockfile as package bookkeeping.
- [x] T012 [US1] Write failing native/fixture Codex dice-only tool and final-output contract tests in `rpg_be_local/tests/codexDice.runtime.test.ts` and `diceProtocol.test.ts` (pair with T013).
- [x] T013 [US1] Add an explicit dice-only Codex launch/output path in `rpg_be_local/src/providers/codexDice.ts`, retaining existing no-tools launch, strict payload transport, clean environment and per-version isolation gates.
- [x] T014 [US1] Write failing Claude dice-only MCP/final-output contract tests in `rpg_be_local/tests/diceProtocol.test.ts` (pair with T015).
- [x] T015 [US1] Implement the verified Claude dice-only launch/parser contract in `rpg_be_local/src/providers/claudeDice.ts`; restrict availability as well as approvals, retain strict MCP configuration and no ambient customization.
- [ ] T016 [US1] Write failing Antigravity owned-MCP and multi-step final-output tests in `rpg_be_local/tests/antigravityDice.test.ts` (pair with T017).
- [ ] T017 [US1] Implement the verified Antigravity dice-only launch/parser in `rpg_be_local/src/providers/antigravityDice.ts`, preserving the owned-agent isolation boundary; fail closed if T001 cannot establish it.
- [x] T018 [US1] Write failing gameplay-versus-no-tools dispatch and provider/model dice-capability tests in `rpg_be_local/tests/providers.test.ts` (pair with T019).
- [x] T019 [US1] Extend generation purpose/options and explicit dice diagnostics in `rpg_be_local/src/providers/service.ts`; only gameplay receives the owned dice capability, and compaction/extraction remain tool-free. Capacity includes provider-specific continuation reserves and rejects unverifiable budgets.
- [x] T020 [US1] Add backward-compatible dice/retry audit fields and explicit legacy/new archive types to `rpg_be_local/src/domain/types.ts`; keep old turns readable and canonical faces owned by persisted records. Derive version members from the named constants introduced in T002.
- [x] T021 [US1] Add terminal turn roll hydration to `rpg_be_local/src/store.ts` using sequential queries and the append-only session records; no model-supplied faces become canonical.
- [x] T022 [US1] Write failing bounded dice-gameplay context and failed/undone-history exclusion tests in `rpg_be_local/tests/context.test.ts` (pair with T023).
- [x] T023 [US1] Add an explicit dice-gameplay context mode in `rpg_be_local/src/domain/context.ts`; include predeclaration instructions, schema and compact completed-roll history while preserving no-tools compaction and all existing budget failures.
- [x] T024 [US1] Write failing multi-call atomic-commit, missing/forged roll reference, cancellation, timeout and no-tools-compaction tests in `rpg_be_local/tests/dice.database.test.ts` (pair with T025).
- [x] T025 [US1] Connect gameplay to the owned dice session in `rpg_be_local/src/services/turns.ts`; enforce 180-second attempt deadline, 12 slots, 24 requests, 200 new faces, 8,192-byte tool transcript and verified provider reserves; validate all roll interpretations before one atomic state commit, and close MCP on every terminal path.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. Native capability evidence must pass before enabling a provider; live Windows checks remain a release gate.

### Phase 3 — US2: Preserve dice during explicit recovery

**Goal:** Distinguish uncertain submissions from terminal retries and preserve the logical random history.
**Independent test:** fail after slot 0, retry twice, observe identical slot-0 ID/faces and exactly one successful canonical commit; changed specification or gameplay context conflicts.

- [x] T026 [US2] Write failing exact-prefix recovery, crash/cancel recovery and audit-preserving undo tests in `rpg_be_local/tests/dice.database.test.ts` (pair with T027).
- [x] T027 [US2] Implement linked retry-attempt recovery and audit-preserving undo in `rpg_be_local/src/services/turns.ts`; freeze original action/context, require unchanged gameplay digest/idle unsuperseded state, replay persisted slots before append and reject imported sessions.
- [x] T028 [US2] Write failing retry endpoint identity, terminal-state and provider-switch capacity tests in `rpg_be_local/tests/dice.database.test.ts` with Supertest (pair with T029).
- [x] T029 [US2] Add the thin explicit retry transport and served dice capabilities/limits in `rpg_be_local/src/app.ts`, validating `{revision,requestId,settings?}` and retaining existing submit idempotency/problem responses.
- [x] T030 [US2] Write failing archive-v2 roll-reference remap, malformed faces, v1 compatibility and imported-recovery rejection tests in `rpg_be_local/tests/dice.database.test.ts` plus existing v1 library regressions (pair with T031).
- [x] T031 [US2] Implement strict version-2 dice archive export/import with version-1 normalization in `rpg_be_local/src/services/library.ts`; preserve immutable audit, remap explicit references, exclude capabilities and reject imported retry execution. Use the distinct archive version constants from T002 and archive types from T020.
- [x] T032 [US2] Extend the frontend's API field types for server-owned dice capabilities and retry/roll audit in `rpg_fe_local/src/services/types.ts`; do not duplicate backend option enums or limits.
- [x] T033 [US2] Write failing terminal-versus-uncertain retry, single-flight and stale-navigation tests in `rpg_fe_local/tests/turn.test.tsx` (pair with T034).
- [x] T034 [US2] Add explicit terminal retry handling to `rpg_fe_local/src/features/play/useTurn.ts`; preserve uncertain-request identity, freeze recovery inputs and ignore obsolete responses without erasing drafts.
- [x] T035 [US2] Add “Retry with original rolls” and visible recovery conflicts to `rpg_fe_local/src/pages/Play.tsx`, keeping a deliberately new action separate from recovery and avoiding automatic retries.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; isolated DB evidence proves preservation across terminal failure and restart.

### Phase 4 — US3: Chat evidence and provider usability

**Goal:** Show the original dice alongside the complete answer and explain capability failures.
**Independent test:** a terminal turn with two rolls shows exact stored faces/declarations and a correction; a failed attempt without narrative still displays dice; an unsupported provider cannot silently generate substitutes.

- [x] T036 [US3] Write failing provider/model dice-capability usability tests in `rpg_fe_local/tests/provider-refresh.test.tsx` (pair with T037).
- [x] T037 [US3] Show backend-owned dice capability reasons in `rpg_fe_local/src/features/providers/ProviderPicker.tsx`, preserving narration availability for non-gameplay features and selection state across refresh. Only game-setup/play pickers use dice gating; the backend retains independent no-tools extraction/compaction capabilities.
- [x] T038 [US3] Write failing stored-face/correction/reused/undone text and safe-rendering tests in `rpg_fe_local/tests/dice.test.tsx` (pair with T039).
- [x] T039 [US3] Implement terminal-only `rpg_fe_local/src/features/play/DiceRolls.tsx` with all faces, original declarations, separate interpretations/corrections and audit labels; use existing journal styles and accessible text.
- [x] T040 [US3] Mount terminal dice evidence in `rpg_fe_local/src/pages/Play.tsx`; gate gameplay on verified dice capability while preserving existing polling, draft state and audit filtering. Add no live events, animation or roll button.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; chat shows backend evidence for completed and terminal failed attempts.

### Phase 5 — Documentation and release verification

- [x] T041 Update the public dice/retry/diagnostics/archive contract in `rpg_be_local/docs/api-contract.md` with all identities, numeric/byte limits, failures and compatibility semantics.
- [x] T042 Add Windows browser acceptance for all-visible terminal dice, provider switching, preserved retry and undo/export/import in `rpg_fe_local/tests/e2e/dice.spec.ts`; real subscription calls remain explicit opt-in checks.
- [ ] T043 Record actual Windows native and live Codex/Claude/Antigravity results, versions/models, tool isolation, preserved retry, bounded usage and measured latency in `docs/reviews/dice-provider-capabilities.md`; run public audit and report unverified/blocked models explicitly, without raw private logs.
- [x] T044 Document user-facing dice-only behavior, visible corrections, limits, retry conflicts and archive compatibility in `README.md`.
- [x] T045 Reconcile requirements/tasks and actual verification evidence in `docs/plans/trusted-dice.md`; mark only evidenced work complete. Do not call a blocked provider release complete.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e --workspace rpg-fe-local`, `npm run audit:public` pass with the isolated test DB; all three Windows provider gates have actual evidence. No Android/macOS/Linux acceptance work.

## Review

Self-check corrected the following before handoff:

| ID  | Severity | Finding                                                                       | Resolution                                                                                |
| --- | -------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R1  | High     | Existing request-ID replay cannot restart a failed AI generation              | Distinct explicit retry route and shared logical roll session                             |
| R2  | High     | Current adapters reject tools and multi-step output                           | Separate verified dice contracts, preserving no-tools modes                               |
| R3  | High     | Single-shot input counters may represent cumulative usage after tool calls    | Separate peak context, cumulative usage and reserved continuation limits                  |
| R4  | High     | Strict v1 archive schema would reject or lose new roll fields                 | Explicit v2 export and v1/v2 validated import/remapping                                   |
| R5  | High     | Undo/failure could erase evidence or retries could change dice specifications | Append-only audit, exact ordered replay, no silent reroll                                 |
| R6  | Medium   | AI adjudication cannot be proven from free-form text                          | Explicit limitation, canonical structured references and visible declarations/corrections |

**Coverage**: 14/14 requirements mapped. **Stories**: 3. **Tasks**: 45. **Open product clarifications**: 0. **Technical gates**: installed-version isolation/transport, continuation budgets and Windows live-provider acceptance; these are implementation verification tasks, not claims of support.

## Implementation reconciliation — 2026-10-01

The shared dice feature is connected to production gameplay, explicit recovery, archive v2 and terminal chat. Codex 0.159.2 and Claude 2.1.232 have actual subscription gameplay and crypto-face acceptance evidence. Real Claude-to-Codex recovery preserved the identical saved roll UUID, face and declaration. Codex uses the reviewed provider-specific fresh-phase transport documented above; source extraction and compaction retain no-tools calls. No credentials, global MCP settings or real user campaigns were changed; no commit/push was made.

Retained tests are consolidated rather than split into every originally proposed filename. PostgreSQL integration covers failed final validation, crash recovery, cancellation with late output, unchanged ordered replay, provider switching/capacity, Supertest retry identity/status, full undo, v2 remapping and malformed archive rejection. Existing v1 import/compaction regressions remain. Native anonymous Codex checks prove only-dice exposure and fresh phase boundaries; actual subscription checks are separately labelled. Browser fixtures cover terminal faces, draft-preserving retry, undo audit and export/import. See the capability report for actual totals and limitations.

Open work is explicit: T016/T017 Antigravity owned attachment/budget/native acceptance is blocked by installed-version evidence; no unsupported adapter is shipped. T043 all-provider release acceptance remains open because Antigravity is unsupported. All feasible shared, Codex/Claude, recovery, archive, frontend and retained-test tasks are implemented. T018 now has retained provider/model gating tests; T024 includes a deterministic whole-attempt timeout preserving dice; T036 includes direct model-specific picker gating. T042 browser fixtures verify export/import UI audit, while actual archive validation/remapping is proven separately in PostgreSQL integration. These are 42 implemented tasks and 3 open all-provider gate tasks, rather than full release completion.

No Android/macOS/Linux acceptance is claimed. All-provider release is not complete. Antigravity requires documented exclusive owned attachment/budget controls or a future explicit scope decision; neither simulated rolls nor ambient tooling is an acceptable workaround.

