# Plan: Flow architecture explorer

**Status**: Implemented and verified | **Date**: 2026-10-03 | **Mode**: default
**Request**: Add a button called Flow and an interactive educational page based on `docs/rpg-backend-architecture.md`, explaining information flow, LLM inputs/outputs, tools, database consultation and other architecture concepts.

## Summary

Add a global **Flow** navigation link beside Library, Settings and Rules, opening `/flow`. Build a visual learning experience in the existing English dark journal UI: a clickable system map, guided example-turn walkthrough, prompt/response inspector, tool-call traces and storage/undo explorer. Start with a plain-language overview; expose JSON, source references and implementation caveats on demand.

The page is an explicitly labeled educational illustration with synthetic examples. It never submits gameplay, launches a CLI, reads campaign data or changes PostgreSQL. It uses the reviewed architecture document and verified implementation to teach actual boundaries, including where guarantees stop.

## Context

- Stack: React 19, TypeScript, Vite 7, React Router 7, lucide-react; ordinary CSS and native controls. No existing graph/Markdown rendering dependency.
- Navigation/routes: `rpg_fe_local/src/App.tsx`; global LAN access wrapper in `rpg_fe_local/src/main.tsx` and `features/connections/LanAccessProvider.tsx`.
- Visual conventions: `rpg_fe_local/src/theme/journal.css`, shared controls in `components/Controls.tsx`. Preserve earth/sage/ochre colors, visible focus and 44px targets.
- Existing context inspection: `features/journal/Journal.tsx` supports campaign-specific inspection. Flow is a separate educational route; keep that feature intact.
- Source: `docs/rpg-backend-architecture.md`, particularly sections 2.2–2.8, 3, 4 and 5. Document section 6 is a proposal; do not describe proposed modules as existing backend behavior.
- Tests: Vitest/Testing Library under `rpg_fe_local/tests/`; Playwright under `rpg_fe_local/tests/e2e/`; `rpg_fe_local/playwright.config.ts` starts the existing Vite server when needed.

## Must not change

Existing gameplay, Journal inspection, provider discovery, LAN pairing, request identities, database schemas, prompts, tool definitions and API contracts. No new backend endpoint, production provider mock, document upload, analytics, remote content/font request or dependency. Existing unsaved-draft behavior is preserved; Flow follows ordinary navigation semantics rather than creating another campaign editor.

## User stories and acceptance

### US1 — Follow an action through the system (P1; first deliverable)

Open Flow and understand the whole round trip before reading implementation details.

1. Flow is a real `NavLink` with `/flow` href, active state and normal modified-click behavior, visible globally.
2. The opening map labels Browser → access boundary/API → TurnService → context builder → provider CLI/LLM → validation → atomic commit → browser update. PostgreSQL connects to context/commit/tool services, never directly to the LLM as a SQL connection.
3. Click or keyboard-activate any node/connection to open an inspector stating: purpose, who sends/receives information, example input/output, when it runs, read/write ownership and document/source references. Nothing depends on hover alone.
4. Next/Previous/Reset controls walk a synthetic action through request/revision checks, context preparation, optional compaction, frozen session, tool requests, final proposal, validation and commit. The selected step highlights the related nodes/edges and shows the data moving at that point.
5. Default mode and book mode visibly differ. Provider choice explains Claude/Antigravity HTTP MCP versus Codex stdio dynamic calls; it does not claim offline inference.
6. Failure branches explain same-request replay, invalid-output repair, revision/lease cancellation and explicit retry. Manual retry is a new attempt sharing the original session; it is not automatic crash restart.

### US2 — Inspect what the LLM receives and proposes (P1)

Understand the separation of instructions, reference data and proposals.

