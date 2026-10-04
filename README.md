# Local RPG

Play a solo tabletop RPG in your browser, with Claude Code, Codex or Antigravity as the game master.

The app keeps campaigns, characters and game history in a local PostgreSQL database. You choose the CLI, model and effort in the interface and can change them between turns. The CLI uses your own account; the app does not need an OpenRouter key.

**Windows is the tested platform.** AI requests still go to the selected provider, so local storage does not mean offline AI. macOS and Linux setup is not covered by the installation guide.

## What you can do

- Play through a chat journal, manage your player character and NPCs, and edit their sheets.
- Import campaign material and character sheets from text files, Markdown, JSON, PDFs or public Google Docs. A character uploaded during campaign creation is parsed into the main player sheet using the selected CLI.
- Keep reusable rule libraries, or play with the instructions-only **Model knowledge** default. The GM interprets the rules; the app supplies original book text through lookup tools.
- Roll dice automatically through an app-owned tool. The backend generates and saves the faces; the GM explains the result and applies the rules.
- Save important campaign facts and NPCs as play unfolds. The GM can recall them in later turns, including after a provider switch.
- Undo completed turns, retry failed turns with their saved dice, export/import campaigns and save templates. Rule libraries have a separate backup.
- Dictate an action with local Faster-Whisper, edit the transcript and send it. Read GM replies aloud using an installed browser/OS voice.

Story generation and map generation are outside this app's current scope. There is no player account or login screen.

## Install on Windows

You need Git, Node.js **22.13 or newer**, PostgreSQL and at least one authenticated AI CLI for gameplay. PDF processing and dictation need extra local tools.

Start with the [installation guide](docs/documentation/installation.md). It covers external dependencies, database creation, migrations, CLI sign-in, OCR, voice setup and verification. It also includes a [setup procedure for coding agents](docs/documentation/installation.md#installation-by-a-coding-agent).

If those prerequisites are already installed, open PowerShell and run:

```powershell
git clone https://github.com/gkothe/rpg_local.git
Set-Location rpg_local
npm.cmd install
.\setup-database.cmd
.\start.cmd
```

Database setup asks for a local PostgreSQL administrator login, creates a dedicated game database and role, applies migrations and saves the game connection encrypted under your Windows account. The [agent procedure](docs/documentation/installation.md#installation-by-a-coding-agent) can create a separate local PostgreSQL instance when an existing administrator password is unavailable.

Open **http://127.0.0.1:5174**. Keep the terminal open; Ctrl+C stops the app. This mode reloads frontend and backend source changes automatically.

For a built version served by the backend:

```powershell
.\start.cmd run
```

Open **http://127.0.0.1:4100**. This command builds both apps before starting them. The launcher loads saved database and speech settings; running npm directly requires setting the environment variables yourself.

## Start a game

1. Open **Settings** and refresh CLI diagnostics. Sign in through the CLI's own terminal if needed.
2. Create a campaign, choose a rules system and select an available CLI/model/effort.
3. Add campaign documents and, if you have one, a player character sheet. Successful uploads are usable immediately; reviewing extracted text is optional.
4. Open **Play** and tell the GM what your character does.

System instructions are the main GM guidance. Campaign **GM instructions** are optional additions for that game, such as its language or tone. Each new action uses the selected system's latest local revision. Instructions stay intact; the context also includes campaign state, history/memory and relevant source material.

A new player action starts a fresh provider conversation assembled from the saved campaign. Tool calls and their follow-up reasoning stay in that conversation until the GM finishes. The app validates the final response before saving game changes. Malformed responses can receive up to two automatic correction attempts. Cancel remains available while the GM works.

Dice faces survive a failed attempt. **Retry with saved dice** continues the original action when its context is still compatible. It does not reroll saved faces. Changing campaign state or rules can make an older retry unavailable. Dice integrity and validated JSON do not guarantee correct narration or rule interpretation.

## Your data

Campaigns, source documents, characters, dice and undo records live in PostgreSQL. The Windows launcher stores local connection/runtime settings under `%LOCALAPPDATA%\LocalRPG`; database credentials are encrypted with Windows DPAPI. CLI credentials remain managed by the providers' own tools.

GM and AI parsing prompts are written to `log/` at the repository root. These files can contain character sheets, rule text and private campaign details. The folder is ignored by Git. Campaign exports and library backups can contain private material too; keep them outside the checkout when sharing or publishing code.

Gameplay exposes the app's dice, rules and campaign-recall tools to the GM. Shell commands, unrelated MCPs and arbitrary computer-file access are blocked by the provider adapters. Imported text can still affect model behavior, and selected context is sent to your AI provider.

## Voice and phone access

[PDF/OCR and voice setup](docs/documentation/installation.md#pdfs-ocr-and-dictation) explains the optional dependencies. Transcription runs on your PC without an API key. The text you send afterward uses the selected GM provider as usual. Read-aloud speaks an existing reply and does not make another GM request.

The app opens on the same computer by default. Optional phone access needs explicit LAN configuration and device pairing. A phone microphone also needs trusted HTTPS. See [LAN setup](docs/documentation/lan-setup.md); physical Android testing remains pending.

## Development

This repository contains two npm workspaces:

```text
rpg_be_local/   Express + TypeScript API, PostgreSQL migrations, CLI adapters
rpg_fe_local/   React + Vite interface
scripts/       Shared launch, database and maintenance tooling
docs/          Maintained public documentation under documentation/
```

Install dependencies from the root. The backend listens on port 4100; Vite uses 5174 and proxies `/api` to the backend.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd test
npm.cmd run build
```

Optional browser tests require Playwright's Chromium:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e --workspace rpg-fe-local
```

Default tests use synthetic provider boundaries. Database integration tests need a separate local database whose name ends in `_test`, with `NODE_ENV=test` and `RPG_TEST_DATABASE_URL`; live CLI checks are opt-in and consume your account's allowance. Read the test files before enabling them. Never run tests against your actual campaign database.

Before changing code, read [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md) and the target workspace's rules.

## Documentation

- [Installation guide](docs/documentation/installation.md): a fresh Windows setup, including an agent procedure.
- [Backend architecture](docs/documentation/rpg-backend-architecture.md): turns, prompts, tools, persistence and information handling.
- [API contract](docs/documentation/api-contract.md): endpoints and request/response formats.
- [Rulebook imports](docs/documentation/rulebook-imports.md): preparing compatible book packages.
- [Runtime reference](docs/documentation/local-runtime.md): detailed Python/OCR/speech configuration.

The **Flow** page in the app explains the architecture with synthetic examples. It does not run a campaign or consume AI quota.

## License

[MIT](LICENSE). Imported rulebooks and campaign documents retain their own rights; this repository does not distribute them.
