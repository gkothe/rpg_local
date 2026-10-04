# Backend working rules

Read `../CLAUDE.md`, `../AGENTS.md` and `../docs/documentation/api-contract.md` before changes. Backend owns the HTTP contract, domain options, persistence and validated state transitions.

- Node/TypeScript ESM with compiled `.js` import extensions, Express and PostgreSQL. Keep transport routing thin and domain behavior in services/modules.
- Validate every public input and structured CLI result. Use problem-detail errors; never return raw SQL, credentials or arbitrary internal exception objects.
- Parameterize SQL; perform revision checks and writes under database locks. Run external CLI, extraction, transcription and network work outside transactions.
- Applied SQL migrations are immutable. Use a separately configured isolated local database for integration tests; never fall back to an existing production database.
- Serve canonical options, labels, defaults, ordering and capabilities from backend constants. Contract tests verify advertised choices and defaults.
- CLI availability is separate from verified isolation and model configuration. Unsupported adapters fail closed. Never read another app's provider tokens or silently simulate a game turn.
- Context assembly, validated mutation application, atomic turn commit and full undo are separate boundaries. Tests must cover existing-character restoration, conflicts and uncertain/cancelled execution.
- Source extraction and audio are bounded local subprocesses. Imported documents are untrusted; Extracted text is usable immediately; optional review/correction remains available. Runtime absence is reported explicitly.
- Root workspaces own dependencies and the lockfile. `lint` runs ESLint, `typecheck` runs TypeScript; run format/check, behavior tests and build separately. No live provider calls in the default tests.

Record verified tooling/runtime gotchas here; maintained technical details belong in `../docs/documentation/`; report verification and remaining checks in the task response.