1. Human-readable cards precede expandable JSON for the v4 system envelope and user payload (`mandatory`, `memory`, `history`, `rules`). Distinguish ContextManifest metadata from the serialized prompt.
2. Cards explain selected system/campaign instructions, player and scene NPC sheets, canonical state, relevant knowledge, pinned/confirmed sources, uncovered history and optional source retrieval. Private notes and undone/failed turn history are excluded from these automatic selections.
3. Toggle synthetic source pinning, a scene NPC mention and book mode to compare supplied versus omitted information. These controls operate only on authored tutorial examples, not actual campaigns or the backend's context builder.
4. Show a complete schema-valid final proposal with `version`, `narrative`, `operations`, `rollInterpretations`, `ruleCitations`, `knowledgeChanges`. Connect an expected-value operation to validation and a before/after snapshot. Use valid synthetic UUIDs and matched references rather than abbreviated pseudo-JSON.
5. Explain soft retrieval/compaction targets, lossy memory with retained originals, instruction versus runtime enforcement, and structured dice/citation validation versus unchecked narrative arithmetic/semantic fidelity. No UI repeats the former cloud-free, lossless-summary or AI-deadline claims.

### US3 — See tool use and how database consultation works (P1)

Understand what the model can ask and how the app answers.

1. Tool cards cover `roll_dice`, `campaign_knowledge_search`, `campaign_knowledge_get` and book-only `rules_map`, `rules_search`, `rules_get`, `rules_list` with purpose, availability, synthetic arguments/results and next consumer.
2. A clickable sequence follows: LLM request → owned registry/validation → service or frozen recall → result → resumed LLM → final proposal. Clearly distinguish navigation metadata from citable original text.
3. Three traces demonstrate persisted dice before reveal, book text retrieval with a current-turn receipt/quote, and frozen knowledge search/get. Explain sequential dispatch, replay identities and turn ownership checks where they actually occur.
4. Explicitly answer “Can the LLM consult our DB?”: no SQL/database credentials are supplied as a model tool; the app reads PostgreSQL during context preparation and rule lookup, while knowledge recall reads the frozen registry in memory. `roll_dice` writes its audit independently of final gameplay commit. Knowledge changes are proposed in the final response and validated before persistence.
5. Explain absent native shell/file/network/ambient tools and distinguish model tool access from inherited child-process environment/authentication. Show current rule SQL-budget and MCP argument-limit caveats in optional details, not invented stronger guarantees.

### US4 — Explore persistence, recovery and undo (P2; included in complete delivery)

Understand which information persists, what can be reverted and what survives failure.

1. Click storage groups for `campaigns.document`, turns, snapshots, memories, source chunks/artifacts, dice sessions/attempts/records and rule systems/receipts. Each explains stored fields, producing service, consuming service and retention.
2. Toggle success, invalid response, cancellation and undo in a synthetic timeline to see committed state versus independently persisted memory/dice/rule audit. No interaction executes production code or deletes real records.
3. Undo demonstrates field-level restoration, preserved private notes, a touched-field conflict and retained turn/tool audit. A turn that did not change campaign state must not visually overwrite a later state edit.
4. Auxiliary branches explain source/PDF/OCR import, optional character parsing, local dictation/client-side voice, rule-book previews, archives/templates and persistent prompt logs. Include privacy distinctions: logs/archives can contain private content; template creation can retain notes although instantiation clears them.

## Requirements

- **FR-001**: Global Flow route and selected navigation state (US1).
- **FR-002**: Interactive overview map plus guided turn/branch walkthrough (US1).
- **FR-003**: Progressive disclosure of actual actors, information direction, timing, inputs/outputs and document/source evidence for every selected diagram element (US1–US4).
- **FR-004**: v4 instructions/input/response explorer with complete synthetic examples and selection comparisons (US2).
- **FR-005**: All seven named tools and provider/mode differences, with DB versus frozen-memory consultation explicitly distinguished (US3).
- **FR-006**: Persistence, failure, compaction/recovery, retry and undo diagrams (US4).
- **FR-007**: Auxiliary extraction/audio/import/export/privacy pathways available as optional detail (US4).
- **FR-008**: Display “Educational example — no AI call or campaign changes” and source-document review date. Offer the actual bundled document in an expandable plain-text reader with section navigation.
- **NFR-001**: Keyboard-accessible controls, semantic labels/headings, 44px interactive targets, visible focus, status text for step changes and no color-only meanings. Respect `prefers-reduced-motion`; no autoplay walkthrough.
- **NFR-002**: At 360px, 768px and 1440px widths, page and main navigation have no horizontal overflow. Desktop map is graphical; narrow layouts retain an ordered textual node/edge view and readable inspector. JSON wraps or scrolls within its own container.
- **NFR-003**: Flow itself makes zero API/fetch calls, invokes no audio/provider/DB operations and renders untrusted/text content without HTML injection. The existing outer LAN provider may still request `/api/lan/status` and must retain its access behavior.
- **NFR-004**: Lazy-load the Flow route and document/content bundle. Use existing packages only. Default overview shows one inspector at a time and offers four main views: Journey, Payload, Tools, Storage.
- **NFR-005**: Direct links retain selected view/node/step through URL query parameters; invalid selections fall back to the default overview. Refresh and browser Back/Forward work.

