# Local RPG — migration and redesign plan

Status: implemented and converged, 2026-10-01. See `../reviews/completion.md` for current validation evidence and explicit device/provider limits.
Mode: implementation. Fresh local Git repository initialized; no GitHub publication.

## Summary

Build a new public project from the useful gameplay features of `rpg_be` and `rpg_fe`, with backend and frontend named `rpg_be_local` and `rpg_fe_local`. Remove application users/login, cloud LLM clients, adventure generation, and map generation. Run installed AI CLIs using the player's own subscription login. The frontend must let the player change CLI, model, and supported effort settings easily.

The app owns durable campaign context and state. A CLI supplies a proposed turn response; backend validation and an atomic commit decide what becomes part of the game. Build a fresh frontend around playing, character sheets, and a journal.

## Confirmed requirements and clarifications

- Local AI means a local CLI using an existing subscription, not local model inference.
- Frontend controls must switch between CLIs, their models, and their effort settings.
- Preserve useful RPG gameplay features; remove application authentication and user ownership.
- No whole-story/adventure generation in v1; it may return later.
- No map generation in v1.
- Review Gylden Rune backend/frontend architecture as a reference.
- New version is intended for public Git hosting and must contain no credentials.
- A whole new frontend is permitted; inspect the current frontend before designing it.
- One fresh repository, provisionally `rpg_local`, containing `rpg_be_local` and `rpg_fe_local`. This supersedes the earlier two-repository choice (2026-09-30).
- Start with fresh campaigns; no legacy campaign migration in v1.
- Desktop host plus cellphone browser on the same Wi-Fi/LAN. This supersedes the earlier same-computer-only choice (2026-09-30); public internet access remains excluded.
- Keep the flexible system-agnostic AI GM; no app-enforced dice/combat engine.
- Preserve campaign context when switching CLI/model/effort.
- Support pasted text, local Markdown/text files, PDFs, and public Google Docs.
- Dark journal visual direction, with raw JSON editing under Advanced.
- Investigate the local `D:/projects/markitdown` checkout for document conversion.
- Keep PostgreSQL for persistence.
- Scanned PDFs must work in v1, using a local/key-free OCR pipeline.
- AI character/inventory/state changes apply automatically, with a visible change list and full undo; this extends automatic mutations to the player sheet as well as NPCs.
- Context uses recent turns, automatically updated campaign memory and relevant retrieved rule sections; retain full transcripts and inspectable memory.
- English interface; Windows is the tested/release target. Keep portable boundaries where practical, but mark macOS/Linux unverified until tested.
- Reusable campaign/character templates and new-version campaign export/import are included in v1.
- Scanned PDF extraction may require preview and text correction before AI-assisted sheet parsing; this review step is accepted.

## Existing implementation: evidence and migration implications

Source paths below are relative to `D:/projects/rpg` unless stated otherwise.

| Evidence | Finding | New-version implication |
|---|---|---|
| `rpg_be/src/services/rpgLogic.js:57` | Prompt combines rules, characters, history, and player input. Rules and sheets are free-form JSON/text. | Preserve system-agnostic gameplay and rebuild the prompt boundary as a testable module. |
| `rpg_be/src/services/rpgLogic.js:180` | Main turn requests an LLM, saves player/GM entries and NPC changes, then requests a summary. | Separate slow provider execution from short database commits. |
| `rpg_be/src/services/rpgLogic.js:247` | Existing NPC update has no transaction parameter and no before-image. | Character mutations must join the turn commit and have recoverable prior state. |
| `rpg_be/src/services/rpgLogic.js:280` | Undo deletes generated records and newly created characters; does not restore changed existing NPCs. | Implement full state restoration for the latest turn, including characters and memory. Confidence: 100, directly evidenced. |
| `rpg_be/src/services/rpgLogic.js:311` | Every turn summarizes all chat through another AI call, explicitly preferring the cloud fallback. | Remove cloud coupling; adopt the threshold-based bounded memory policy specified below. |
| `rpg_be/src/services/charCreate.js` | Public Google Docs character parsing is wired; PDF extraction path is commented out. | Do not describe PDF import as already working. Decide new input support explicitly. |
| `rpg_be/src/services/gameCreate.js` | Rules accept text/public Google Docs and optionally serialize a generated adventure. | Keep rules/source processing; remove generator ownership/model dependencies. |
| `rpg_fe/src/pages/Play.jsx:348` | Actual UI uses eight tabs: chat, notes/state, inventory, attributes, description, others, NPCs, technical info. | Redesign for chat with accessible sheets/journal; avoid reproducing the tab-heavy arrangement blindly. |
| `rpg_fe/src/pages/CreateGame.jsx` | Setup includes instructions, rules links/text, character link, templates, and optional generated adventure. | Shorten setup around campaign, rules, character, provider, and first turn. |
| `rpg_fe/src/api.js:5` | Production mode changes API host to the deployed backend; token interceptors redirect to login. | New production frontend stays connected to its local backend; delete auth interceptors. |
| `rpg_be/src/server.js:12` | Express listener has no loopback host specified; CORS is unrestricted in app setup. | Local CLI-launching app needs explicit host/origin restrictions even without user accounts. |
| `rpg_be/src/services/internalService.js:5` | Hard-coded import credential confirmed; value deliberately omitted here. | Do not copy this service, token, generator import endpoint, or old Git history. |

No tracked `.env*` paths were returned by the initial `git ls-files` checks in RPG backend/frontend. This is a narrow check, not a completed publication secret audit. Current backend working tree has pre-existing package changes and an untracked scripts directory; leave these intact.

## What to retain, rebuild, and omit

| Retain behavior | Rebuild implementation | Omit in v1 |
|---|---|---|
| Campaign create/list/open/delete; saved rules and campaign instructions | Typed campaign services and local persistence | Users, login, registration, JWT, ownership columns |
| Player characters, NPCs, inventory, attributes, description, personal notes | Flexible sheet editor, validated JSON under Advanced | Community browsing and user-owned templates |
| GM chat, contextual NPC updates, GM auxiliary state | Provider-independent turn contract and runner | OpenRouter/Gemini API clients, keys, fallback chain |
| Campaign memory/journal and undo | Bounded memory and complete turn snapshots | Adventure/map generators, generation-specific queue and statuses |
| Reusable campaign and character setup | Local templates and versioned campaign export/import | Deployment URLs, private documents, runtime logs and generated data |

## Gylden Rune architecture reference

Reviewed `D:/projects/gylden rune/AGENTS.md`, root/project CLAUDE files, package manifests, representative task routes/service/frontend service, payment hook, and theme.

- Copy the separation of Express route adapters and domain services: `gr_be/src/routes/tasks.ts` and `gr_be/src/services/taskService.ts`.
- Follow its pattern of slow AI preparation before opening a write transaction: `gr_be/src/routes/tasks.ts:64`.
- Expose provider/model/effort options from the backend, like `taskService.ts:125` and `gr_fe/src/services/taskService.ts`. Frontend renders capabilities instead of inventing model/effort lists.
- Use request identity/revision checks and isolate live job state from unsaved forms, following `gr_fe/src/hooks/useSalePayment.ts`.
- Keep API clients, hooks, page layout, and shared components separate. Centralize theme tokens as `gr_fe/src/theme.ts` does.
- Do not copy Gylden business domains, its auth/debug shortcuts, production-host assumptions, missing validation layer, dependency conflicts, or generic utility framework wholesale.

