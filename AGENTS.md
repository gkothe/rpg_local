# Local RPG implementation

Before inspecting, changing or running project code, read the root `CLAUDE.md` and the target app's `CLAUDE.md`. Root `CLAUDE.md` is the shared rule source; keep this file focused on implementation coordination. For cross-app work, read both app files.

Read the reviewed plan at `docs/plans/local-rpg.md` before implementation. The applicable Gylden Rune conventions are adapted in `CLAUDE.md` and `docs/development-standards.md`; the standalone public checkout must not depend on external reference files. Use the available coding skill and relevant specialist skills; do not edit/install shared skills.

One new monorepo, two apps: `rpg_be_local` and `rpg_fe_local`. Old RPG/Gylden/MarkItDown checkouts are read-only references. Never copy old `.env`, credentials, private data, logs, database dumps or Git histories. No public GitHub publication is authorized.

Coordination: backend agent owns `rpg_be_local/**`; frontend agent owns `rpg_fe_local/**`; primary agent owns root tooling and integration docs. Do not overwrite another agent's files. Backend owns the HTTP contract and served option sets; communicate contract changes promptly to frontend and primary. Record completed checks and limitations in each app's IMPLEMENTATION.md; primary reconciles the master plan.

Use Node 22.13+ compatible tooling. Backend package name `rpg-be-local`, HTTP port 4100; frontend package name `rpg-fe-local`, development port 5174, relative `/api` proxied to backend. Root npm workspaces owns installation/lockfile; coordinate before installing packages so concurrent npm commands do not race.

PostgreSQL only, explicit local settings, isolated test DB. Never use existing production credentials/database. Real CLI generation and microphone access are not required for initial implementation; use meaningful synthetic boundary tests, and report unverified live behavior. No silent mock AI or in-memory persistence fallback in the shipped app.

Audio working defaults: local Faster-Whisper for dictation, local installed voices for click-to-read GM text. Feature diagnostics/fallback typing must work if local runtimes are missing. Optional phone/LAN access; loopback default. HTTPS/tunnel provisioning and actual device testing can be documented as setup/validation gates; do not modify firewall or certificate trust automatically.
