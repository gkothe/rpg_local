Primary integration completion: Antigravity 1.2.14 now passes real minimal-agent, tool-denial canary, grouped model/effort, narrative/memory and PostgreSQL undo checks. Installed Chrome real provider-to-turn-to-model-switch-to-undo workflow passed 25.4 seconds. Configured combined run passed 28 backend and 15 frontend cases; the 1000-turn SQL suite separately passed. See root docs/reviews/completion.md for fresh installation, public audit and explicit limits.

CLI discovery correction: Windows native npm Claude, legacy Claude JS and Codex desktop/npm installations now resolve without executing shell wrappers. Actual installed Claude/Codex help commands passed; Codex also resolved without PATH injection. Four new regression cases passed; installed Claude help now supplies aliases/effort choices with runtime entitlement validation and conservative budgets; backend typecheck/lint passed and default tests passed 22 with 11 fixture-dependent skips. See docs/cli-discovery.md for supported locations and remaining model/isolation requirements. No model calls were made during this correction.

Windows dictation setup: `setup-voice.cmd` creates the off-repository Python runtime/model and saves its paths in the current account's LocalAppData. `start.cmd` loads those paths while preserving explicit environment overrides and separate database settings. Verified existing-runtime offline setup and repeat setup, actual CPU/int8 transcription of a non-private fixture, compiled backend `audioDiagnostics()` returning `available: true`, PowerShell parsing, environment override precedence, and clear missing-runtime failure without an install/download. The current user's existing verified runtime is now saved; their running backend must restart to load it. New-runtime internet installation was not repeated in this check. Device microphone permissions and Android trusted HTTPS remain browser/device checks. See `docs/local-runtime.md` for the reusable workflow.

Voice setup was also verified through an isolated running backend: GET settings reported
`audio.available: true`, and POST audio/transcriptions returned the expected local synthetic speech
text. This check used a separate test database/server, made no GM call and touched no user campaign.
The previously running desktop server still needs a restart to load the newly saved runtime paths.

Codex correction: version 0.159.2 now runs genuine isolated subscription CLI requests with native file-backed ChatGPT login. Fresh home/working directory, sanitized model metadata, disabled tools/customizations and stripped inherited variables are verified by the actual CLI against anonymous loopback fixtures. Two models/efforts preserve saved context with fresh thread IDs; native synthetic login proves auth hardlinks retain their inode under CLI writes. Four Codex boundary tests and the explicit native offline runtime test passed; no real Codex model call was made. Final provider service probe returns supported:true with current local account-cache models. Details: ../docs/reviews/codex-provider-status.md.

Live verification now supersedes the earlier no-model-call limitation: three real Codex turns and
three real Claude turns alternated in one saved campaign, with two automatic Codex memory
checkpoints, correct character mutations and context retention. Codex's strict transport now wraps
the application JSON in `payload_json`; decoding still precedes unchanged domain validation.
Claude receives the same application constraints without the unsupported draft meta-schema
annotation. Ten provider regressions, native Codex isolation, 36 isolated-DB/backend cases and 24
frontend cases passed. Full evidence and known setup limits: `../docs/reviews/live-codex-claude.md`.

Trusted dice integration (2026-10-01): generic crypto faces, version-2 GM validation,
migration 0004 and append-only persistence/replay are now connected to gameplay. Terminal
roll hydration, frozen-context retry, cancellation/lease/undo audit, v2 export/import with
v1 normalization, derived retry reasons and accessible chat rendering are implemented.
Source extraction and compaction remain no-tools. Current verified production dice path:
Claude 2.1.232 with CLI model aliases, explicit output/turn/context controls and disabled
opaque auto-compaction. Actual isolated PostgreSQL gameplay checks completed two Claude
turns and retained every roll reference. Browser and fixture evidence covers failed retry,
provider switching, undo and archive preservation. Codex dynamic-tool transport now interrupts before native tool replies and uses fresh bounded
application-owned phases. Native only-dice/fresh-phase evidence and two actual gameplay
turns passed; a real Claude-to-Codex retry preserved the identical stored roll/face.
No ignored max-output override is used. Antigravity 1.2.14 now uses explicit application-managed
JSON dice requests through fresh isolated subscription CLI phases; native MCP remains unavailable.
Two actual Gemini 3.8 Flash/low PostgreSQL turns completed, and explicit retry after an injected
post-provider failure preserved the identical saved roll UUID and face 6. Latest evidence and gates:
`../docs/reviews/dice-provider-capabilities.md`. No real user campaigns or shared CLI/MCP
configuration were altered; no commit/push was made.

