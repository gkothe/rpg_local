# Running provider diagnostics — 2026-10-01

The user saw installed Codex and Antigravity marked gameplay-disabled in campaign setup.

The existing listener on port 4100 reported Codex installed but unsupported, with no model
choices and the older generic isolation message. That Node process was started before the
Codex adapter changes. Antigravity subsequently reported supported with seven model families
through the same running API, so its screenshot captured an earlier/transient diagnostic state.

A fresh `ProviderService.list(true)` using the current compiled backend reported:

- Claude: supported, three CLI model aliases.
- Codex 0.159.2: supported, four account-cache models.
- Antigravity 1.2.14: supported, seven model families.

This was discovery/isolation verification, not a live paid model invocation. No provider checks
were bypassed and no application code needed changing for this incident.

Stop the existing game server with Ctrl+C in its terminal, run root `start.cmd`, and reload the
browser. Refreshing provider diagnostics cannot replace JavaScript already loaded in a running
Node process. The prior automatic attempt to stop this server was rejected by approval review
with `blocked by policy`; it was not retried or bypassed.

After the user stopped that process, root `start.cmd` rebuilt and started the current application
successfully. The running API now reports all three providers supported: Claude has three aliases,
Codex 0.159.2 has eight current account-cache models, and Antigravity 1.2.14 has seven model
families. Codex's catalog is read from current metadata, so its count can change between probes.
The running audio diagnostics also report local transcription available.

Plan status: planned feature behavior is delivered, while physical Android device checks,
live Claude/Codex model entitlement and macOS/Linux compatibility remain explicitly unverified.
The plan/completion files retain historical publication and test-count statements; the current
repository is published, and latest verification is recorded in `backend-magic-values.md`.
