# Agent guide

Read root `CLAUDE.md` and the target workspace's `CLAUDE.md` before changing code. Read both workspace files for changes crossing the API boundary. These files contain the project's maintained working rules; no external skills or reference checkouts are required.

## Setup and documentation

- Follow `docs/documentation/installation.md`, including its coding-agent procedure, for dependencies, PostgreSQL, migrations, CLIs and optional audio/OCR tools.
- Read `docs/documentation/rpg-backend-architecture.md` for processing and persistence, and `docs/documentation/api-contract.md` for HTTP contracts.
- Keep public documentation in `docs/documentation/`. Keep temporary plans, review reports, investigation journals and verification transcripts outside the repository. Transfer lasting findings into maintained documentation.

## Working in the monorepo

- Root npm workspaces own installation and the lockfile. Coordinate dependency changes and avoid simultaneous installs. Node.js 22.13 or newer is required.
- `rpg_be_local` owns the API, persisted state, validation and served domain options. `rpg_fe_local` owns the React interface. Keep shared contracts aligned.
- Do not overwrite another contributor's changes. Coordinate ownership when several agents work on the same files.
- Default to loopback: backend port 4100, Vite port 5174, relative `/api`. LAN access requires explicit setup; do not expose the Vite proxy to phones.
- Never commit credentials, private books, campaign exports, logs or database dumps. Use placeholders in examples and isolated databases for tests.
- Default tests mock external provider boundaries. Real CLI checks consume account allowance and must be reported separately. Missing runtime dependencies must produce explicit diagnostics, never simulated success.
- Follow the root verification commands in `CLAUDE.md`. Report actual checks, skips and remaining limitations in the task response.