## Decisions

| Decision                                                                       | Why                                                                                                          | Alternatives rejected                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Global Flow NavLink and `/flow`                                                | Existing header is the only verified location for “here”; architecture education is not campaign-specific.   | A campaign-only button would hide learning until a campaign exists.                                                    |
| React/CSS nodes and noninteractive SVG connectors, with semantic edge controls | Small curated graphs need direction/highlighting, not freeform graph editing; existing dependencies suffice. | A graph framework adds bundle/install complexity; static Mermaid alone does not deliver the requested data inspection. |
| Four views sharing a selected-item inspector                                   | Keeps the first screen understandable while allowing depth.                                                  | One giant expanded diagram would overwhelm small screens.                                                              |
| Synthetic authored scenarios, clearly labeled                                  | Learning should be repeatable without personal data, database/provider setup or quota.                       | Live execution and arbitrary editable SQL/LLM requests add scope and affect real campaigns.                            |
| Bundled document via Vite `?raw`                                               | Readers can access the real source explanation without adding a backend route or exposing filesystem paths.  | Markdown/HTML renderer dependency and ad hoc API/file access are unnecessary.                                          |
| Backend-only test-time validation of tutorial fixtures                         | Prevents invented contracts while keeping server modules and credentials out of the browser bundle.          | Shipping backend domain code in the frontend couples the application and imports Node-only dependencies.               |

## Data and interfaces

Frontend tutorial metadata is not a new server option catalog. Local `FlowView`, `FlowNode`, `FlowEdge`, `FlowStep`, `FlowScenario` and `FlowToolExample` structures describe educational selections. Use stable IDs, plain labels, plain-language explanations, optional sample JSON, source paths/section IDs, actor ownership and storage classification. Validate node/edge/step references in tests. No import of backend schemas/enums in the production client.

`content.ts` stores the authored map and references. `examples.ts` contains pure synthetic values and scenario variants. `FlowDiagram.tsx` presents selectable nodes/edges. `FlowInspector.tsx` owns consistent detail presentation. `TurnWalkthrough.tsx`, `PayloadExplorer.tsx`, `ToolExplorer.tsx`, `StorageExplorer.tsx` use those shared primitives. `Flow.tsx` owns view/query navigation and lazy document disclosure. Static source paths are displayed as references, not clickable links to inaccessible local files or requests for arbitrary repository files.

Query interface: `/flow?view=journey&node=context&step=prepare`; optional mode/provider/scenario selections use known tutorial IDs. Unknown combinations normalize to a valid selection. Tutorial state remains local; no localStorage or server persistence is necessary.

Test-only `scripts/tests/flow-guide.test.mjs`, run with `node --import tsx --test scripts/tests/flow-guide.test.mjs`, can import backend schemas/functions and pure tutorial fixture data. Verify complete v4 proposals, operation application/snapshots, dice interpretation IDs, source spans and citation evidence where claimed. Do not test equality with the entire prose document or pretend scripted examples execute a real provider.

## Complexity

No dependency or architecture deviation. The new graph/content structures serve multiple requested views; keep them small and avoid a generic simulator framework. One root `test:flow-contract` npm script provides explicit test-time backend/frontend fixture verification using already installed tsx/Zod; it does not alter production contracts or the default application test scripts.

## Clarifications and assumptions