## Selected architecture

Use one fresh repository, provisionally `rpg_local`, with `rpg_be_local/`, `rpg_fe_local/` and `docs/`. Keep app-specific scripts/builds/tests and backend-owned HTTP options/schemas, with root npm workspace commands for one install, coordinated builds and one-command Windows startup. Backend and frontend changes share a commit/release. No inherited Git history; the old repositories remain reference-only. PostgreSQL/Python/OCR and official CLI installation are still external prerequisites; one npm command does not install all system dependencies.

Proposed stack: TypeScript, Node/Express, React/Vite. UI library can remain MUI with a deliberate new theme. Exact runtime/package versions must be checked during implementation; do not copy legacy backend engine declarations or conflicting Gylden tooling.

Implementation clarification (2026-09-30, requested by owner): adopt applicable conventions from the main Gylden Rune `CLAUDE.md` and both app files, with root/app `CLAUDE.md` memory and an `AGENTS.md` pointer. Share its exact Prettier style once at the monorepo root; provide distinct lint/fix, typecheck, format/check commands and React hook checks. Use compatible supported ESLint tooling (ESLint 10, Node 22.13+). Transfer backend-owned option sets/capabilities, thin routes, named domain constants, sequential application I/O, immutable migrations, locked transactional mutations, isolated tests and responsive/stale-response frontend behavior. Keep credentials, business-specific rules and legacy workarounds out. The implemented adaptation is documented in `docs/development-standards.md` in the new repository.

Backend structure:

```text
rpg_be_local/src/
  routes/                 # HTTP translation only
  services/               # campaigns, characters, turns, imports, provider options
  domain/                 # schemas, prompt construction, memory, state application
  providers/              # runner and adapters: claude, codex, antigravity
  persistence/            # migrations, repositories, transaction boundary
  config/                 # local settings and provider capability catalogs
```

Frontend structure:

```text
rpg_fe_local/src/
  pages/                  # library, campaign setup, play, settings
  features/               # campaign, chat, character sheets, journal, provider picker
  services/               # typed local API clients
  hooks/                  # turn lifecycle; preserve unsaved edits
  components/             # shared accessible controls
  theme/                  # colors, typography, spacing
```

Selected persistence is PostgreSQL. Use a new, explicitly local database with migrations and transaction/revision semantics; never reuse production credentials or databases. Runtime data lives outside versioned sources and remains excluded from Git. Provide native local PostgreSQL setup instructions; an optional container recipe may be offered without making Docker mandatory.

Alternative discussed: SQLite supports transactions and many readers, but only one writer at a time. It suits single-player scope and simpler installation; the user explicitly chose to retain PostgreSQL. Source for tradeoff explanation: https://www.sqlite.org/whentouse.html .

### Document conversion

Inspected `D:/projects/markitdown/README.md`, core `pyproject.toml`, PDF converter and OCR plugin documentation. No conversion or package installation performed.

- Standard MarkItDown PDF extra uses local `pdfplumber`/`pdfminer` extraction; no cloud API is needed for text PDFs.
- Node backend invokes a narrowly scoped Python converter over an uploaded/local staged file, with size/time/output limits. Save extracted Markdown and source metadata, preview before AI-assisted character parsing.
- Public package installation is reproducible and pinned; the public app cannot depend on this machine's `D:/projects/markitdown` checkout. The checkout is a reference and development resource.
- Python adds a runtime requirement. Document installation and a local environment outside synced folders; do not vendor its `.venv` or repository.
- Scanned/image-only PDFs must work. This checkout's OCR plugin uses an LLM API client, not a drop-in subscription CLI connection. Use the selected local PDFium/Tesseract page adapter, with language selection and a preview step. Do not silently return an empty successful import or introduce API-key OCR as a hidden fallback.
- Preserve public Google Docs input with restricted document URL handling, bounded fetching and cached extracted content. A fresh campaign can start from pasted/file content without a Google account integration.
- Large rulebooks use the bounded source retrieval policy below. Text edited during preview becomes the authoritative source version; index corrected content, not discarded original OCR. Replacing/correcting a source increments campaign context revision and retains provenance.
- Import transport accepts uploaded bytes, not arbitrary browser-supplied filesystem paths. Resolve Google Docs IDs on approved HTTPS hosts; restrict redirects and private-network destinations. Conversion runs only on a staged upload. Initial limits: 20 MiB/upload, 300 PDF pages, 120 s extraction timeout, 10 MiB extracted text; oversized inputs fail explicitly and can be split by the player. Escape displayed text and do not render uploaded HTML/scripts.
- Source extraction/preview is deterministic/local and works before CLI adapters exist. AI-assisted character parsing is a later, separately tested feature: approved source text goes through a bounded fresh CLI request, returns a validated draft sheet, and requires confirmation before saving. A large sheet can be split or edited manually; never pass the whole unbounded file to the CLI.

Selected scanned-PDF pipeline: inspect page text; retain native text through MarkItDown; render pages needing OCR at 300 DPI with `pypdfium2`; run Tesseract with English/Portuguese language data; preserve page number, source hash, extraction method, OCR confidence/coordinates and warnings alongside extracted text. Mixed PDFs are processed per page, not classified as all-text or all-scan. Use page/section boundaries for future retrieval and citations. The user accepts preview/correction before AI-assisted parsing; no exact automatic table fidelity is promised.

Python 3.12 is installed here. Tesseract/OCRmyPDF were not found on PATH; the default Python lacks the conversion packages. Existing project virtual environments were not checked, so this does not establish whether the MarkItDown checkout is already runnable. Public setup must install/discover its own dependencies and cannot rely on the Codex-bundled PDF renderer.

Prefer a dedicated local page OCR adapter over the checkout's LLM OCR plugin. Tesseract table reconstruction and decorative/multi-column text are imperfect; preserve images and warnings for correction. Do not promise exact automatic sheet parsing. OCRmyPDF can be an optional searchable-PDF tool later, rather than a required preprocessing layer with additional system dependencies.

Primary references: https://tesseract-ocr.github.io/tessdoc/Installation.html ; https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html ; https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html ; https://github.com/pypdfium2-team/pypdfium2#licensing .

### Verified installed CLI transport

Read-only command discovery and help inspection confirm Claude Code, Codex and Antigravity AI CLI are installed. Claude supports `-p`, JSON schema and JSON/stream-JSON output; Codex supports `exec`, stdin, schema file and JSONL events; Antigravity uses `agy`, with headless/schema/stream output. Its IDE launcher is a different executable. Discover binaries at runtime; do not commit machine-specific executable paths.

Claude subscription mode must not use `--bare`, which ignores normal OAuth/keychain authentication and requires API credentials. Tool/customization isolation must retain the official CLI's normal login. Verify allowed end-user invocation against provider documentation before shipping; collect no credentials. Help output verifies transport flags, not active login/model availability or successful real gameplay.

