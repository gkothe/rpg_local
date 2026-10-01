# Local RPG

A local, system-agnostic AI game master. One repository contains a TypeScript backend (`rpg_be_local`) and an English dark-journal frontend (`rpg_fe_local`). Campaigns live in your local PostgreSQL database. There are no game accounts, cloud API keys, adventure generators or map generators.

## Development status

The base local application is implemented. Real gameplay checks have exercised Antigravity and a back-and-forth campaign switching between Codex and Claude, including state changes and bounded memory compaction. See the [completion reconciliation](docs/reviews/completion.md), [Codex/Claude evidence](docs/reviews/live-codex-claude.md) and [Antigravity evidence](docs/reviews/antigravity-integration.md) for the actual tested versions/models and limits. No AI is simulated as a production fallback.

**Trusted dice is implemented for Codex and Claude on the verified Windows versions (2026-10-01).** Shared gameplay, recovery, archive and chat integration is present; Antigravity dice remains unsupported and all-provider acceptance remains incomplete. Its [plan](docs/plans/trusted-dice.md) and [provider capability evidence](docs/reviews/dice-provider-capabilities.md) track the current work. Existing narration availability does not prove dice-tool support, and preliminary transport checks do not prove completed gameplay, retry, undo or archive acceptance. Check these living documents before continuing that implementation.

Windows is the acceptance platform. Physical Android Chrome validation is on hold; macOS/Linux verification is outside the current acceptance scope.

## Product and architecture context

The aim is a local replacement for the older RPG backend/frontend, using independently authenticated **Claude Code, Codex or Antigravity (`agy`) CLIs** through the user's subscription. The app does not collect provider credentials. Players can change CLI, model and effort between turns while the app retains their campaign context.

- Flexible character sheets and AI game-rule interpretation, with validated automatic state changes, a visible change list and full undo.
- Pasted text, Markdown/text files, PDFs including locally OCR'd scans, and public Google Docs. Extracted text is reviewed/corrected before it becomes confirmed reference material.
- Reusable campaign/character templates, campaign export/import, private notes, editable campaign memory, local dictation and read-aloud.
- No user-account system, adventure-generation workflow or map generation. Optional LAN pairing is a device access boundary, not a game account.

The backend owns canonical campaign state, immutable turn inputs, transcripts, relevant rules and memory checkpoints. Each game turn starts with bounded application-owned context rather than relying on a provider's persisted chat session. Memory compaction covers bounded consecutive history instead of summarizing the entire chat every turn. Private notes stay out of GM prompts.

| Location                       | Responsibility                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `rpg_be_local/src/app.ts`      | HTTP transport, validation and response envelopes.                                         |
| `rpg_be_local/src/services/`   | Campaign, turn, source and library workflows.                                              |
| `rpg_be_local/src/domain/`     | Schemas, canonical options/limits, context assembly and validated state changes.           |
| `rpg_be_local/src/providers/`  | CLI discovery, verified isolation, bounded subprocesses and provider-specific transport.   |
| `rpg_be_local/src/store.ts`    | PostgreSQL persistence, locks and transaction helpers.                                     |
| `rpg_be_local/migrationssql/`  | Ordered immutable SQL migrations.                                                          |
| `rpg_fe_local/src/pages/`      | Library, campaign setup, play and settings screens.                                        |
| `rpg_fe_local/src/features/`   | Character sheets, source review, provider selection, journal, audio and play interactions. |
| `scripts/`                     | Maintained local startup, setup, development and public-audit tooling.                     |
| `docs/plans/`, `docs/reviews/` | Intended work and dated verification evidence; checked tasks require evidence.             |

Backend: Node.js 22.13+, TypeScript ESM, Express, PostgreSQL and Zod. Frontend: React, TypeScript, Vite and custom journal CSS. Root npm workspaces own dependencies and the lockfile.

### Trusted-dice decisions

- Every random game roll must come from an application-owned cryptographic dice tool.
- The generic tool returns individual faces only. The AI applies bonuses and interprets game rules; there is no app-enforced combat engine.
- Calls are automatic for any participant needing a roll; no manual player roll button is required.
- Known modifiers/difficulty are declared before rolling. Later corrections are visible and preserve the original dice/declaration.
- All rolls appear in chat with the complete answer. Live dice animation, combat tickers and streamed narration are outside scope.
- Failed-turn retries preserve recorded rolls. An uncertain HTTP retry must not start another generation; undo retains the roll audit.
- Only the owned dice capability may be exposed, with verified continuation/context limits. Unsupported providers must be reported explicitly, never replaced with invented dice or a hidden fallback.

