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
