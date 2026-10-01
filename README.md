# Local RPG

A local, system-agnostic AI game master. One repository contains a TypeScript backend (`rpg_be_local`) and an English dark-journal frontend (`rpg_fe_local`). Campaigns live in your local PostgreSQL database. There are no game accounts, cloud API keys, adventure generators or map generators.

## Development status

The local application is implemented. Antigravity 1.2.14 passed real GM generation, PostgreSQL state updates and full undo. See each app's `IMPLEMENTATION.md` and the [integration evidence](docs/reviews/antigravity-integration.md) for checks and remaining device/provider limits. No AI is simulated as a production fallback.

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
```

Database integration tests must use a separately named local test database. Live CLI, scanned-sheet accuracy, audio quality and real-phone checks are distinct validation gates and must not be inferred from mocked tests.

`npm run lint:fix` fixes supported lint issues; `npm run format` applies the shared Prettier style. Contributor rules live in `CLAUDE.md` and each app's `CLAUDE.md`; [development standards](docs/development-standards.md) explains the conventions adapted from Gylden Rune.

## Phone, speech and data

LAN mode is explicit and defaults off. Your PC must stay running. Follow [LAN setup](docs/lan-setup.md) and the [Android Chrome checklist](rpg_fe_local/docs/android-chrome.md) for device pairing, firewall access and microphone HTTPS. Plain LAN HTTP supports typing. No firewall or certificate trust is changed automatically.

Local dictation converts a recording to editable text before you press Send. Only that text enters the bounded GM prompt. Read-aloud speaks an existing committed GM response using an available installed local voice; it makes no additional GM request. Feature controls report missing runtimes or voices instead of silently switching to paid cloud services.

Campaign exports are private save files: keep them, uploaded rules and recordings outside the public repository. The repository has fresh Git history and uses the [MIT license](LICENSE). GitHub publication remains a separate action.