These decisions are implemented for the verified Codex/Claude paths; the Antigravity provider gate remains open. The [earlier brainstorm](rpg_be_local/docs/dice-rolling-architecture.md) is background; the maintained plan supersedes its alternatives and unverified caching/latency assumptions.

## Windows prerequisites

- Node.js 22.13 or newer and npm (use a supported LTS release).
- PostgreSQL, with a separate local database for this game. Do not use an existing production database or its credentials.
- At least one official CLI authenticated separately: Claude Code, Codex or Antigravity (`agy`). The game never collects subscription credentials.
- PDF import additionally needs the backend's Python conversion requirements and Tesseract language data for scanned pages.
- Dictation additionally needs the local Faster-Whisper runtime and downloaded model weights. It has no API token allowance or cloud transcription fallback.

Check the backend README for database/provider settings and [local runtime setup](docs/local-runtime.md) for scanned PDFs and dictation. For Windows dictation, run `setup-voice.cmd` once, then restart `start.cmd`; the setup installs local speech dependencies and downloads the model without any API key. Keep real settings and private data outside Git.

## Install and run

After installing dependencies and configuring PostgreSQL, double-click `start.cmd` in this folder, or run `.\start.cmd` from PowerShell. It builds both apps and serves the game at `http://127.0.0.1:4100`; keep the terminal open and press Ctrl+C to stop. For live editing, use `.\start.cmd dev` (frontend at port 5174). First run `setup-database.cmd` to create a dedicated local database and apply migrations. It asks for your PostgreSQL administrator password once, creates a separate game role, and saves only the game connection encrypted with Windows DPAPI outside Git. Rerun it after updates to apply pending migrations. The launcher loads these saved settings; explicit environment settings take precedence. PostgreSQL must already be installed and running. For an existing dedicated database, run `powershell -ExecutionPolicy Bypass -File .\setup-database.ps1 -ConfigureExisting`.

From this repository's root:

```powershell
npm install
# Configure the backend's local PostgreSQL settings first.
npm run migrate
npm run dev
```

Development opens the frontend at `http://127.0.0.1:5174`, with `/api` proxied to the backend on port 4100. One root command starts both apps; Ctrl+C stops them. The game can open without a provider account, but AI features require your independently authenticated installed CLI and a verified model configuration.

For a production-style local run:

```powershell
npm run build
npm start
```

The backend serves the built frontend at `http://127.0.0.1:4100`. Both apps use the same origin. No old RPG production backend is contacted.

## Verification

```powershell
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e --workspace rpg-fe-local
npm run audit:public
```

Database integration tests must use a separately named local test database. Live CLI, scanned-sheet accuracy, audio quality and real-phone checks are distinct validation gates and must not be inferred from mocked tests.

`npm run lint:fix` fixes supported lint issues; `npm run format` applies the shared Prettier style. Contributor rules live in `CLAUDE.md` and each app's `CLAUDE.md`; [development standards](docs/development-standards.md) explains the conventions adapted from Gylden Rune.

## Phone, speech and data

LAN mode is explicit and defaults off. Your PC must stay running. Follow [LAN setup](docs/lan-setup.md) and the [Android Chrome checklist](rpg_fe_local/docs/android-chrome.md) for device pairing, firewall access and microphone HTTPS. Plain LAN HTTP supports typing. No firewall or certificate trust is changed automatically.

Local dictation converts a recording to editable text before you press Send. Only that text enters the bounded GM prompt. Read-aloud speaks an existing committed GM response using an available installed local voice; it makes no additional GM request. Feature controls report missing runtimes or voices instead of silently switching to paid cloud services.

