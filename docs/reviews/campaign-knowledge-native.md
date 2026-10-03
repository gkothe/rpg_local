# Campaign knowledge verification

Windows acceptance, 2026-10-03. Tests use synthetic material and disposable state;
the user's active campaigns are not played or modified.

## Native CLI checks

`knowledge.native.test.ts`, opt-in `RPG_KNOWLEDGE_NATIVE=1`:

- Codex / `gpt-5.6-sol` / medium passed two fresh actions. The first saved one
  GM-created place and a unique password. The second received no transcript,
  memory or inline registry and recovered it through `campaign_knowledge_search`
  then `campaign_knowledge_get`, followed by one genuine `roll_dice` call. The
  final v4 response acknowledged the returned roll ID. Duration: 26.2 seconds.
- Antigravity / `gemini-3.8-flash` / medium passed the same two-action scenario
  in 44.4 seconds. An initial attempt failed during private profile cleanup with
  Windows `EBUSY` on an updater lock; bounded retry of transient cleanup errors
  corrected it. The fresh run, rather than that failing attempt, is the evidence.
- Separate v4 book checks passed for Codex (24.5 seconds) and Antigravity
  (18.7 seconds). Each called `rules_get` then `roll_dice`, returned one citation
  and one source-derived knowledge record, and passed original-receipt validation.
- Antigravity's optional MCP-only discovery experiment failed both fresh scenarios
  after removing textual argument schemas: an unavailable tool in the no-library
  flow (76.1 seconds), and a tool outside the private MCP in book mode (37.1 seconds).
  The textual schemas are therefore retained as one canonical registry-derived
  block. Removing them is not a verified optimization. This does not restore the
  duplicated generic narrator policy removed from the normal v4 envelope.
- Claude live acceptance remains deferred because the user's weekly quota is
  exhausted. Mocked transport checks cover v4 routing, not live model behavior.

## Integration checks

- Fresh isolated PostgreSQL 18 on loopback port 55439, database `rpg_local_test`:
  migrations 0001–0008 applied successfully. Initial full backend run: 138 passed,
  14 explicitly skipped optional checks; feature tests still being completed.
- Frontend: 13 files / 50 tests passed, including safe literal knowledge changes
  and composer preservation when switching tabs.
- Installed Windows Chrome: 13 browser checks passed; 6 optional environment
  checks were explicitly skipped. Android and macOS/Linux are not acceptance gates.

This report is updated with final results before implementation handoff.