- No blocking product clarification remains after code inspection. The original request asked for a plan. Subsequent user authorization: after review is complete, begin implementation using the coding skills. Finish both independent review rounds before implementing.
- “Here” is interpreted as the existing global header alongside Library/Settings/Rules; no current screenshot/open Page identifies a different location.
- English copy follows frontend rules; explanations lead with plain language and make technical JSON optional.
- Complete delivery includes all four stories. US1 is the first implementable checkpoint, not permission to omit the payload/tools/DB views requested by the user.
- Synthetic learning is the default. Existing LAN pairing wrapper remains; “works without DB/provider setup” means the content does not require them, not bypassing LAN access or ignoring frontend hosting availability.
- No automatic animation, real campaign selection, deployment, publication, new dependency or shared-skill edit is planned.

## Risks and mitigation

- Documentation drift: cite section/source ownership, preserve current caveats, and validate tutorial examples against backend validators in test-only code. This does not automatically prove every explanatory sentence; review prose against current implementation during delivery.
- Schema/path drift: Vite raw import must be verified in both development and production build; test source section references against the bundled document. Avoid a duplicated browser service catalog.
- Misleading demonstrations: label scripted transitions, distinguish application instructions from enforcement, and explicitly separate live state/atomic commits from retained audit and incremental memory writes.
- Header width: adding Flow can overflow existing `.app-header nav`; put navigation wrapping in the globally loaded `theme/journal.css`, and test cold entry outside Flow at 360px as well as Flow itself.
- Browser verification: use the configured Playwright browser or available local executable; report any missing runtime as a gate rather than claiming live interaction passed.

## How to verify

1. `npm run test:flow-contract` → fixture/reference checks pass without PostgreSQL or provider execution.
2. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` → separate root checks pass; ignored plan files receive an explicit Prettier check.
3. `npm run test:e2e --workspace rpg-fe-local -- tests/e2e/flow.spec.ts` → navigation, step/node/edge selection, payload/tool/storage views, deep-link refresh, keyboard interactions, reduced-motion and mobile layout pass with synthetic network boundaries.
4. Open `http://127.0.0.1:5174/flow` during development (or `/flow` on the built backend frontend). Follow an action to final state; inspect every actor and answer the four user questions without reading raw JSON.
5. Confirm only the existing LAN-status request originates from the global wrapper on direct entry; Flow controls create no new requests or writes. Keep existing pairing-required behavior covered.

## Tasks

All tasks are sequential unless stated otherwise. Test/implementation pairs may temporarily be red only between their two consecutive tasks. Each completed task/pair leaves applicable checks green. Planning does not execute these tasks.

### Phase 1: Foundation

- [x] T001 Define shared educational types and IDs in `rpg_fe_local/src/features/flow/types.ts`.
- [x] T002 Define pure synthetic campaign/proposal/tool fixtures in `rpg_fe_local/src/features/flow/examples.ts`; use complete v4 fields, valid UUIDs and linked records.
- [x] T003 Add test-only backend validation of those fixtures in `scripts/tests/flow-guide.test.mjs` (after T002; no live DB/provider).
- [x] T004 Add `test:flow-contract` invoking `node --import tsx --test scripts/tests/flow-guide.test.mjs` in `package.json` (after T003).
- [x] T005 Define graph nodes/edges, walkthrough steps, tool metadata and source references in `rpg_fe_local/src/features/flow/content.ts`; cover FR-002–FR-007 and distinguish tutorial metadata from runtime options.
- [x] T006 Create scoped graph/inspector/responsive/reduced-motion styles in `rpg_fe_local/src/features/flow/flow.css`; page import occurs in T013 after this file exists.

**Checkpoint**: `npm run test:flow-contract`, `npm run typecheck`, `npm run lint`, `npm test`.

### Phase 2: US1 — Journey and navigation

**Goal**: First independently usable Flow page showing the round trip.
**Independent test**: Enter `/flow`, choose a node/edge, advance a step and inspect its sender/receiver and data.

