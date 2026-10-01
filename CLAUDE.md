# Local RPG shared project rules

Read this file and the target app's `CLAUDE.md` before changing its code. Read both app files for changes crossing the API boundary. The reviewed scope lives in `docs/plans/local-rpg.md`; tooling decisions live in `docs/development-standards.md`.

## Working conventions

- Use the coding skill and relevant specialists when available. Skills are shared across harnesses; never install, edit or delete them without the user's explicit confirmation. A public checkout must work without machine-specific skill paths.
- Keep common rules here, app gotchas in each app's `CLAUDE.md`, and topic details in `docs/`. Record non-obvious verified findings concisely; correct stale entries. Investigations and reviews produce a Markdown report in `docs/reviews/`.
- Old RPG, Gylden Rune and MarkItDown checkouts are read-only references. Never copy credentials, `.env`, private data, logs, dumps or old Git histories. Use placeholders in committed examples. Never use a production database for development or tests.
- Keep scratch files, temporary scripts and diff dumps outside the repository. Permanent tests and maintained tooling belong in the repository.
- Root npm workspaces own installation and `package-lock.json`. Coordinate installs between agents. Use normal `npm install`; do not inherit another project's dependency workarounds.

## Code and contracts

- Routes handle transport, input validation and response formatting; domain behavior belongs in services/domain modules. The backend owns persisted state and mutation validation.
- Declare domain values and limits once, using named constants. Backend-owned closed domain sets use enums where appropriate; external provider vocabularies use readonly constants. Platform literals, field names and deliberately literal test expectations need no invented constants.
- The backend owns persisted option sets, labels, ordering, defaults and domain capabilities. Serve them through the API; the frontend must not recreate them as enums, unions or fallback option lists. Free-form scalar seeds and purely local UI states are separate. Contract tests must pin advertised options and accepted mutations.
- Application I/O is sequential: no `Promise.all`, `allSettled` or `race` for parallel work. A timeout-only guard and a test explicitly proving concurrent behavior are exceptions. This is an application convention, not a restriction on independent agent/tool orchestration.
- Persist timestamps as UTC instants. Parameterize SQL. A transaction does not replace a lock or revision check: mutations must validate and write under the appropriate database lock. Never hold a database transaction open during CLI, network, OCR or audio work.
- Applied migrations are immutable; add a new migration for changes. Do not auto-sync schemas on startup.
- CLI calls must preserve context budgets and provider isolation. Missing capabilities must be reported explicitly. No hidden cloud or simulated AI fallback.

## Frontend behavior

- Use navigation links, with normal modified-click behavior. Stack mobile form fields one per row; make long text and lists wrap without horizontal overflow.
- Saving edits keeps the entity open and shows feedback. Dialog drafts reset intentionally. Polling must preserve unsaved text.
- Set synchronous in-flight guards before awaiting. Ignore stale responses after navigation/unmount; preserve request IDs when retrying an uncertain turn. A timeout is not proof that a mutation failed.
- FormData requests must let the browser set multipart Content-Type. Render imported content as text or sanitized content; never trust source/GM HTML.
- Use same-origin `/api`; builds and tests must never fall back to an old deployed backend.

## Verification

- Run meaningful behavior tests for new features and affected regressions. Tests use an explicitly isolated database and mock external boundaries; live checks are reported separately.
- ESLint, TypeScript and Prettier are separate checks. `npm run lint` runs real ESLint, not a renamed typecheck. Keep checks free of warnings and fix problems rather than broadly disabling rules.
- Root commands: `npm run typecheck`, `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`, `npm test`, `npm run build`. Frontend browser tests use `npm run test:e2e --workspace rpg-fe-local`.
- Prettier matches Gylden Rune: semicolons, single quotes, 100-column width, two-space indentation and ES5 trailing commas. It formats; ESLint checks correctness. Keep `eslint-config-prettier` last to avoid conflicting formatting rules.
- A typecheck must include actual source files. This frontend's current tsconfig directly includes `src`, tests and config files, so `tsc --noEmit` is valid. If converted to project references, use `tsc -b`; do not leave a successful no-op check.
- Report actual commands/results and remaining setup gates in each app's `IMPLEMENTATION.md`. Mocked checks do not establish live provider, OCR or phone compatibility.