Campaign exports are private save files: keep them, uploaded rules and recordings outside the public repository. The public repository is [gkothe/rpg_local](https://github.com/gkothe/rpg_local), with fresh Git history and the [MIT license](LICENSE). Publishing further changes is a separate action.

## Start here as an agent or contributor

Read the [shared project rules](CLAUDE.md), [agent coordination](AGENTS.md), the target app's rules ([backend](rpg_be_local/CLAUDE.md), [frontend](rpg_fe_local/CLAUDE.md)), and the [HTTP contract](rpg_be_local/docs/api-contract.md) before editing. Read both app rule files for a cross-app change. Follow the applicable feature plan and [development standards](docs/development-standards.md).

Important boundaries:

- Backend-owned constants, schemas, option sets and limits are authoritative; frontend consumers must not independently recreate domain enums or fallback options.
- Application I/O is sequential. CLI/network/OCR/audio work stays outside database transactions; mutations use locks, revisions and ownership checks.
- Preserve bounded context, provider isolation, full state undo, stable request identity and unsaved UI drafts. Do not hide failures with simulated AI or a cloud fallback.
- Use an explicitly isolated test database. Never run tests against real campaigns or a production database.
- Keep credentials, local settings, private campaign data, scratch scripts and raw logs outside public Git. Never copy old `.env` files, credentials or Git histories.
- Inspect Git status and coordinate with agents already editing before changes. Do not overwrite unrelated work or run competing dependency installs.
- Mocked tests, actual native CLI canaries and real subscription calls establish different things. Report actual commands/results and environment-gated skips separately; keep each app's implementation notes and the relevant plan/evidence current.

Some early coordination documents contain a pre-publication restriction; the user's later publication instruction and the existing public repository supersede that historical statement. Do not treat this README as authorization for an unrelated external action.

### Surrounding workspace and skills

On the original Windows workspace, this repository lives at `D:\projects\rpg\rpg_local`. Sibling `rpg_be` and `rpg_fe` are the original projects and are read-only references for local-app development. `rpg_stories` is a separate adventure-generation project, outside this app's current scope. The parent folder's `CLAUDE.md` primarily describes those original projects; use this repository's rules for its stack, ports and behavior.

**Use this repository's `start.cmd`.** The parent `D:\projects\rpg\start.cmd` launches the original backend/frontend.

Additional local design references are `D:\projects\gylden rune\gr_be`, `D:\projects\gylden rune\gr_fe` and `D:\projects\markitdown`. They are optional read-only references; a public checkout must work without them.

The original machine shares coding skills across Claude Code, Codex and Antigravity at `G:\My Drive\claude\skills`. Reading an available skill is fine; installation, modification or deletion requires explicit confirmation because it affects all three tools. Neither builds nor setup scripts may depend on this machine-specific path.

### Documentation map

| Document                                                               | Use it for                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Original local-app plan](docs/plans/local-rpg.md)                     | Agreed base scope and reconciled implementation work.                               |
| [Trusted-dice plan](docs/plans/trusted-dice.md)                        | Current feature requirements, tasks, compatibility boundaries and acceptance gates. |
| [Dice capability evidence](docs/reviews/dice-provider-capabilities.md) | Actual provider findings and remaining technical gates.                             |
| [Completion reconciliation](docs/reviews/completion.md)                | Dated base-feature delivery and validation limits.                                  |
| [Backend implementation notes](rpg_be_local/IMPLEMENTATION.md)         | Backend changes and executed checks.                                                |
| [Frontend implementation notes](rpg_fe_local/IMPLEMENTATION.md)        | Frontend changes and executed checks.                                               |
| [Local runtime setup](docs/local-runtime.md)                           | PDF/OCR and speech dependencies.                                                    |
| [LAN setup](docs/lan-setup.md)                                         | Optional phone/network access and secure microphone setup.                          |

This README is an entry point. Use current code, contracts, feature plans and dated verification reports for detailed status; update them when behavior changes.

### Using trusted dice

Game rolls are automatic. The backend stores cryptographically generated individual faces before the GM receives them; the GM interprets the rules, bonuses and targets. Completed and failed/cancelled attempts show the original declaration, every face and any separate explained correction in chat. There is no manual roll button or live animation. Use the audit checkbox to see undone attempts.

For a terminal failure, **Retry with saved dice** continues the original action and preserves its original rolls and declaration. It leaves your unsent composer draft alone. An uncertain network response offers a check of the same request ID; resolve that before sending a new action. Restoring an action to the composer deliberately starts a new action with new dice. Changes to game state, rules, sheets or memory, a later action, an imported archive, or an incompatible provider can make recovery unavailable; the interface shows the reason.

There are 12 roll slots and 200 new faces per logical action, up to 24 tool requests per attempt, bounded context/transcript and a three-minute attempt deadline. Unsupported providers fail explicitly. Codex 0.159.2 with verified account catalog/context budgets and Claude Code 2.1.232 with current CLI aliases have the verified gameplay paths; Antigravity dice remains unsupported. Older no-tools narration checks are not proof of dice capability. Consult the capability evidence before treating all-provider release acceptance as complete.

New exports use archive version 2 and retain rolls, interpretations and undo audit. Version-1 archives still import with empty dice history. Imported dice remain visible but cannot be executed as a retry. Trusted faces prevent the model from choosing displayed randomness; they do not guarantee correct rule interpretation or narration.