Primary references: https://code.claude.com/docs/en/headless ; https://developers.openai.com/codex/noninteractive/ ; https://developers.openai.com/codex/auth/ ; https://antigravity.google/docs/cli/headless/ ; https://antigravity.google/docs/cli/install/ .

### CLI adapter contract

- Backend discovers installed supported binaries and reports availability/version/diagnostic status.
- Backend serves each provider's models and model-specific effort capabilities; unsupported controls disappear or disable with a reason. Catalogs carry provenance/version and are refreshable; do not promise automatic model discovery where the CLI lacks it.
- Settings are per campaign, with an optional global default. Capture provider/model/effort at turn submission so changing the toolbar cannot mutate an in-flight run.
- Request contains player action plus app-built campaign context and a versioned response schema.
- Every gameplay, character-parsing and compaction request starts a fresh isolated CLI session. Never use resume/continue or a previous conversation ID. Suppress workspace/user instruction injection, persisted CLI memory and tools using verified provider-specific controls while retaining subscription login. A provider that cannot meet isolation/budget requirements is shown as unsupported with a reason; do not silently weaken these rules.
- Provider response contains narrative and explicit character/state operations, not an authoritative memory replacement. Dedicated bounded compaction creates memory checkpoints. The versioned response schema specifies allowlisted operations/fields, campaign-scoped existing IDs and temporary IDs for new entities; backend assigns persistent IDs. Operations include expected prior values so invented/stale targets are rejected. Reject the entire response on an invalid operation; never partially apply it or treat invalid JSON as a successful plain-text turn.
- Validation checks shape, references and allowed changes; it cannot prove the story or a rules interpretation is true. Keep the flexible AI GM scope, display changes and supplied rule references, and provide undo. Do not describe these checks as eliminating hallucinations.
- Runner uses fixed provider adapters, structured argv/stdin, controlled working directory, bounded output, timeouts, and process-tree cancellation. Never interpolate a player action into shell command text or expose a browser-supplied arbitrary command.
- Use the installed official binary's own login; never copy, export, or ask the frontend for subscription tokens. Do not ship a shared proxy or credential relay.
- CLI sandbox/tool policy must be verified independently per provider. Prefer generation without tools; if filesystem output is needed, restrict it to an isolated per-run directory. Never run a campaign prompt with access to the source repository or arbitrary local tools.
- Missing CLI/login, invalid model, subscription limit, timeout, invalid JSON, and unsupported effort produce explicit errors without campaign mutation.
- Stream job progress and completed narrative as supported. Partial streamed data is a preview until validated and committed; no hidden reasoning is displayed.

### Durable turn lifecycle

1. Receive action with campaign revision and stable request ID. Within a short transaction enforce a unique request ID per campaign and at most one pending/running turn, backed by a database constraint/lock, not an in-memory flag. Reusing the request ID with different input/settings is a conflict; a completed request returns its stored result even after later undo.
2. Capture an immutable context manifest in the same consistent database snapshot: character/state versions, pinned facts, source versions, memory checkpoint and eligible active-history IDs, along with provider/model/effort. Save pending turn/job and release the transaction. All context-affecting edits increment the context revision; private player notes have a separate revision and enter prompts only when explicitly shared.
3. If preflight requires compaction, perform it as a child of the reserved campaign job with the same ownership/lease, before launching the GM. Recapture the manifest with the newly valid checkpoint in a short transaction only if the submitted context revision still matches; a player edit requires resubmission. Construct the bounded prompt from that manifest, never a fresh mixture of live rows, and execute the provider outside a write transaction.
4. Validate output. In the commit transaction lock the campaign and compare captured context revision atomically with the current revision; stale output cannot overwrite manual edits/undo. An earlier check followed by an unlocked write is insufficient.
5. In one short transaction save before-state snapshot, apply validated state changes, append player/GM messages and memory, complete job, and increment revision.
6. On failure/cancel, retain diagnostic job status and preserve playable campaign state. A retry with the same ID queries the original attempt; an explicit retry of a failed/cancelled attempt uses a new ID. Claim jobs with persisted ownership/lease. After restart, abandoned runs become interrupted and require explicit retry; do not automatically launch a second CLI for an uncertain old run. Cancellation and completion compete through one conditional database transition: if commit won, return completed; if cancel won, late output cannot commit. Disconnecting the browser does not itself cancel a job.
7. Undo latest completed turn restores its prior canonical state without another provider call. Full transcript includes an auditable undone marker rather than silently losing history. Any manual sheet/notes edit after the turn must be preserved: snapshots separate turn-owned state from player notes, and undo rejects conflicting later edits with an explanation rather than blindly restoring an old whole-campaign object. Revision checking and conflict cases belong in undo tests.
8. Reject undo while a turn is active. Restore turn-owned before-images in a locked transaction; use touched-field/entity revisions to detect later manual conflicts, not an unconditional full-campaign overwrite. Increment the context revision and invalidate every checkpoint covering the undone turn, including checkpoints created after its original commit. Select the latest valid checkpoint and replay only still-active turns. Undone/failed/cancelled narrative is excluded from future prompts and retrieval, although retained in the audit view.

### Selected context and memory policy

Keep canonical character/inventory state and pinned campaign facts separate from narrative summaries. Build each prompt from fixed GM instructions, selected/pinned rules, relevant retrieved source sections, current state, a memory checkpoint and recent turns not already covered by that checkpoint. Preserve source/page references so the player can inspect which rules were supplied.

Start retrieval with PostgreSQL full-text search and section/page chunking; avoid adding an embedding API or vector server merely for v1. Query current action plus active scene/character terms, limited to confirmed current source versions. Retrieval quality needs representative rulebook scenarios; a lexical search cannot guarantee every implicit rule is found. Players can pin relevant source sections or facts. Mark rule/source text as reference material rather than executable instructions.

Initial conservative settings (configurable, persisted and visible): gameplay input ceiling 16,000 tokens, including instructions/schema, state, memory, action and retrieved text; compaction input ceiling 8,000 tokens; memory checkpoint ceiling 2,000 tokens. These are app limits, not the model's full advertised window. Reserve completion/reasoning capacity and safety margin per verified model capability; use the smaller of the app ceiling and available model input capacity. Use an appropriate tokenizer when available, a documented conservative estimator otherwise, and label estimates. Unknown model capacity disables that selection until configured/verified. Measure the final assembled request, not only chat text.

One complete historical turn that cannot fit a compaction batch is an explicit overflow case: preserve it and block automatic compaction rather than truncate or skip it. Offer an explicit player-edited memory checkpoint with a preview of exactly which turns it would cover. Confirmation is required before that checkpoint changes coverage. Likewise, an oversized summary output fails validation; no silent tail truncation. Budget changes and confirmed manual memory/pinned-fact changes increment context revision. AI calls do not automatically retry across providers or regenerate completed turns.

Mandatory material is fixed GM instructions/schema, current player action, pinned facts/rules and active player/current-scene state. Select relevant NPCs/state rather than serializing every historical entity. If mandatory material alone exceeds the budget, stop and explain what needs reducing; never silently remove it. Fill remaining space with the selected checkpoint, recent complete turns and relevant rules. Avoid cutting a turn, source chunk or JSON object in the middle.