- [x] T007 [US1] Add failing keyboard/node/edge-selection tests in `rpg_fe_local/tests/flow-diagram.test.tsx` (pair with T008).
- [x] T008 [US1] Implement `rpg_fe_local/src/features/flow/FlowDiagram.tsx` with semantic controls and decorative directional connectors (after T007).
- [x] T009 [US1] Implement shared purpose/input/output/timing/evidence disclosure in `rpg_fe_local/src/features/flow/FlowInspector.tsx` (after T005).
- [x] T010 [US1] Add failing walkthrough/branch/reset tests in `rpg_fe_local/tests/flow-journey.test.tsx` (pair with T011).
- [x] T011 [US1] Implement `rpg_fe_local/src/features/flow/TurnWalkthrough.tsx` with scripted steps, provider/mode explanation and failures (after T010).
- [x] T012 [US1] Add failing view/query/document-reader tests in `rpg_fe_local/tests/flow-page.test.tsx` (pair with T013).
- [x] T013 [US1] Implement `rpg_fe_local/src/pages/Flow.tsx` with the existing flow.css import, query navigation, Journey and source-document plain-text disclosure via `../../../docs/rpg-backend-architecture.md?raw`; expose later views only once implemented (after T012).
- [x] T014 [US1] Add failing Flow href/active-navigation tests in `rpg_fe_local/tests/flow-navigation.test.tsx` (pair with T015).
- [x] T015 [US1] Add Flow `NavLink` and lazy route with local Suspense fallback in `rpg_fe_local/src/App.tsx` (after T014).
- [x] T016 [US1] Add global navigation wrapping in `rpg_fe_local/src/theme/journal.css`; verify it on cold entry into Library/Settings/Rules, not just Flow.

**Checkpoint**: `npm run test:flow-contract`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Navigation/source-reader functionality exists; later views are not advertised prematurely.

### Phase 3: US2 — Payload and response

**Goal**: Show exactly what kinds of data enter/leave the model and why.
**Independent test**: Switch to Payload; toggle a pin/NPC mention/book mode and inspect complete input/proposal plus validation outcome.

- [x] T017 [US2] Add failing payload comparison/JSON/proposal tests in `rpg_fe_local/tests/flow-payload.test.tsx` (pair with T018).
- [x] T018 [US2] Implement `rpg_fe_local/src/features/flow/PayloadExplorer.tsx` with human summaries before complete sample JSON, exclusion explanations and expected-value diff (after T017).
- [x] T019 [US2] Register Payload view in `rpg_fe_local/src/pages/Flow.tsx` (after T018).

**Checkpoint**: root contract/typecheck/lint/unit/build commands above; source document section links resolve and selection examples match tested fixtures.

### Phase 4: US3 — Tools and consultation

**Goal**: Explain model requests, app-controlled retrieval and frozen knowledge.
**Independent test**: Follow each dice/book/knowledge trace and identify the actual DB/memory reader and model-visible result.

- [x] T020 [US3] Add failing seven-tool/mode/provider/trace tests in `rpg_fe_local/tests/flow-tools.test.tsx` (pair with T021).
- [x] T021 [US3] Implement `rpg_fe_local/src/features/flow/ToolExplorer.tsx` with all seven tools, traces, receipts/replay and DB/environment distinctions (after T020).
- [x] T022 [US3] Register Tools view in `rpg_fe_local/src/pages/Flow.tsx` (after T021).

**Checkpoint**: root contract/typecheck/lint/unit/build commands; knowledge recall is clearly frozen-memory read, not SQL access.

### Phase 5: US4 — Storage, failure and undo

**Goal**: Teach durability and auxiliary pathways with inspectable outcomes.
**Independent test**: Choose failure/undo examples, distinguish final state from surviving audit, inspect an import/logging branch.

- [x] T023 [US4] Add failing retention/undo/conflict/auxiliary-path tests in `rpg_fe_local/tests/flow-storage.test.tsx` (pair with T024).
- [x] T024 [US4] Implement `rpg_fe_local/src/features/flow/StorageExplorer.tsx` with storage cards, outcome timeline, undo cases and extraction/audio/archive/template/log branches (after T023).
- [x] T025 [US4] Register Storage view in `rpg_fe_local/src/pages/Flow.tsx` (after T024).

**Checkpoint**: root contract/typecheck/lint/unit/build commands; all four views are accessible and existing APIs remain untouched.

