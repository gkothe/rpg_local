# Antigravity owned-tool routing correction — 2026-10-03

The rejected event at 18:41 São Paulo time named the allowed `rules_search` tool
directly, with a query argument, instead of using `call_mcp_tool` with the private
`local_rpg` server envelope. The transport rejected it before owned dispatch, but
classified it as `dice_isolation`. That classification intentionally disables
automatic repair, so an incorrect invocation of an allowed tool stopped gameplay.

Registered direct names now produce the existing recoverable
`gameplay_tool_unavailable` code with explicit gateway/server/name/argument guidance.
They remain rejected before dispatch. Genuine external names still produce
non-retryable isolation errors. No extra MCP, filesystem, shell or network access
was enabled. Native agent instructions contain the same invocation guidance.

Regression checks reproduce the observed direct-name event through the real process
and owned MCP boundary: the bad call dispatches nothing, the outer response retry
receives corrective guidance, and the next correctly framed call completes.
An external direct call remains blocked without retry. Existing saved-face and
ownership protections are unchanged.

Validation: 12 focused transport/retry checks passed; backend typecheck and zero-warning
lint passed. Default backend suite: 118 passed, 55 explicit optional skips, zero failures.
A real synthetic Antigravity book/dice check passed using the reported
`gemini-3.8-flash-high` model and `high` effort (25.3 seconds), followed by a search → original-text read → trusted dice native
scenario on the same model/effort (29.8 seconds). No turns were submitted
to the user's active campaign during this investigation.

## Follow-up transport and retry audit

Two additional defects were reproduced with five failing process/MCP tests before
changing the implementation:

- Invalid JSON strings, arrays and null in owned MCP `Arguments` either lost their
  specific repair guidance at the process boundary or raised a non-retryable rule
  error. They now raise `gameplay_tool_arguments`, a narrowly scoped recoverable
  code with object/schema/gateway guidance. Rejected inputs never reach dispatch.
  No blanket retry of ownership, isolation or database errors was introduced.
- A `DONE` event containing an envelope was accepted without checking its original
  dispatched identity. It now requires the same step index, owned tool and
  canonical arguments as a claimed request. Orphan and changed-envelope
  completions are rejected; valid repeated envelopes and omitted completion
  arguments continue working. Canonical comparison tolerates object-key ordering.

The audit also inspected Claude's exclusive MCP tool checks and Codex's native
thread/turn/tool identity checks. Existing synthetic tests for these transports,
registry ownership, saved faces and cancellation passed. No analogous confirmed
bug justified weakening those boundaries.

Validation after these changes: 27 focused tests passed; the default backend suite
passed 123 tests with 55 explicit optional skips and no failures. Backend
TypeScript, zero-warning ESLint and build passed. The five new tests failed against
the previous implementation and passed after correction. Fresh live Claude testing
remains deferred because its weekly subscription quota is exhausted.

A fresh live Antigravity check also passed on `gemini-3.8-flash-high` with `high` effort (21.0 seconds): `rules_search` → `rules_get` → `roll_dice`, producing one validated source fact, one citation and one trusted roll. Only synthetic material was used.
