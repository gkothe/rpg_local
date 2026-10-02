# Frontend implementation — 2026-10-01

Implemented campaign library/create/delete, metadata/instructions edit, readable player/NPC sheets with Advanced JSON/manual create/delete, confirmed-source character parsing preview, text/Markdown/PDF/Google Docs source review/correction, backend capability provider/model/effort controls, committed chat, visible change lists, cancellation/undo, personal notes, campaign memory, facts/source pins, context budgets/manifest inspection, explicit manual memory checkpoint, templates and versioned archive import/export.

One deliberately dark earth journal theme: serif narrative, sage/ochre accents, folio turn margin, subtle grain and rounded panels. English interface; one-field rows and 44px controls on phones. Domain option sets/defaults/flags come from backend settings; client-only workflow states are separate. All requests are relative local API calls. Imported content is text. No shipped synthetic AI fallback.

Async controls preserve composer and character/journal drafts. Synchronous turn submit guards prevent double submission; uncertain transport retains the original request payload/ID and blocks a changed action until resolved. Fresh campaign routes remount draft state. Read polling is sequential and stale campaign acknowledgements are ignored. Character/journal/source previews save original revisions rather than borrowing newer state revisions.

Audio: explicit microphone recording/transcription into editable composer, cancellation/track cleanup, MIME selection and diagnostics/typing fallback. Browser local-voice-only read-aloud with pause/resume/stop/voice/speed; shared playback state and cancellation on message removal/campaign exit. Real installed Windows Chrome voice playback and local Faster-Whisper transcription were tested with synthetic speech. No personal microphone recording or live AI request was used.

Desktop LAN settings issue single-use connection codes and revoke paired devices. Phone pairing uses a native keyboard-focused modal, keeps the background inert, and preserves mounted drafts across revocation/reconnect. Confirmed source sections can be inspected/pinned independently, original retained documents open through the protected same-origin API, and original extraction pages/confidence remain inspectable. Standalone character templates can be saved, instantiated and deleted. Parsed/new-character drafts capture their original campaign revision; Advanced sheet JSON cannot override identity or revision fields.

## Evidence

- React/Vite production build covers real app source. ESLint10 classic hooks/refresh checks, strict TypeScript and shared Prettier formatting are configured; root owns installation/lockfile.
- Synthetic unit tests cover API envelope/headers/conflicts, option switching/unsupported settings, JSON sheet validation, recording rapid-start/late-stream cleanup, turn single-flight, uncertain identical retry, stale response disposal and retained draft revision.
- Synthetic installed-Chrome browser tests cover create setup, async turn/draft preservation/state changes/undo, and no horizontal overflow at320/375/768/1024/1280/1440/1920/2560px. Desktop/mobile screenshots were visually inspected; generated images live in ignored test-results.
- Real browser→HTTP→isolated PostgreSQL smoke passed: create, manual character, pasted source draft/correction/confirmation, personal-note persistence after reload, template, export/import to a new campaign ID retaining note/character, cleanup. No AI called and test records were removed.

Final verification: `npm run build`, `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm test`, each with `--workspace rpg-fe-local`, passed; lint reported zero warnings and the unit suite passed 15 tests. The production build contains approximately 317.32KB JS / 9.32KB CSS before gzip. `npm run test:e2e --workspace rpg-fe-local` passed seven synthetic installed-Chrome scenarios, including source-section pinning, extraction preview/correction and keyboard-focused pairing. Four real-runtime scenarios are separately opted in; normal browser runs skip them.

Separate production-runtime checks passed on the explicitly isolated PostgreSQL fixture, using installed Windows Chrome:

- `local-database.spec.ts`: campaign/character creation, standalone character template save/instantiate/delete, source correction/confirmation, notes after reload, campaign template and archive round trip (3.1 seconds). Dedicated records were removed.
- `production-lan.spec.ts`: direct approved NIC HTTPS origin, one-use pairing, HttpOnly/Secure cookie, revoke/re-pair preserving the unsent composer, saved notes after reload and same-origin requests (1.9 seconds). Test certificate errors were ignored only in its browser contexts; no operating-system trust or firewall change.
- `local-dictation.spec.ts`: synthetic WAV as Chrome's fake microphone, real MediaRecorder upload, actual local Faster-Whisper, editable recognized text, zero GM requests and campaign cleanup (13.9 seconds).
- `local-voice.spec.ts`: installed Microsoft George local voice completed playback of synthetic GM text, with no AI request or personal microphone (4.6 seconds).

## Validation gates

Real CLI gameplay and long-campaign behavior are root/backend validation responsibilities. Root also coordinates the final public source/bundle/history audit and clean installation. Actual Android Chrome microphone permission, installed offline voice availability and trusted-certificate setup need physical-device verification. Windows Chrome tests do not establish these Android behaviors. LAN UI does not provision certificates, tunnels or firewall changes. No GitHub publication performed.

