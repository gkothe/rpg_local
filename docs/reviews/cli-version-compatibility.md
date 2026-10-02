# CLI version compatibility

Replace exact CLI-version rejection with an optional provider compatibility warning. Discovery
and runtime adapters must both accept untested versions. Keep required flags, native subscription
login, tool isolation, model context budgets, protocol validation and existing rulebook model/
effort limits. Tested version constants identify evidence baselines only.

Expose the warning in provider selection (setup and gameplay) and Settings. Existing turn errors
remain visible and failed responses cannot commit state. Acceptance checks: synthetic untested
CLI discovery/adapter tests, selectable warning-bearing provider UI, retained capability rejection,
lint/typecheck/build and affected test suites. No live Claude calls while weekly quota is exhausted.

## Verification

Removed discovery, dice-capacity and runtime adapter version rejections across all three CLIs.
Provider/model rulebook availability no longer compares CLI versions; existing supported models
and efforts remain unchanged. Provider selection and Settings display compatibilityWarning.
Existing visible turn errors and protocol validation remain in place.

Actual local discovery now reports Codex 0.159.0-alpha.12.1 supported=true, dice supported=true,
with its version warning and gpt-5.6-sol book support. This is a discovery check, not a live AI turn.
Synthetic tests cover the installed alpha version, untested Claude/Antigravity adapter responses,
selectable warning-bearing provider UI and browser rendering. Checks passed: root lint/typecheck/
build, 81 backend tests (42 environment-gated tests skipped), 41 frontend tests and 5 targeted
Windows Chrome browser tests. No database mutations or live Claude generation were performed.