Trigger compaction when uncovered active history would exceed 6,000 tokens or total candidate gameplay context exceeds 80% of its effective input ceiling. Process the previous bounded checkpoint plus consecutive uncovered active turns in batches that fit the compaction ceiling, without rereading the full transcript or doing recursive uncontrolled calls. Each checkpoint stores exact covered-turn IDs/boundary, source/state revision and predecessor; promote only if its captured revision is still current. Retain important unresolved threads/pinned facts explicitly; no summary may overwrite canonical character state.

Serialize compaction and gameplay for a campaign, using the same persisted ownership/revision guards. Before another turn, compact when needed; save already completed turns independently. If compaction fails or its output exceeds its limit, keep the previous checkpoint and report failure. Continue only if all mandatory context plus uncovered active history fits; otherwise block with an actionable message. Never silently discard unsummarized turns to squeeze in a prompt. Undo invalidates coverage as described above. Full transcripts remain saved and separately inspectable, never automatically attached by the CLI.

Data entities: Campaign (instructions, context revision, selected provider settings), Character (flexible attributes/inventory/description, field/entity revision, separately owned notes), Source/SourcePage (confirmed corrected content, version, page references and extracted artifacts), Turn (request ID, status, input, narrative, operations/change list, captured context manifest/provider settings, revisions), Job (ownership/lease/status), Snapshot (turn-owned before-images), MemoryCheckpoint (bounded summary, covered active-turn IDs, predecessor/revisions), Template (versioned setup without live history). No User model.

Required endpoints: `/api/campaigns`, campaign characters, campaign turns, turn status/events/cancel, latest-turn undo, `/api/providers`, local settings, source extraction/confirmation/character-draft parsing, templates and campaign export/import. Backend owns status values/defaults/options. All writes validate payloads, revisions and campaign-scoped references. GET never launches a CLI. SSE reconnect retrieves stored job status; a streaming disconnect does not resubmit a turn.

## Proposed frontend journey

- Library opens immediately, showing local campaigns and Create Campaign. No login route.
- Setup asks for name, rules/instructions, character input, and an available provider. Show extracted content/character before saving AI-assisted imports.
- Play emphasizes readable GM messages and a persistent composer. Top toolbar exposes CLI, model, and supported effort, plus run status and Stop.
- Desktop can show a collapsible party rail and character/journal inspector beside the chat. Cellphone/narrow-window layouts use a single main panel and drawers; support browser access to the Windows host on the same Wi-Fi/LAN.
- Journal separates campaign memory from player notes. Character details show readable attribute/inventory sections with an Advanced JSON editor.
- Diagnostics are under Advanced/settings. Use actual provider usage where available; label any token estimates as estimates, not subscription balance.
- Preserve typed input on errors, show actionable provider failures, and keep unsaved sheet edits while progress updates arrive.
- Selected visual direction: atmospheric dark journal, with raw JSON under Advanced. A responsive design mock should precede detailed component implementation.

Production packaging for the monorepo: FE calls relative `/api`; BE serves the sibling FE build directory resolved from the installed app root and SPA fallback, with API routes taking precedence. Root build compiles both apps; root start runs the backend serving that build. Root dev coordinates backend and Vite on fixed local ports with the Vite proxy. A missing FE build gives setup instructions, not a production-host fallback. Local write endpoints enforce approved Host/Origin and JSON/custom-header requests; missing Origin is accepted only for explicit local CLI clients with the required header. CORS alone is not a write-access guard. No application accounts/User model are added; LAN device access is a separate boundary described below.

### Cellphone on the same Wi-Fi

Keep default startup loopback-only. Explicit LAN mode exposes only the game web/API listener on a selected LAN interface, with configured allowed hosts/origins; CLI transports, database and internal control endpoints remain loopback-only. Frontend and API share the Windows host's origin, so a phone never calls its own `localhost` for the backend. Show the reachable LAN URL/QR in desktop connection settings. The PC must remain awake/running; same SSID alone is insufficient if guest/client isolation or firewall rules block device traffic. Document a narrowly scoped Windows Private-network firewall rule; never open router ports or silently modify firewall settings.

For typing/text play, visiting a URL such as `http://192.168.1.20:3001` can work once LAN mode/network access is configured. Browser microphone recording requires a secure context: use HTTPS with a certificate trusted by the phone for audio; simply bypassing a self-signed warning is not a supported microphone setup. Local CA creation/trust instructions and certificate/key exclusion from Git must be included if LAN voice is shipped. Source: https://www.w3.org/TR/mediacapture-streams/ . Phone OS/browser and a real device test remain validation prerequisites; desktop emulation does not prove microphone or voice behavior.

Recommended LAN access control is one-time desktop-approved device pairing, without an account/password/User model: expiring single-use connection code exchanges for a revocable session; no CLI subscription tokens are shared with the phone. Runtime pairing/session secrets never enter Git, exports or logs. Protect campaign reads as well as writes from unpaired LAN clients, enforce same-origin/CSRF guards, and keep code attempts bounded. Pairing UX is a proposed technical safeguard to confirm before implementing LAN exposure. LAN typing is a confirmed scope change; in-app audio/HTTPS remains the exploratory addition below.

## Public repository acceptance gate

Create a new repository from an allowlist of reviewed sources; never clone old history into it. Exclude `.env`, credential files, DB dumps, local saves, logs, prompts containing private content, uploaded rulebooks, generated adventures, screenshots with private data, and all `.git` directories. Public fixtures must be synthetic or clearly licensed.

Use placeholder-only example configuration. Scan staged content, generated frontend bundles, fixtures/docs/scripts/configs, and every commit in the new repo for credentials before publication. Document scanner findings and resolve each; a regex-only source scan is insufficient. Verify the production frontend calls the local backend and no legacy cloud service is invoked. Never include discovered credential values in reports.

## Assumptions and release-only decisions

Product interview is resolved. Technical defaults: one active turn per campaign; latest-turn undo only; explicit stable request IDs; allow manual provider selection with first-available initial default; remember campaign choice; no automatic cross-provider fallback on errors. Settings are captured per run. Templates instantiate copies; import creates a new campaign. These defaults are reversible and recorded for review.

Release-only decision: license/publication destination. Leave publication and license selection for an explicit release request; do not silently publish or add a license on the owner's behalf. Default provider/model can safely be a configurable first-available default, remembering the campaign selection. Legacy data migration is excluded. LAN typing is included by the later user request; pairing UX and HTTPS/audio delivery require final scope confirmation. Public internet deployment remains excluded.

## Implementation phases

1. Scaffold clean repos, TypeScript/test tooling, public-source allowlist, local configuration, persistence/migrations and runnable app shells. Independent check: fresh clone can open the library without an application account or cloud API key; CLI subscription login is still required for AI features.
2. Validate real CLI transport progressively when each adapter is implemented; verify fresh sessions, isolation, subscription transport, model/effort and budgets before enabling that provider. No paid/model calls have been made during this planning audit.
3. Build campaigns/characters and requested source imports, plus library/setup UI. Check: restart retains a campaign and editable sheets; input failures do not create partial data.
4. Implement runner and adapters one at a time with recorded synthetic CLI fixtures. Check: model/effort validation, partial output, malformed JSON, missing CLI, timeout, Windows launch and cancellation are covered without paid calls.
5. Implement canonical context, durable turns, validation, revision checks, snapshots, memory, and latest-turn undo. Check: duplicate requests, stale results, provider failures and restart recovery never apply state twice; undo restores changed NPCs and memory exactly.
6. Implement redesigned play view, provider/model/effort switching, progress, sheets, journal, Advanced tools and responsive layout. Check: switch providers mid-campaign with the chosen continuity policy, retain drafts, cancel safely, and handle all empty/error states.
7. Add requested import/export compatibility, setup docs, synthetic examples, release checks and full secret audit. Independent check: a clean install creates and plays a campaign using a player's pre-authenticated CLI; built UI never reaches old production services.

