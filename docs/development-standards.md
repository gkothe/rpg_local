# Development standards adopted from Gylden Rune

Reviewed the main Gylden Rune `CLAUDE.md`/`AGENTS.md`, both app `CLAUDE.md` files, both ESLint configurations, package scripts, Prettier settings and the frontend Oxlint configuration on 2026-09-30. The source checkouts were not changed.

## Tooling

Both Gylden apps share the same Prettier policy, now declared once in this repository's `.prettierrc.json`: semicolons, single quotes, 100 columns, two spaces, ES5 trailing commas. `.editorconfig` establishes UTF-8/LF and final newlines; generated files and private runtime data are excluded from formatting.

Both apps use ESLint's JavaScript and TypeScript recommended rules, with `eslint-config-prettier` last. The frontend also checks React hook usage/dependencies and Fast Refresh exports. New code keeps strict types and zero lint warnings; Gylden's warning severity accommodates its legacy code and is not needed as a starting policy here.

ESLint 10 uses a Node 22.13+ baseline, verified against official npm package metadata along with the TypeScript and React plugins' peer compatibility. Versions are resolved in the root lockfile; we do not copy Gylden's entire dependency tree or its old peer-dependency workaround. Oxlint exists in Gylden FE, but its npm lint script runs ESLint. This repo uses ESLint as the authoritative check instead of adding a second overlapping linter.

Root scripts run the corresponding app checks. Type checking, linting, formatting, behavior tests and builds remain distinct, so none can silently stand in for another. Agents format their own files while implementation is active; the root format command is available for the whole checkout once coordinated.

## Architecture and workflow

Adopted: thin routes, service/domain behavior, backend-owned option sets and capabilities, named domain constants, sequential application I/O, locked transactional mutations, immutable migrations, UTC instants, isolated test databases, meaningful regression tests and concise maintained project memory.

Frontend guidance is adapted to the dark journal: links for navigation, mobile form stacking and wrapping lists, save feedback without losing the entity, resettable dialog drafts, preserved edits during polling, stable idempotency keys for uncertain replies, synchronous in-flight guards and stale-response protection. Uploads leave multipart headers to the browser; imported content is untrusted.

Each app has its own `CLAUDE.md` for verified local gotchas. Root `AGENTS.md` directs harnesses to the root and relevant app memory without duplicating the rule body. Investigation/review reports belong in `docs/reviews/`, the monorepo equivalent of Gylden's shared `mds/`.

## App-specific rules that do not transfer

Gylden's fiscal, commerce, financial arithmetic, MUI widget and Brazilian decimal-format rules describe its business application. This English RPG uses its own UI and domain. Authentication shortcuts, raw database-error disclosure, missing validation, special route wrappers, production backend selection and destructive test-database reset scripts are not adopted. The RPG validates boundaries, sanitizes internal errors and defaults to local services.

The Gylden frontend requires `tsc -b` because its empty root tsconfig uses project references. The RPG frontend currently directly includes its source and tests, so `tsc --noEmit` checks those files. If that configuration changes, the command must change with it.

## Validation snapshot

On 2026-09-30, root `npm run typecheck`, `npm run lint` (zero warnings), `npm run format:check` and `npm test` passed across both apps. Tests at this checkpoint: seven backend boundary/state tests and eight frontend tests. Dependency installation completed with zero npm audit vulnerabilities. These checks establish tooling and the tested behavior at this snapshot; implementation continues and live CLI/OCR/phone checks remain separate.
