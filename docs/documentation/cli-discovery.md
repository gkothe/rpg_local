# Local CLI discovery

The Windows detector resolves native executables and known JavaScript entrypoints directly. It does not execute `.cmd`, `.bat` or PowerShell wrappers. Discovery searches PATH, the current Node installation, user npm locations, native user installations and Codex desktop version directories.

Claude npm packages can supply either a native `bin/claude.exe` or a JavaScript entrypoint. Codex supports its desktop executable and npm `bin/codex.js` entrypoint. Custom installations can set an absolute `RPG_CLAUDE_BIN`, `RPG_CODEX_BIN` or `RPG_AGY_BIN` path to a supported executable or JavaScript entrypoint. Wrapper overrides are rejected.

Restart the app after changing environment settings. Refreshing diagnostics rescans the current process environment and known installation locations; it cannot replace an old process's inherited PATH.

An installed executable alone does not establish working gameplay. Diagnostics inspect required flags, isolation capabilities and available model configuration. Version differences produce compatibility warnings rather than an exact-version gameplay restriction. Authentication, quota and model entitlement may still fail when a request is made.

Model choices come from provider discovery or an explicit local `RPG_MODEL_CATALOG`. The frontend uses the catalog advertised by the backend. See the [installation guide](installation.md#install-an-ai-cli) for sign-in and setup, and [backend architecture](rpg-backend-architecture.md) for isolation and native tool transport.