## User stories and acceptance

- US1 — Local campaign setup: open without login, create from text/files/Google Docs/PDF (including scans), inspect/correct extraction, save flexible characters/rules, reopen after backend restart. Initial setup supports manual character entry; AI-assisted sheet drafts arrive after CLI adapters. PostgreSQL persistence; no production database calls.
- US2 — Interchangeable GM: choose an installed CLI, valid model and model-supported effort; play a turn; switch provider and continue from the same canonical context. Missing login/model/CLI or rejected output leaves game state intact.
- US3 — Reversible gameplay: see narrative and applied state changes, edit sheets/notes, preserve drafts during asynchronous work, cancel a run, retry a lost response without duplicate application, undo the latest turn and restore changed/created characters and memory.
- US4 — Reuse and backups: save campaign/character templates; export a versioned new-format campaign from a consistent DB snapshot, only when no turn/compaction is active; import it as a new local campaign with remapped identities. Preserve confirmed source text, characters, history, valid memory and undo snapshots. Do not require retaining original PDFs/page images for playable export. Remap all source/character/turn references, including structured operations, snapshots, manifests and checkpoint coverage; ID-bearing state uses schema-owned references, never arbitrary hidden JSON keys. Reject malformed/unsupported/oversized archives before writing; imported operations are data, never executed. Omit credentials, pending jobs, diagnostics, executable paths and local filesystem paths. Missing provider availability on import requires reselection, not a failed data import.

## Decisions and added complexity

| Decision | Why | Simpler alternative |
|---|---|---|
| One fresh repo with two apps | Updated user preference; one clone/startup and coordinated changes/releases | Two repos superseded by user |
| PostgreSQL | Explicit user preference and existing familiarity | SQLite discussed, rejected by user |
| TypeScript and module boundaries | Follow useful Gylden patterns; validate provider/state boundaries | Copying legacy JS engine would preserve undo/cloud coupling |
| Three isolated CLI adapters | Requested provider/model/effort switching | Single CLI insufficient |
| Python + local OCR binaries | Required scanned PDFs without API keys | Text-only conversion insufficient; LLM OCR adds API dependency |
| Durable jobs and snapshots | Slow/cancellable providers and reliable full undo | HTTP call plus row deletion insufficient |
| PostgreSQL text retrieval | Required relevant rules within bounded context | Full-rulebook injection grows without bounds; embeddings add unnecessary service |
| Backend-owned versioned API contract | Apps must agree without duplicated model/effort/options lists | Shared runtime contract package remains optional; served options are authoritative |

## File-level implementation tasks

Paths are relative to the selected monorepo root. `BE` = `rpg_be_local`, `FE` = `rpg_fe_local`. Tasks are dependency ordered; test/implementation pairs are consecutive. Source repos remain reference-only.

### Foundation

- [x] T001 Define root npm workspaces and coordinated install/dev/build/test/start commands in `package.json` (app scripts are filled by the following scaffold tasks).
- [x] T002 Define backend install/build/lint/test/dev scripts in `BE/package.json`.
- [x] T003 Define backend TypeScript compilation in `BE/tsconfig.json` (after T002).
- [x] T004 Define frontend install/build/lint/test/e2e/dev scripts in `FE/package.json`.
- [x] T005 Define frontend referenced TypeScript compilation in `FE/tsconfig.json` (after T004).
- [x] T006 Configure local development proxy and production local API behavior in `FE/vite.config.ts` (after T004).
- [x] T007 Create frontend document entry in `FE/index.html` (after T004).
- [x] T008 Compose login-free English FE app shell in `FE/src/App.tsx` (after T007; mount routes incrementally as pages arrive).
- [x] T009 Create frontend React bootstrap in `FE/src/main.tsx` (after T007; initial app shell is a valid import).
- [x] T010 Configure frontend unit-test environment in `FE/src/setupTests.ts` (after T004).
- [x] T011 Exclude credentials, data, conversions and runtime artifacts in `BE/.gitignore`.
- [x] T012 Exclude credentials, local fixtures and build artifacts in `FE/.gitignore`.
- [x] T013 Define explicit local PostgreSQL/config validation in `BE/src/config/settings.ts` (no production defaults).
- [x] T014 Implement tracked SQL migration runner in `BE/scripts/migrate.ts` (after T013).
- [x] T015 Configure isolated test database lifecycle in `BE/tests/setup.ts` (after T014; refuse non-test DB targets).
- [x] T016 Publish versioned HTTP schemas/options/error format in `BE/docs/api-contract.md`.
- [x] T017 Implement typed local HTTP client in `FE/src/services/api.ts` (after T016; no login/cloud fallback; revision and structured error support).
- [x] T018 Verify local HTTP write guards and SPA/API separation in `BE/tests/app.test.ts` (pair with T019).
- [x] T019 Compose local-only Express app shell, origin/Host write guards and configurable production frontend serving in `BE/src/app.ts` (pair with T018; mount routes incrementally as implemented).
- [x] T020 Implement Windows startup and explicit loopback binding in `BE/src/server.ts` (after T019; add interrupted-job recovery with turn-service phase).

Checkpoint: `BE npm run build`, `FE npm run build`, both `npm run lint`; empty test suites allowed only during scaffolding. A production FE build uses a relative local API URL.

### US1 — Campaigns and source imports

- [x] T021 [US1] Create PostgreSQL campaign/character/source/page schema in `BE/migrationssql/0001_campaigns.sql` (context/entity/notes revisions; confirmed source versions).
- [x] T022 [US1] Specify campaign lifecycle/restart isolation in `BE/tests/campaignService.test.ts` (pair with T023).
- [x] T023 [US1] Implement campaign/character persistence service in `BE/src/services/campaignService.ts` (after T021; pair with T022).
- [x] T024 [US1] Expose campaign/character CRUD routes in `BE/src/routes/campaigns.ts` (after T023; no business logic).
- [x] T025 [US1] Pin minimal local conversion dependencies in `BE/python/requirements.txt`.
- [x] T026 [US1] Specify text/mixed/scanned PDF extraction and failure cases in `BE/python/tests/test_convert_document.py` (pair with T027; synthetic fixtures).
- [x] T027 [US1] Implement page-aware MarkItDown/PDFium/Tesseract conversion in `BE/python/convert_document.py` (after T025; pair with T026; retain confidence/warnings for accepted review step).
- [x] T028 [US1] Specify size/time/output limits and invalid imports in `BE/tests/sourceService.test.ts` (pair with T029).
- [x] T029 [US1] Implement bounded text/file/Google Docs imports and isolated converter launch in `BE/src/services/sourceService.ts` (pair with T028; 20 MiB/upload, 300 PDF pages, 120 s extraction, 10 MiB extracted text; confirmed corrections are indexed; no arbitrary filesystem-path input).
- [x] T030 [US1] Expose extraction/preview/save endpoints in `BE/src/routes/sources.ts` (after T029).
- [x] T031 [US1] Add English dark journal theme in `FE/src/theme/theme.ts`.
- [x] T032 [US1] Implement campaign library with empty/error/reopen states in `FE/src/pages/CampaignLibrary.tsx` (after T024).
- [x] T033 [US1] Implement source extraction preview/correction in `FE/src/features/sources/SourcePreview.tsx` (after T030).
- [x] T034 [US1] Implement campaign/character setup in `FE/src/pages/CampaignSetup.tsx` (after T033).
- [x] T035 [US1] Verify runnable setup/reopen/import preview in `FE/tests/campaignSetup.spec.ts` (after T034; manual sheets, no AI parsing dependency).

