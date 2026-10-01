# Completion review — 2026-10-01

The implementation plan is reconciled in `../plans/local-rpg.md`. One fresh local Git repository contains both applications, shared npm tooling, adapted Gylden rules and the MIT license. No old credentials, private data or Git history were imported. No GitHub publication was performed.

## Delivered behavior

Campaigns, flexible player/NPC sheets, private notes, confirmed/corrected source imports, current-section pins, original upload viewing, templates and versioned archives use PostgreSQL. The English dark journal renders backend-owned provider/model/effort choices and validated automatic changes. Durable request identity, database locks, short atomic commits and before-images support cancellation, recovery and full undo.

Context is app-owned and fresh for every AI call: mandatory state/pins, bounded memory, complete uncovered turns and relevant confirmed rules. It never resumes a provider session or silently drops mandatory/uncovered history. Oversized inputs fail explicitly. Compaction summarizes consecutive batches occasionally rather than the entire transcript after each turn. CLI overhead is reserved separately within gameplay, compaction and character-parsing limits.

Antigravity 1.2.14 has a live-verified isolated adapter, seven discovered model families and separate effort selection. Real Gemini 3.8 narration/state changes and Gemini 3.7 memory generation passed. See [the provider investigation](antigravity-integration.md). Unsupported CLI capabilities remain visible and disabled; there is no simulated or cloud-key fallback.

Local MarkItDown/PDFium/Tesseract extraction covers native/scanned/mixed PDFs with editable review. Local Faster-Whisper turns recordings into editable composer text without automatically sending a turn. Installed local browser voices read committed GM responses. Opt-in LAN provides desktop pairing, revocation, same-origin phone access and optional native HTTPS.

## Verification

- Root production build, TypeScript, zero-warning ESLint and Prettier checks passed.
- Full configured runtime run passed 28 backend cases and 15 frontend unit cases, including simultaneous-request regression coverage. The opt-in 1,000-turn SQL service test also passed: 1,000 turns, 142 automatic compactions, all 1,142 request ceilings inspected, provider/model/effort switches, pinned facts and undo/checkpoint invalidation. No live AI was used for those 1,000 turns.
- Eleven real Python tests passed with local dependencies/models, including synthetic native/scanned/mixed/Portuguese/blank PDF fixtures and speech inference. Actual Node extraction/transcription wrappers also passed.
- Seven synthetic installed-Chrome browser scenarios passed. Separate real checks passed PostgreSQL source/notes/templates/archives, NIC HTTPS pairing/revocation/reconnect with Secure/HttpOnly cookies, installed local voice playback, and MediaRecorder → local Whisper → editable composer with zero GM submissions.
- The opt-in installed-Chrome Antigravity browser test passed in 25.4 seconds: provider/model/effort selection, real turn/state changes, switch from Gemini 3.8 to 3.7 with saved context, and two full undos. Provider settings now show save feedback. A real Antigravity/PostgreSQL turn changed health 8 → 12 and potions 1 → 0; undo restored both and preserved a private note. Disposable verification data was removed.
- A fresh external source/lockfile copy passed `npm ci`, types, lint, formatting, default offline tests and production build, with no existing DB or live AI. Windows temporary-directory alias canonicalization was fixed after the first run exposed a Vite path mismatch. The final production bundle matched the local build: approximately 317 KB JS and 9 KB CSS.
- Public-source and built-bundle Gitleaks scanning passed with no findings. The local repository has zero commits and no inherited history; history scanning automatically applies once commits exist. Private OCR/model/TLS/test data and reports are outside the repository. Final scan details are maintained below.

## Explicit limits

Physical Android Chrome certificate trust, microphone permission and installed offline voices require the device checklist. Windows browser fixture HTTPS tests bypassed trust only within the test context; no firewall or OS certificate trust was changed automatically. macOS/Linux remain untested.

Codex 0.159.2 now has a verified empty-tool isolated adapter, account-cache choices and native file-backed ChatGPT login; actual anonymous-loopback protocol tests passed, with no live Codex model call. Claude has fixtures and required-flag gating but was not live-tested; current native/npm discovery finds the executable; model aliases and effort levels come from installed CLI help (see the CLI discovery review). Antigravity versions other than 1.2.14 and configurations with hooks are intentionally disabled. Each model's account entitlement is checked when invoked; only the documented Gemini variants were used for live tests.

Fresh installation was tested from a public-source/lockfile snapshot, not a remote GitHub clone. Publishing remains separate. Personal campaign data, rulebooks, certificates and CLI-owned conversation records must stay outside public Git. The OCR review step remains necessary for imperfect tables/layouts; context bounds and state validation do not eliminate narrative hallucinations.