Primary integration completion: installed-Chrome live Antigravity browser test passed in 25.4 seconds with persisted state, Gemini 3.8 to 3.7 switching carrying canonical context, and two full undos preserving private notes. Provider settings now show save feedback. See root docs/reviews/completion.md for final source/bundle audit, installation and physical-device limits.

## User-reported setup corrections (2026-10-01)

New campaign setup now explains the second source-import step and opens Sources immediately after
creation. The expanded import controls expose pasted text, multiple Markdown/text/PDF files and
public Google Docs links. File batches run sequentially with the revision returned by each successful
upload. A failure stops the batch, preserves earlier saved drafts and retains the failed/later files;
the campaign refreshes so the user can inspect saved sources before retrying an uncertain request.
Leaving the campaign prevents later batch uploads. Imports remain unconfirmed drafts.

Provider controls explain that a CLI selection unlocks models/effort, display unavailable diagnostics
beside the selectors, and offer a guarded diagnostic refresh. Unsupported providers cannot edit model
or effort settings. Models without effort options explicitly report their default behavior.

Verification: frontend unit suite passed 20 tests including sequential returned-revision uploads,
partial failure/retained files, navigation stopping the batch, visible import controls and unavailable
provider controls. Typecheck, zero-warning lint and formatting passed. Seven synthetic installed
Windows Chrome scenarios passed, including creation opening visible source-import controls; five
live-runtime tests were deliberately skipped in this regression run.

Provider refresh in Setup, Play and Settings explicitly requests `/providers?refresh=true` to
bypass the backend diagnostic cache. Settings refresh runs providers and runtime settings
sequentially with a synchronous guard. Three page-level regression checks verify the actual
cache-bypassing request; the expanded frontend suite passes 23 tests.

In-game provider selection is labeled Game master and explains that changes take effect next turn.
A regression test switches an existing campaign between providers, preserves its unsent action and
prior narrative, and verifies the next turn uses the updated settings and campaign revision. Settings
and selectors distinguish a missing executable from an installed adapter whose gameplay is disabled.
The frontend suite passes 24 tests; seven synthetic installed-Chrome scenarios pass. The dictation
notice now points to the reusable setup-voice.cmd launcher instead of repeating typing instructions.

## Rules library (2026-10-01)

Added Rules navigation, system list/create/detail, bounded tree/search/direct-text browsing, book preview/publication and revision-owned GM instructions. Default systems expose instructions only. Browser results preserve literal Unicode and distinguish exact/approximate/unknown pages. Stale publication and uncertain responses preserve drafts and confirmation identities; whole private books are not fetched for browsing.

Setup and Play consume backend-owned selectable/default options. Selection changes apply to the next action, preserve the composer and disclose latest behavior. Imported missing-library references stay visibly unresolved and Send remains blocked until explicit resolution/default choice. Book Send gating requires the served provider/model/effort rule capability. Terminal evidence shows saved original quotes, source/page/hash/revision, failed/undone audit labels and a warning when current nodes differ. Expansion loads bounded saved receipts. Private backup download/preview/explicit replacement/restore is separate from reference-only campaign export.

Verification: 35 frontend unit tests passed across 10 files, including browsing/locators/stale cursor, safe rendering, instruction/publish drafts, backend options, private replacement and replay after uncertain failure. Synthetic Windows Chrome acceptance includes a real disposable-PG book import, publication, instructions, campaign selection, reference-only export, unresolved import and explicit default recovery with preserved composer. A separate original synthetic browser scenario verifies expandable literal citations, current-head mismatch warning and draft retention without calling AI. Existing dice/source/setup/LAN/draft/undo/layout regression scenarios also passed. Header wrapping and long evidence strings were adjusted after Chrome exposed narrow-width overflow. Final suite totals appear in ../docs/plans/rules-library.md.

Typecheck, zero-warning lint, formatting and production build passed. Live native gameplay evidence is owned by the backend capability report; frontend fixture passes do not certify a provider. Five unrelated opt-in browser checks (actual Antigravity selector, additional real database flow, local voice, production LAN and local dictation) were skipped explicitly in the standard browser run. No Android/macOS/Linux acceptance is claimed. Exact evidenced Windows book choices now include Claude2.1.232/sonnet/medium, Codex0.159.2/gpt-5.6-sol/medium and Antigravity1.2.14/gemini-3.8-flash/low or medium. Antigravity native full campaign validation passed independently; the skipped browser selector is not represented as a pass. Fresh Claude validation is a user-deferred TODO until weekly quota availability. T001 owner confirmation remains after successful read-only actual-package validation. The latest Chrome run passed10/15 with5 explicit opt-in skips against a fresh isolated browser database.