Checkpoint: both repo build/lint/tests; `BE python -m unittest discover -s python/tests`; FE campaign-setup e2e. Native, mixed and scanned synthetic PDFs all retain page references; empty extraction is an error, not success.

### US2 — CLI providers and canonical turns

- [x] T036 [US2] Create durable job/turn/snapshot/memory schema in `BE/migrationssql/0002_turns.sql` (unique campaign/request ID, one active campaign turn, ownership/lease and exact memory coverage).
- [x] T037 [US2] Specify fresh-session isolation, cancellation, bounded output and safe Windows prompt launch in `BE/tests/processRunner.test.ts` (pair with T038).
- [x] T038 [US2] Implement isolated CLI process runner in `BE/src/providers/processRunner.ts` (pair with T037).
- [x] T039 [US2] Specify Claude machine-output/schema/login failure fixtures in `BE/tests/claudeAdapter.test.ts` (pair with T040).
- [x] T040 [US2] Implement official subscription-preserving Claude adapter in `BE/src/providers/claudeAdapter.ts` (pair with T039).
- [x] T041 [US2] Specify Codex JSONL/schema/model-effort fixtures in `BE/tests/codexAdapter.test.ts` (pair with T042).
- [x] T042 [US2] Implement Codex adapter in `BE/src/providers/codexAdapter.ts` (pair with T041).
- [x] T043 [US2] Specify Antigravity headless/schema/login failure fixtures in `BE/tests/antigravityAdapter.test.ts` (pair with T044).
- [x] T044 [US2] Implement `agy` adapter in `BE/src/providers/antigravityAdapter.ts` (pair with T043).
- [x] T045 [US2] Serve discovered availability and supported model/effort catalogs in `BE/src/services/providerService.ts` (after T040/T042/T044).
- [x] T046 [US2] Define versioned allowed turn operations and character-draft schema in `BE/src/domain/responseSchemas.ts` (after T016; no authoritative memory field).
- [x] T047 [US2] Specify all-or-nothing state changes, expected values and cross-campaign ID rejection in `BE/tests/stateApplication.test.ts` (pair with T048).
- [x] T048 [US2] Implement validated operations, assigned new IDs, change list and before-images in `BE/src/domain/stateApplication.ts` (after T046; pair with T047).
- [x] T049 [US2] Specify final prompt accounting, mandatory overflow, immutable manifest, bounded history and current-version source retrieval in `BE/tests/contextBuilder.test.ts` (pair with T050).
- [x] T050 [US2] Implement canonical bounded context and PostgreSQL text retrieval in `BE/src/domain/contextBuilder.ts` (pair with T049; gameplay ceiling 16,000 tokens; no hidden resume or silent uncovered-history loss).
- [x] T051 [US2] Specify captured settings/context, request-ID payload conflicts, database races, cancellation-vs-commit, provider failure and restart recovery in `BE/tests/turnService.test.ts` (pair with T052).
- [x] T052 [US2] Implement durable turn execution with immutable context and short locked atomic commits in `BE/src/services/turnService.ts` (after T036/T045/T050/T048; pair with T051; integrate interrupted recovery in startup).
- [x] T053 [US2] Expose turn status/events/cancel and provider options in `BE/src/routes/turns.ts` (after T052).
- [x] T054 [US2] Implement provider/model/effort selector from served options in `FE/src/features/providers/ProviderPicker.tsx` (after T045).
- [x] T055 [US2] Specify bounded AI-assisted sheet parsing and confirm-before-save in `BE/tests/characterDraftService.test.ts` (pair with T056).
- [x] T056 [US2] Implement approved-source-to-draft parsing in `BE/src/services/characterDraftService.ts` (after T045/T050/T046; pair with T055).
- [x] T057 [US2] Expose explicit character-draft parsing in `BE/src/routes/characterDrafts.ts` (after T056).
- [x] T058 [US2] Add parsed-character confirmation UI in `FE/src/features/characters/CharacterDraft.tsx` (after T057; integrate into setup).

Checkpoint: both repo build/lint/tests; runner fixture tests include all three adapters. A separately authorized real-turn smoke test per adapter confirms account/model availability; help output alone is insufficient.

### US3 — Reversible play and journal

- [x] T059 [US3] Specify before-image restoration, manual edit conflicts, active-job rejection and checkpoint invalidation in `BE/tests/undoService.test.ts` (pair with T060).
- [x] T060 [US3] Implement locked latest-turn undo restoring state and invalidating affected memory in `BE/src/services/undoService.ts` (after T052; pair with T059; exclude undone turns from prompt history).
- [x] T061 [US3] Expose latest-turn undo in `BE/src/routes/undo.ts` (after T060).
- [x] T062 [US3] Specify 8,000-token compaction input, 2,000-token memory, batch coverage, revision races, overflow/failure and undo interaction in `BE/tests/memoryService.test.ts` (pair with T063).
- [x] T063 [US3] Implement serialized bounded checkpoint updates in `BE/src/services/memoryService.ts` (after T052/T060; pair with T062; integrate pre-turn threshold gate into turn service).
- [x] T064 [US3] Implement persisted context budgets, pinned facts/source sections and confirmed manual memory checkpoint service in `BE/src/services/contextSettingsService.ts` (after T063; validate coverage/revision; mount settings endpoints).
- [x] T065 [US3] Implement inspectable budgets, pinned context and explicit manual-memory coverage confirmation in `FE/src/features/journal/ContextSettings.tsx` (after T064; no silent source/history omissions).
- [x] T066 [US3] Implement request identity/revision guards and draft-preserving turn state in `FE/src/features/play/useTurn.ts` (after T053/T061).
- [x] T067 [US3] Implement readable flexible sheets with Advanced JSON editing in `FE/src/features/characters/CharacterSheet.tsx` (after T024).
- [x] T068 [US3] Implement inspectable campaign memory/player notes in `FE/src/features/journal/Journal.tsx` (after T063).
- [x] T069 [US3] Implement dark journal play layout, composer, state-change list and undo in `FE/src/pages/Play.tsx` (after T054/T066/T067/T068).
- [x] T070 [US3] Verify switching/cancellation/retry/undo and draft retention in `FE/tests/play.spec.ts` (after T069; synthetic provider backend).
- [x] T071 [US3] Verify 1,000-turn synthetic campaigns, repeated compaction/provider switches, pinned-fact retention, prompt ceilings and undo invalidation in `BE/tests/longCampaign.test.ts` (after T063/T064; inspect every recorded gameplay/compaction request).