# Completion review — 2026-10-01

The plan is reconciled in `../plans/local-rpg.md`. One fresh local Git repository contains both applications, shared npm tooling, adapted Gylden rules and the MIT license. No old credentials, private data or Git history were imported. GitHub publication was not performed.

Campaigns, flexible player/NPC sheets, private notes, reviewed source imports, current-section pins, original viewing, templates and versioned archives use PostgreSQL. The dark English journal renders backend-owned provider/model/effort options and automatic validated state changes. Durable request IDs, short locked commits, cancellation/recovery and before-images support full undo.

Every AI request receives fresh app-owned context: mandatory state/pins, bounded memory, complete uncovered recent turns and relevant confirmed rules. No provider session resumes or silent history truncation. Occasional consecutive-batch compaction replaces full-transcript summaries after each turn. Provider overhead is reserved separately inside gameplay, compaction and draft limits. State validation/context bounds do not prove narrative truth or eliminate hallucinations.

## Verification

- Root production build, substantive TypeScript checks, zero-warning ESLint and Prettier passed.
- The configured runtime suite passed **28 backend cases and 15 frontend unit cases**, including eight real PostgreSQL regressions and actual Node OCR/speech wrappers. Default tests skip explicitly gated external-runtime/DB checks.
- The separate opt-in SQL service test passed **1,000 turns and 142 automatic compactions** in 143 seconds. All 1,142 prompts were inspected against separate ceilings, with pinned facts, provider/model/effort switches, state undo and covering-memory invalidation. These calls used synthetic generators, not live AI.
- Eleven real Python tests passed with local dependencies/models: native/scanned/mixed/Portuguese/blank extraction and synthetic speech inference.
- Seven synthetic installed-Chrome scenarios passed. Separate real checks passed PostgreSQL source/notes/template/archive workflows, NIC HTTPS pairing/revocation/reconnect with Secure/HttpOnly cookies, installed local voice playback and MediaRecorder-to-Whisper editable transcription with zero automatic GM submissions.
- Antigravity 1.2.14 passed minimal-agent instruction and synthetic tool-denial canaries, grouped model/effort discovery, Gemini 3.8 narration and Gemini 3.7 memory generation. A real PostgreSQL turn changed health 8 → 12 and potions 1 → 0; undo restored both and preserved a private note.
- The **actual Antigravity browser workflow passed in 25.4 seconds**: selector, persisted changes, Gemini 3.8-to-3.7 switching carrying saved canonical context, and two full undos. Provider-setting saves now show feedback. Disposable fixture campaigns were deleted.
- A fresh external public-source/lockfile copy passed npmci, typecheck, lint, formatting, default offline tests and production build with no existing database or live AI. The first attempt exposed a Windows temporary-path alias mismatch; canonicalization fixed it. Production output matched the local build at approximately 317 KB JavaScript and 9 KB CSS.
- Public-source and built-bundle Gitleaks scanning passed with zero findings. The repository has zero commits/no inherited history; the audit automatically scans history once commits exist. Runtime models, OCR/TLS fixtures, test databases and redacted reports remain outside Git. Final scan details are recorded below.

## Explicit limits

Use [the provider evidence](antigravity-integration.md), [runtime setup](../local-runtime.md), [LAN setup](../lan-setup.md) and [Android checklist](../../rpg_fe_local/docs/android-chrome.md).

Physical Android certificate trust, microphone permission and available offline voices require that device. Windows fixture HTTPS bypassed trust only inside the test context; no OS trust/firewall changes were made automatically. macOS/Linux remain untested. OCR tables/layouts still need the accepted review/correction step.

Codex 0.159.2 is supported through a fresh isolated home and empty-tool model metadata; actual local protocol verification passed, with no live Codex model call. Other versions and unavailable native file-backed ChatGPT login fail closed. Claude has fixtures/required-flag gating but was not live-tested; native/npm discovery now finds its executable and derives alias/effort choices from installed help. Antigravity versions other than 1.2.14 and configurations with hooks fail closed. Listed models may have different account entitlements; only the documented Gemini variants were live-tested.

Installation was tested from a fresh source/lockfile snapshot, not a remote GitHub clone. Publication is outside authorization. Keep private campaign archives, rulebooks, certificates and CLI-owned conversation records outside public Git.

Final Gitleaks run inspected **125 public files and two built assets**, found **zero secrets**, and confirmed **zero Git commits/no inherited history**. Redacted findings were saved outside the repository.