All gameplay CLIs use one continuous native tool loop within a bounded logical action. Backend revision/search caches preserve authoritative-head/ownership checks and fresh persisted evidence; no frontend audit receipt or stale tree is reused as current rule authority. Providers consume the canonical registry generically, with default dice-only/book five-tool purpose sets. Measured telemetry and practical cross-action warm-process limitations are documented in ../docs/reviews/rules-library-native-mcp.md.

## Setup document imports (2026-10-02)

Campaign creation now offers multiple campaign files and a separate character-sheet file, public Google Docs links for both, and backend-provided OCR languages. Extraction stays sequential and review remains explicit. Partial failures retain the saved campaign link and prevent duplicate creation. Character sources are confirmed in Sources, then parsed and approved in Characters.

Verified: frontend lint, typecheck, formatting check, build, 40 unit tests and 5 targeted browser tests (installed Windows Chrome via LOCAL_BROWSER_PATH). No live OCR/CLI calls in these synthetic checks. Details: ../docs/reviews/setup-document-imports.md.

## CLI compatibility warnings (2026-10-02)

Provider selection during setup/gameplay and Settings display the backend compatibilityWarning without disabling selection. Existing failed-turn errors remain visible. Root lint/typecheck/build passed; 41 frontend tests and 5 targeted Windows Chrome browser tests passed. CLI version warnings were included in browser selection coverage.

## Campaign tabs and direct text imports (2026-10-02)

Moved system rules and CLI/model/effort controls into Game master campaign tab. Hidden panels remain mounted; unsent actions survive switching tabs/providers. Confirmed source rows offer View / edit text, and setup explains that Markdown/text files need no extra review. Verified root lint/typecheck/build, 41 frontend unit tests and 6 targeted Windows Chrome browser tests. Gated live rules/Antigravity tests updated but not executed. See ../docs/reviews/campaign-tabs-and-text-imports.md.

## Optional review and separate Add source view (2026-10-02)

All imports are immediately usable, including PDFs and Google Docs; review/editor UI remains optional. Sources list offers Add source, opening a separate import view with Back to sources and preserved unfinished inputs. Game master settings remain in the new tab. Verified 41 frontend tests and 7 targeted Windows Chrome browser tests; root lint/typecheck/build passed. See ../docs/reviews/campaign-tabs-and-text-imports.md.

## Automatic setup player character (2026-10-02)

Dedicated character file or Google Docs link is imported, parsed by the selected CLI via existing validated character-drafts API, and saved automatically as the backend default player role. Setup rejects conflicting character inputs and requires a CLI/model for automatic parsing. Campaign/source remain saved on parser failure, and navigation stops later steps. Manual additional-character parsing/editing remains available. Verified frontend lint/typecheck/build and five targeted Windows Chrome browser tests; automatic-character boundaries were mocked and no live AI quota was consumed. See ../docs/reviews/automatic-setup-character.md.

## Flexible character text formats (2026-10-02)

Setup and Add source file pickers accept JSON, YAML, CSV and other UTF-8 text as well as Markdown/text/PDF. Removed extension-only rejection; backend validates text versus binary content. Parser failure no longer asks users to shorten ordinary dossiers; adaptive parsing stays on the backend. Five targeted browser tests and 45 frontend unit tests passed. Actual Antigravity recovered the user's saved Sigurd import without another upload.

## Character, NPC and chat design (2026-10-02)

Adapted the original frontend's separate sheet sections, collapsible NPC list and left/right chat bubbles to the journal theme. Added NPCs campaign tab, recursive readable sheet values, character notes, bounded chat scrolling and message timestamps. Mounted editors preserve drafts across category changes. Verified 46 frontend unit tests, six targeted Windows Chrome browser tests, frontend ESLint/TypeScript/build and a desktop screenshot. See ../docs/reviews/legacy-character-chat-design.md.

## Section view/edit switching (2026-10-02)

Each player/NPC sheet section switches between formatted data and its own JSON editor. Save sends only that section and returns to read mode; View preserves unfinished edits, and Reload current section discards them explicitly. Draft revisions remain fixed through refreshes; errors leave the editor open. Name/notes saves no longer send unrelated sheet fields. Verified 48 frontend unit tests, six targeted Windows Chrome tests and frontend lint/format/build. See ../docs/reviews/legacy-character-chat-design.md.

## Book effort selection (2026-10-02)

Removed book effort readiness gate and always offer Default in the picker. High and Default browser checks passed with former Medium-only metadata. 48 unit tests and six targeted Chrome tests passed; root lint/build passed. See ../docs/reviews/book-effort-selection.md.

## GM processing indicator (2026-10-02)

Pending/submitting GM requests show a circular loading animation in the processing status and Send button, labelled "GM is responding...". Cancel remains available and the next-action draft remains editable. Verified 49 frontend unit tests and seven Windows Chrome play tests, including visible animated spinner and cancellation access.