## Rules library (2026-10-01)

Implemented the reviewed shared current-row library, protected instructions-only default, deterministic annotated Markdown preview/publication, bounded browsing and owned rule tools alongside existing crypto dice. Migrations 0005–0007 add protected identities, campaign mirrors, append-only receipts and transactional budgets, historical archive identity without a private-library foreign key, and generated lightweight publication metadata. Existing applied migrations were retained.

Every gameplay attempt captures system identity/revision/kind/hash. Acceptance, compaction/rebuild, session creation, read/replay, dice draw, heartbeat, retry and final commit check current ownership and head under PostgreSQL locks. A changed head retains short evidence/dice but cannot apply late canonical changes or resume the old action. New actions use latest rules. Original UTF-16 quote/page spans are validated against persisted text receipts. Default gameplay retains v2/model knowledge; book gameplay uses strict v3 and exactly five owned tools. Compaction/extraction remain no-tools.

Campaign archives now export v3 references and bounded historical audit without full books; named v1/v2 imports remain supported. Missing/differing private libraries are explicitly unresolved until the user chooses a verified exact-key candidate or the default. Private backup v1 separately stages at most 32 MiB and restores local identity with monotonic revisions, explicit replacement and persisted confirmation replay. Book uploads reject the combined 20 MiB limit during streaming, without raising ordinary JSON upload limits.

Validation used the disposable PostgreSQL 18 cluster on 127.0.0.1:55439, database rpg_rules_release_test, and separately owned schemas. All migrations ran on the fresh release database. Consolidated rules.database.test.ts covers publication/no-op/replay, default/FK mirrors, HTTP access and routing, backups/archives/resolution, selection and upload limits. Its additional real lock-contention test races publishing with session creation and drawing; no new session/face is stored. Historical receipt pagination counts full metadata within 16 KiB and visits each receipt once. ruleGameplay.database.test.ts covers publication during compaction (no memory/gameplay/session), persist-before-reveal, late-final rejection, new-action latest citations and retry identity. Ordinary adapter fixtures are not native evidence.

Actual Windows native evidence: Claude 2.1.232/sonnet/medium and Codex 0.159.2/gpt-5.6-sol/medium each completed rule→dice→rule→v3. Two complete campaign runs retained failed old-head audit, rejected retry, switched CLI and completed a latest-head cited action. Production discovery exposes only these independently verified exact model/effort combinations, with 12 rule/12 dice/24 combined calls and an 8000-byte prompt ceiling; existing native context/output/turn limits were not raised. Antigravity 1.2.14 discovery recovered; its Gemini 3.8 Flash/medium direct native book probe passed after duplicate fixed definitions moved into the owned temporary agent. Two complete campaign tests then emitted unapproved native tool events and were rejected, so book mode remains unavailable. See ../docs/reviews/rules-library-capabilities.md for measured usage and all unsuccessful probes.

Latest maximum-size benchmark after migration 0007: 30 sequential warm/cold queries per fixture; 596 nodes/169823 bytes p95 1.261/4.172 ms, 10000 nodes/exact 20971520 bytes p95 49.630/151.823 ms. Both satisfy 500 ms/2 s targets. Prompt correctness separately verifies bounded instructions/overview and no whole-book injection.

Final validation totals and commands are recorded in ../docs/plans/rules-library.md. Typecheck, zero-warning lint, format, production build and public audit passed. The official portable Gitleaks 8.30.1 scanner was run from an owned local TEMP directory; no shared skill/global installation was changed. Private books, extraction scripts, user campaigns and shared CLI/MCP configuration were untouched; no commit/push.

External extraction gate: exact package/header/marker/LF/UTF-16 handoff is not confirmed by the extraction owner. The reviewed format is implemented and tested against original fixtures, but compatibility with unseen private packages is not claimed. Three-provider full acceptance remains incomplete because Antigravity complete campaign isolation validation failed; Android/macOS/Linux are excluded.

A repeated full regression run exposed the existing dice timeout test polling cleanup only 100 immediate iterations; on the loaded native Windows test host it observed running before terminal persistence. The test now waits a bounded five real seconds for cleanup, retaining the failure/face/no-state assertions. No production timeout was changed. Later full regression and static checks passed.
