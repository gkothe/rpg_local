# Local RPG frontend

React and TypeScript campaign journal built with Vite. It uses the backend's same-origin `/api`; provider credentials and database access stay on the Windows host.

Install and launch from the monorepo root. See the [project README](../README.md), [installation guide](../docs/documentation/installation.md), [HTTP contract](../docs/documentation/api-contract.md) and [working rules](CLAUDE.md).

Root scripts run checks for both workspaces. To target this workspace, use:

```powershell
npm.cmd run typecheck --workspace rpg-fe-local
npm.cmd run lint --workspace rpg-fe-local
npm.cmd test --workspace rpg-fe-local
npm.cmd run build --workspace rpg-fe-local
```

Use an isolated setup for opt-in database and live provider tests. Default tests use synthetic boundaries; read test requirements before enabling live checks.

Development uses loopback port 5174 and proxies to port 4100. The backend serves the production build. Do not expose the development proxy for LAN play; use the [LAN guide](../docs/documentation/lan-setup.md).

Install Playwright Chromium with `npx.cmd playwright install chromium`, then run `npm.cmd run test:e2e --workspace rpg-fe-local`. Live database, audio and LAN browser tests are opt-in; inspect their requirements and use an isolated setup. See [Android Chrome checks](../docs/documentation/android-chrome.md) for device validation.
