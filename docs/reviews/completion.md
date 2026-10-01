# Completion review — 2026-10-01

The planned features are delivered in the MIT-licensed monorepo published at
[GitHub](https://github.com/gkothe/rpg_local). The plan is reconciled in
`../plans/local-rpg.md`. No legacy credentials, private campaign data or old Git history were imported.

## Delivered behavior

Campaign management, flexible player/NPC sheets, notes, reviewed text/Markdown/PDF/Google Docs
imports, scanned-page OCR, source pins/viewing, templates and portable archives use PostgreSQL.
The English dark journal renders backend-owned CLI/model/effort choices, automatic validated
changes and full undo. Durable request IDs, locked short commits, cancellation and recovery protect
canonical state. There are no app accounts, map/adventure generators or cloud-key fallbacks.

Every AI request receives fresh app-owned context with mandatory state/pins, bounded memory,
complete uncovered turns and relevant rules. Consecutive-batch compaction replaces the old full-chat
summary after every turn. Context limits and validation reduce risk but do not establish narrative
truth or eliminate hallucinations.

Local Faster-Whisper provides editable dictation; installed local browser voices read committed
GM replies. Opt-in LAN pairing/revocation and optional HTTPS are implemented. Native Windows
startup, database/migration and voice setup scripts keep credentials/runtime data outside Git.

## Current verification

- Production builds, substantive typechecks and zero-warning lint passed. Formatting passes for
  changed/tracked deliverables; an unrelated untracked dice architecture document currently fails
  the repository-wide formatting command and was left intact.
- Latest isolated PostgreSQL/backend suite: **36 passed**, four explicitly gated checks skipped.
  Latest frontend suite: **24 passed**. Native Codex isolation/transport verification passed.
- [Live Codex/Claude exchange](live-codex-claude.md): **six real completed turns**, three per
  provider, plus two real Codex memory checkpoints. Provider switches retained narrative facts,
  canonical health/inventory and stored player/GM messages. Browser verification displayed all six.
  The run found and fixed Codex strict-schema transport and Claude meta-schema compatibility bugs.
- Antigravity 1.2.14 previously passed real narration/memory generation, tool-denial canaries,
  model/effort switching and PostgreSQL mutation/undo. Its installed-Chrome workflow passed in
  25.4 seconds. See [provider evidence](antigravity-integration.md).
- The opt-in synthetic SQL service check previously completed **1,000 turns and 142 compactions**,
  inspecting all 1,142 prompt ceilings, state retention and undo/checkpoint invalidation.
- **Eleven real Python cases** passed for native/scanned/mixed/Portuguese/blank PDFs and local
  speech. Actual Node extraction/transcription wrappers passed. Installed Windows Chrome checks
  covered local voices and MediaRecorder-to-Whisper transcription without automatic GM submission.
- Seven synthetic Windows Chrome scenarios and separate HTTPS pairing/revocation/reconnect
  fixtures passed. A fresh external public-source/lockfile installation passed npm ci, typecheck,
  lint, default tests and production build; this was not a remote-clone installation test.
- Public-source, production-bundle and Git history scans have passed without secret findings.
  The latest live-provider-fix scan covered 151 public files and two bundles. Runtime models,
  certificates, test databases and raw diagnostic reports remain outside Git.

## Scope and limits

The owner placed **physical Android testing on hold** and excluded macOS/Linux validation from
current acceptance. LAN/device behavior is implemented, but Android certificate trust, microphone
permission and available offline voices have not been verified on that phone.

Live subscription testing covers Codex 0.159.2 with gpt-5.6-sol/low, Claude sonnet/low, and the
previously documented Antigravity Gemini variants. Other listed models/efforts can have different
account entitlements. Codex and Antigravity remain version/isolation-gated; there is no automatic
unsafe fallback. The app-owned transcript and memory do not depend on provider chat sessions.

OCR tables/layouts still require the accepted preview/correction step. Public internet hosting,
legacy campaign migration and an app-enforced dice/combat engine remain excluded. Private archives,
rulebooks, certificates and native CLI authentication/history must never enter public Git.
