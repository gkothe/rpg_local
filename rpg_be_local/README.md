# Local RPG backend

Express and TypeScript API with PostgreSQL persistence, migrations, local CLI adapters and app-owned gameplay tools.

Install and launch from the monorepo root. See the [project README](../README.md), [installation guide](../docs/documentation/installation.md), [HTTP contract](../docs/documentation/api-contract.md) and [working rules](CLAUDE.md).

Root scripts run checks for both workspaces. To target this workspace, use:

```powershell
npm.cmd run typecheck --workspace rpg-be-local
npm.cmd run lint --workspace rpg-be-local
npm.cmd test --workspace rpg-be-local
npm.cmd run build --workspace rpg-be-local
```

Use an isolated setup for opt-in database and live provider tests. Default tests use synthetic boundaries; read test requirements before enabling live checks.