### Phase 6: Integration and delivery

- [x] T026 Add end-to-end navigation/interactions/deep-link/mobile/reduced-motion/no-network-mutation/LAN-regression checks in `rpg_fe_local/tests/e2e/flow.spec.ts` (after T025).
- [x] T027 Resolve measured layout/accessibility issues in `rpg_fe_local/src/features/flow/flow.css` (after T026; 360/768/1440px, 44px targets, visible focus, text alternatives, contained JSON).
- [x] T028 Document Flow entry point and educational-only behavior in `README.md` (after T025).
- [x] T029 Record actual check results and browser/runtime limitations in `rpg_fe_local/IMPLEMENTATION.md` (after validation).
- [x] T030 Reconcile completed work, changed assumptions and remaining gates in `docs/plans/flow-explorer.md` (after T029).

**Final checkpoint**: `npm run test:flow-contract`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, focused Playwright command above and explicit plan formatting check. No deployment or commit is implied.

## Review

Self-check: all FR/NFR requirements have story/tasks; no application code was written during planning. No new dependency, backend route, schema migration or provider call is required. Independent reviewer must perform two sequential rounds against real code; parent applies corrections between rounds.

| Round         | Findings                                                                                    | Resolution                                                                                                                | Remaining gates                      |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Self-check    | Coverage and architecture checked                                                           | Plan uses existing router/CSS/testing and keeps LAN wrapper                                                               | Implementation/tests not run         |
| Independent 1 | Global navigation styles incorrectly scoped to lazy page; stylesheet task spanned two files | Move header wrapping into journal.css; create flow.css before the page task that imports it                               | Implementation/tests not run         |
| Independent 2 | No remaining confirmed planning defects                                                     | Reviewer verified global styles, atomic task order, dependencies and backend/testing contracts; implementation authorized | Both planning review rounds complete |

**Coverage**: 8 FR + 5 NFR / 13 mapped requirements · **Stories**: 4 · **Tasks**: 30 · **Open product clarifications**: 0.

## Delivery reconciliation — 2026-10-03

All four stories are implemented. All 30 tasks are complete. The guide ships no new dependency,
backend endpoint or provider/database operation. Independent review completed twice before
application implementation; the implementation was checked against the acceptance criteria,
actual backend contracts and browser behavior.

Implementation refinements:

- Added `responseSchemaExample.ts` and `systemPromptExample.ts` as reviewed, pure teaching
  snapshots. The root fixture test verifies the complete schema/envelope through the real context
  builder for all eight pin/NPC/book combinations; server modules never enter the client bundle.
- Added a PostgreSQL diagram actor and explicit context/tool/commit storage connections.
- Added mobile inspector focus/scroll and a return control; desktop retains the side inspector.
- Book-tool deep links and browser history derive availability from the selected book tool,
  preventing a restored selection from appearing disabled under default mode.
- Updated architecture section 6 from a proposed roadmap to the actual implemented guide.
  Budget sliders/live execution were proposals, not delivery requirements; no such operations
  are advertised. README documents the guide and contract-check command.

Verification: four backend fixture tests, 59 frontend unit tests and 118 backend unit tests
passed. The normal backend run skips 55 explicitly opted-in database/provider/extraction checks.
Installed Windows Chrome passed all 18 synthetic browser scenarios, including five Flow tests;
six real-runtime browser scenarios remain explicitly opted in. Flow verified 360/768/1440px
layout, cold Rules-entry global navigation, keyboard selection, mobile detail focus/return,
URL refresh/Back/Forward, reduced-motion rendering, document disclosure, no campaign/provider
requests and retained LAN pairing. Typecheck, zero-warning lint, formatting and production
build passed. The plan receives an explicit Prettier check because `docs/plans` is normally ignored.

Playwright's default downloaded headless browser is absent; checks used the existing
`C:\Program Files\Google\Chrome\Application\chrome.exe` via `LOCAL_BROWSER_PATH`.
No package/browser installation, AI call, campaign change, deployment or commit was performed.
Existing concurrent backend/Journal edits were preserved. No delivery gate remains for Flow;
physical Android and live provider checks are not established by synthetic browser tests.