Checkpoint: both repo build/lint/tests and FE e2e. Undo restores an existing NPC/player mutation, newly introduced NPC, inventory, memory and auxiliary state exactly; partial/cancelled/stale output never becomes canonical state.

### US4 — Templates and portable saves

- [x] T072 [US4] Create local template schema in `BE/migrationssql/0003_templates.sql`.
- [x] T073 [US4] Specify reusable campaign/character template behavior in `BE/tests/templateService.test.ts` (pair with T074).
- [x] T074 [US4] Implement template storage/instantiation in `BE/src/services/templateService.ts` (after T072; pair with T073).
- [x] T075 [US4] Specify consistent exports, all structured-reference remapping, preserved undo, unavailable providers and malformed-archive rejection in `BE/tests/archiveService.test.ts` (pair with T076).
- [x] T076 [US4] Implement versioned atomic campaign export/import in `BE/src/services/archiveService.ts` (after T063/T074; pair with T075; no active jobs, original binary requirement, credentials or local paths).
- [x] T077 [US4] Expose template/archive routes in `BE/src/routes/library.ts` (after T074/T076).
- [x] T078 [US4] Add template picker in `FE/src/features/templates/TemplatePicker.tsx` (after T077).
- [x] T079 [US4] Add campaign import/export controls in `FE/src/features/archives/ArchiveControls.tsx` (after T077).

Checkpoint: both repo build/lint/tests; export/import round trip preserves active state and advertised undo, while omitting credentials, active jobs and machine-specific configuration.

### Packaging and public release gate

- [x] T080 Document backend-specific PostgreSQL/Python/OCR/CLI configuration in `BE/README.md` (after T020).
- [x] T081 Document English frontend setup, local production serving and API compatibility in `FE/README.md` (after T008).
- [x] T082 Document one-clone Windows prerequisite/install/dev/build/start workflow in `README.md` (after T080/T081; retain app-specific docs).
- [x] T083 Record clean-install/backend source/history secret scan in `BE/docs/release-checklist.md` (after T080; scanner findings resolved, values omitted).
- [x] T084 Record frontend bundle/source/history secret scan and Windows smoke results in `FE/docs/release-checklist.md` (after T081).

Final checkpoint: both builds/lints/tests, Python extraction tests, FE e2e, isolated Windows real CLI smoke tests, clean-install run, zero unresolved credential findings. Verify no login/user, adventure/map generator or cloud API client remains. No GitHub publication is part of this planning request.

Dependency note: foundation includes executable app shells, test DB isolation and the local API client. Feature route/page tasks include mounting their route into those shells; initial manual character setup has no CLI dependency. Frontend e2e configuration and synthetic conversion/provider fixtures are part of their corresponding test task. Nonempty unit/integration suites are required from US1 onward. Builds must cover actual source files, not an empty TypeScript project. Each feature phase is runnable before packaging documentation.

## Verification targets

Proposed new tooling: backend/frontend `npm run build`, `npm run lint`, `npm test`, frontend `npm run test:e2e`. These are requirements for future scripts, not claims that they currently exist. Unit/integration fixtures must exercise actual state restoration and provider boundary behavior, not merely mirror functions. At least one approved real turn per shipped adapter is needed to confirm subscription transport works end to end.

A future release is complete only when it can create a campaign without application accounts, import all confirmed source types including scanned PDFs, play through each supported CLI, change valid models/efforts through the UI while preserving campaign context, reopen saved PostgreSQL state, show automatic changes and undo a state-mutating turn correctly, play from a phone browser on the same LAN, and pass the new-repository secret audit. Public internet hosting and legacy import are excluded. Phone voice/HTTPS is conditional on confirming the audio addition.

## Review

Four core user stories and 84 dependency-ordered core tasks cover the scope after review and the monorepo decision. One repository with separate backend/frontend apps, fresh campaigns on a Windows host, PostgreSQL, flexible gameplay, shared CLI context, bounded recent history + memory + retrieved rules, all requested source types including scans, accepted extraction review/correction, automatic reversible changes, English UI, templates/archives and dark-journal direction are settled. Subsequent LAN extension tasks follow below; audio remains exploratory. Release license/destination is explicitly deferred, not assumed. No application code has been changed or tested; this is a planning audit.

Self-check: each story maps to a task phase; provider execution precedes canonical state application; retrieval/compaction preserves source and covered-turn boundaries; undo and export include snapshots; source secrets/history are excluded before new repository creation. Remaining implementation feasibility gates are live CLI behavior, OCR quality on representative documents, and supported model/effort catalogs. They require isolated validation during implementation, not further product decisions.

### Review round — 2026-09-30

Findings below are confirmed contradictions/missing contracts in the prior plan, not claims about implemented new code. All were corrected in this document.

| ID | Priority | Prior gap | Correction and verification |
|---|---|---|---|
| R01 | High | App-owned context did not explicitly prohibit reused CLI sessions or injected CLI memory. | Fresh isolated session for every AI call; unavailable isolation disables adapter. Runner/adapter tests assert no resume/session reuse or extra workspace context. |
| R02 | High | Model-aware budget and compaction threshold had no limits; summarization could itself recreate an overloaded session. | Explicit input/memory ceilings, final-request accounting, bounded consecutive compaction, mandatory-overflow failure and manual-checkpoint recovery. Long-campaign test records every prompt. |
| R03 | High | Revision could be checked before write, and live prompt reads could mix different state versions. | Immutable consistent context manifest and atomic lock/revision compare at commit. Test manual edits during generation. |
| R04 | High | Undo restored a prior memory pointer but did not invalidate later summaries or remove undone events from future context. | Invalidate all covering checkpoints, exclude inactive turns, restore touched state with manual-conflict protection. Test compaction followed by undo and another turn. |
| R05 | High | One active turn, retry and cancellation were described without persistent race semantics. | Database-backed uniqueness/lease, payload-bound request IDs, cancel-vs-commit transition and interrupted restart state. Test simultaneous requests and late outputs. |
| R06 | High | Foundation lacked runnable entries/test infrastructure; phase e2e preceded app routing; setup implicitly depended on unbuilt CLI parsing. | Move runtime shells/client/test setup into foundation; initial manual setup, later explicit AI-draft path; add missing setup e2e. |
| R07 | Medium | No task owned AI character parsing, correction reindexing, or editable budget/pinned-memory controls. | Add bounded draft parsing/confirmation and context-settings tasks; index confirmed corrected source versions. |
| R08 | Medium | Archive remapping omitted nested snapshots/manifests/memory references and could capture an active turn. | Consistent idle exports, schema-owned reference remapping, preserved undo and unavailable-provider reselection; round-trip tests. |
| R09 | Medium | Relative production API had no concrete local build-serving contract; CORS/loopback alone did not specify write guards. | Configured FE build serving, API precedence, dev proxy and Host/Origin/content-type/header guards verified at foundation; subsequently aligned with the monorepo decision. |
| R10 | Medium | Text still described phone access, source scope and template/archive scope as unresolved despite answered questions. | Remove stale open decisions and align entities/endpoints/acceptance/tasks with the selected scope. |

Plan verification: unique sequential task IDs, existing task references and no forward `after` dependencies; test/implementation pairs remain adjacent. No application builds, provider calls, OCR runs or database operations were performed. Context ceilings reduce overload risk; they do not establish narrative truth or guarantee no hallucinations.

## Voice input feasibility — exploratory, not yet a v1 requirement

User asked whether their audio input could lead to text output in the chat using the CLIs, and subsequently asked for click-to-read GM messages. Proposed interaction includes dictation and optional read-aloud of existing text. No microphone access, audio recording or model call was performed.

Claude Code documents terminal dictation using Claude.ai login, with transcription on Anthropic servers. Antigravity documents `/voice` terminal dictation but explicitly disables it in noninteractive print mode. The installed headless help does not establish a general audio-file input contract. Codex upstream protocol exposes experimental realtime methods; headless `exec` help inspected here does not offer a direct audio-input flag. A browser integration through the official local Codex app-server is a separate feasibility spike, not a verified portable transcription adapter.

Recommended provider-independent interaction: microphone button -> short recording -> transcription -> editable composer text -> explicit Send -> existing bounded GM turn -> text reply. Transcription receives audio/language/name hints, not campaign history, and cannot modify game state. Gameplay can use any selected CLI regardless of how transcription is supplied. Record only while visibly requested; discard cancelled/processed audio by default. A candidate key-free alternative is local Faster-Whisper, with model download/runtime/performance verified on Windows before selection. Do not extract CLI login tokens or call internal transcription endpoints as a shortcut.

Cost clarification: locally installed Faster-Whisper transcribes with downloaded model weights using the computer's CPU/GPU; no API credential, external token allowance or per-request transcription bill is needed. The hosted Whisper/transcription API is a different paid service and is not the proposed default. Local transcription avoids a separate cloud transcription charge, but the confirmed transcript still consumes ordinary GM input context exactly like typed text; it does not reduce those GM tokens for an identical message.

Proposed GM read-aloud: speaker button on committed GM messages, with pause/resume/stop, voice and speed selection. Speak the existing narrative text; never ask the GM to generate it again, and do not include JSON/change diagnostics by default. Prefer browser SpeechSynthesis voices reporting localService=true, verify local operation on supported Windows browsers, and report unavailable voices rather than silently choosing an online service. A Windows installed-voice adapter is a fallback if browser support is insufficient. Local voices consume no AI subscription tokens/API keys; voice quality varies. Cancel playback on explicit Stop, message undo/deletion, and leaving the campaign; don't auto-play new responses. Sources: https://webaudio.github.io/web-speech-api/ ; https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.getinstalledvoices .

Audio inclusion, transcription provider (official CLI integration vs local engine), supported spoken languages and recording limits remain undecided. These do not block the already settled text-first game plan. Sources: https://code.claude.com/docs/en/voice-dictation ; https://www.antigravity.google/docs/cli/commands/voice/ ; https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs ; https://github.com/SYSTRAN/faster-whisper .

## LAN extension tasks — after core delivery

US5 — On the same Wi-Fi, open the running Windows host's game in a phone browser and continue the same saved campaign. No game CLI/database runs on the phone. Preserve one active campaign turn and stale-result guards across desktop and phone tabs.

- [x] T085 [US5] Specify opt-in LAN binding, approved origins/hosts and proposed device pairing/revocation in `BE/tests/lanAccess.test.ts` (pair with T086; pairing UX confirmed before implementation).
- [x] T086 [US5] Implement LAN access boundary in `BE/src/services/lanAccessService.ts` (pair with T085; integrate listener/middleware; database and CLI control stay loopback-only).
- [x] T087 [US5] Implement desktop LAN connection settings and phone connection flow in `FE/src/features/connections/LanConnection.tsx` (after T086).
- [x] T088 [US5] Verify desktop/phone-tab continuation, duplicate submission and unauthorized LAN requests in `FE/tests/lanPlay.spec.ts` (after T087; synthetic providers).
- [x] T089 [US5] Document LAN URL, Windows Private-network firewall, awake-host and guest-Wi-Fi limitations in `docs/lan-setup.md` (after T088; no public port-forwarding instructions).

Checkpoint: core checks plus LAN access tests; perform actual phone-browser typing/reload/reconnect validation on the user's selected OS/browser. Microphone and GM playback require their separate confirmed audio scope and HTTPS/voice testing. Total core + LAN tasks: 89.


## Implementation reconciliation — 2026-10-01

Task checkboxes refer to delivered behavior, not the original illustrative filenames. Persistence lives in `BE/src/store.ts`; HTTP routes compose in `BE/src/app.ts` with CampaignService, SourceLibrary, LibraryService and TurnService. Domain schemas/context/state are separate. SQL migrations are `0001_local.sql` and `0002_source_artifacts.sql`; the first migration contains core campaign, turn, memory and template tables. Frontend tests/bootstrap/theme use the actual Vite/React layout; TypeScript directly includes source/tests instead of project references, so its no-emit check is substantive. Plain React/CSS supplies the dark journal; no MUI runtime was required.

T040/T042/T044 include explicit unsupported-adapter handling from the original provider policy. Antigravity 1.2.14 is live-verified using fresh no-tools global definitions. Codex 0.159.2 now supports equivalent empty-tool isolation using sanitized metadata, fresh homes and CLI-owned native auth hardlinks; actual anonymous-loopback protocol tests passed without a model call; Claude has implementation/fixture coverage and required-flag gating, but no live claim. Antigravity discovers its own model families and effort variants; Claude derives its model aliases and effort choices from installed help when no administrator catalog overrides them. Codex model/effort choices come from current local account metadata; automatic delegation efforts are excluded and other CLI versions fail closed. The exact supported version/hook guard is intentional, documented behavior rather than a silent fallback.

The unit 1000-turn context check is supplemented by `BE/tests/longCampaign.database.test.ts`: 1000 actual PostgreSQL-backed TurnService turns, 142 automatic compactions, provider/model/effort switches, every request ceiling checked, and undo/checkpoint invalidation. Simultaneous same-ID and competing-ID request races have a separate regression. All slow conversion/CLI work stays outside database transactions.

Additional delivered work:

- [x] T090 Local PDF/OCR and Faster-Whisper runtime installation instructions, dependency lock and explicit one-time model downloader; native/mixed/scanned/Portuguese/blank real fixtures.
- [x] T091 Dictation to editable composer with zero automatic GM submissions; click-to-read installed local voice; real Windows Chrome runtime checks.
- [x] T092 MIT license, selected by owner; Android Chrome-specific device setup/checklist.
- [x] T093 Antigravity canary, synthetic tool-denial, grouped model/effort, real narrative/memory generation and PostgreSQL state/undo checks.
- [x] T094 Fresh-source/lockfile installation and public-source/built-bundle/history scan tooling; evidence recorded in completion review.

Physical Android certificate installation, microphone permission and installed voice availability require that device and remain explicit setup validation steps. macOS/Linux are unverified. Publishing on GitHub is outside the authorized work. These are not represented as completed live checks.
