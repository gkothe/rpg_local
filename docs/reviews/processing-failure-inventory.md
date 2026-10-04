# Processing failure inventory — 2026-10-03

Scope: the checked-out backend processing pipeline, all literal Problem throw sites, shared response retries, native Claude/Codex/Antigravity tool boundaries and final transaction/error handling. This is a static inventory plus the verification described below, not a guarantee against every possible environment failure or model behavior.

The source catalog below includes non-gameplay routes so omissions remain visible. Multiple sites can intentionally use one code. Automatic retry means the shared generation response wrapper recognizes the code; it does not mean every route retries it. MCP tool errors can instead be returned to the model within the current turn. Dynamic codes, Zod errors, filesystem/network errors, PostgreSQL errors and plain Error throws require the additional categories below.

## Processing stages

| Stage                      | Failure possibilities                                                                                                                                                 | Current handling                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation and selection | Missing executable, obsolete discovery environment, incompatible CLI flags, login absent/expired, model or effort unavailable, broken model catalog                   | Discovery/setup errors; do not infer gameplay availability from version alone. User must repair installation/authentication where required. |
| Provider service           | Subscription quota exhausted, model service down, connection reset, provider rejects request, CLI crash                                                               | Nonzero subprocess exits become provider_failure; retry wrapper can repeat them twice. Native result error codes differ by adapter.         |
| Local process              | Spawn denied, invalid working directory, stdin closed early, invalid UTF-8/framing, malformed event JSON, premature exit, cancellation, child process cleanup failure | Spawn/protocol errors and cancellation paths; raw stderr is withheld. Generation has no app timeout/output cap.                             |
| Private MCP                | Bind/connect errors, invalid auth/host/origin/path/method/body, unregistered name, wrong server, bad arguments, missing/mismatched telemetry identity                 | Reject before dispatch. MCP handler returns isError to the model. Antigravity has extra envelope/telemetry gates.                           |
| Tool dispatch              | Invalid schema, unknown record/path, invalid cursor, changed request identity, cancelled or stale owner, rule context changed                                         | Validate owned registry and request identity. Frozen knowledge/rules reads and persisted roll specs preserve continuity.                    |
| Dice                       | Invalid count/sides/slot/specification, changed replay, skipped saved roll, unknown/duplicate roll interpretation                                                     | Persist faces independently; reject invalid requests/final interpretations. Valid retries reuse saved faces.                                |
| Final response             | Malformed JSON, wrong schema/version, absent narrative, invalid mutation, invented IDs, citation mismatch, invalid knowledge origin/evidence                          | Parse and validate before commit; eligible response failures get up to two repairs.                                                         |
| Memory/context             | Failed memory generation, malformed memory, compaction conflict, changed campaign/rules during generation                                                             | Context/revision ownership checks; final state is not committed on rejection. Full instruction text remains intact.                         |
| Persistence                | Missing migration, unavailable PostgreSQL, statement/constraint error, lock conflict, deadlock, disk full, lost commit acknowledgement                                | Transaction protects state; only selected missing-schema cases become actionable database_setup. Other exceptions may be generic.           |
| Browser/HTTP               | Connection loss, interrupted polling, stale campaign/revision, double submit, uncertain request outcome                                                               | Idempotent request IDs and state reload; never infer rollback from a lost response. Frontend-wide audit is outside this backend pass.       |
| Logging/cleanup            | Log directory permission/disk errors, locked temporary profile, cleanup errors                                                                                        | Prompt logging is awaited and can prevent generation. Provider cleanup differs; Antigravity preserves its primary failure.                  |

## Verified gaps and limitations

1. **Provider-specific repair classification:** codex_protocol and claude_dice_result are absent from the shared retry set. These codes mix protocol/terminal/quota/identity situations, so adding them wholesale would be unsafe. Classify specific recoverable cases separately.
2. **Different handling of invalid tool arguments:** Codex awaits dispatch and propagates dice_input/gameplay_arguments_invalid instead of returning a native tool success:false result. Those codes are not in the shared response retry set. Claude/Antigravity MCP returns isError to the model for dispatch rejection. This is a real recovery discrepancy, not permission to retry ownership or changed dice.
3. **Lost schema diagnostics:** processRunner wraps non-Problem exceptions from protocol callbacks as provider_protocol. Zod field paths are lost before responseRetryFeedback can use them. Keep safe field paths/codes, never raw rejected values.
4. **Missing newline:** processRunner only delivers newline-terminated protocol events. A valid last event at EOF without a newline remains in pending and is never delivered. Reproduction is recorded below.
5. **Failure recording can fail silently:** turns.ts swallows exceptions while persisting the failed turn; detached run calls also swallow rejections. A database outage can therefore hide the root error until lease/recovery handling runs. Do not claim that a failure status was persisted in that case.
6. **Operational errors are not automatically repairable model output:** prompt-log filesystem failures, MCP bind errors, database errors and cleanup failures are mostly outside the model repair contract. More retries cannot repair disk permissions, exhausted quota, authentication or missing migrations.

The inventory above describes the initial 2026-10-03 baseline. The confirmed gaps were addressed on 2026-10-04 as described below; it must not be read as the current unresolved issue list.

## Verification

- Previous corrected baseline: 123 backend tests passed, 55 optional tests explicitly skipped; typecheck/lint/build/format passed.
- Fresh actual Windows Codex synthetic v4 source-provenance scenario passed in 25.5 seconds: rules_search → rules_get → roll_dice; one validated source fact, one citation and one trusted roll. Default native test model gpt-5.6-sol, medium effort.
- Previous fresh actual Antigravity scenario passed in 21.0 seconds on gemini-3.8-flash-high/high.
- Live Claude remains deferred for weekly quota; existing synthetic adapter tests passed.
- The current inventory does not simulate every operating-system, disk, network or PostgreSQL outage and does not claim coverage from code-name references alone.

Additional focused reproductions (synthetic only):

- A Node child emitted a valid final JSON event without a newline; the current
  process runner delivered **zero** events. This confirms the EOF framing gap.
- A synthetic Codex JSON-RPC child requested owned dice with invalid arguments;
  its dispatch error propagated as `dice_input`, and shared automatic repair
  feedback was **null**. This confirms the invalid-argument recovery discrepancy.
- Direct classification checks returned null feedback for `codex_protocol` and
  `claude_dice_result`. These checks establish classification only, not whether a
  particular service/quota failure would recover after a retry.
- No private campaign or user database was changed by these reproductions.

## Corrections and verification — 2026-10-04

- The shared process runner now flushes a final newline-free event at EOF, in order,
  exactly once. Malformed EOF JSON still fails closed. Protocol Zod rejection
  retains safe field paths/codes without raw rejected values.
- Codex sends `success:false` for narrowly classified correctable owned-tool
  arguments (dice/schema/knowledge lookup/cursor), allowing correction in the same
  native turn with a new call ID. External names, identity changes, stale rules,
  saved-dice replay changes, cancellation and operational dispatch errors still
  terminate. Foreign tool names are classified as isolation errors before dispatch.
- Missing/incomplete provider output uses existing recoverable protocol/JSON codes
  where ownership is established. Identity/isolation cases retain their stop
  conditions. Claude and native Codex errors, native Antigravity failed results,
  ordinary Claude output and subprocess exits distinguish login/quota from
  recoverable provider failure, without returning raw diagnostics. No blanket
  retry of provider-specific error codes was added.
- Failed-turn persistence and detached-run errors now emit safe structured terminal
  diagnostics (stage/code/turn ID). Database outages cannot guarantee a failed-turn
  record; diagnostics remain observable and normal lease recovery remains intact.
- Storage-full, permission, missing-migration and connection errors have safe
  actionable messages in turn processing and the HTTP boundary. Prompt logging
  failures explicitly identify the log-folder action, never silently skipping the
  requested prompt log.
- Codex (both launch paths) and Claude cleanup preserve the primary generation or
  cancellation failure; cleanup itself is reported. A cleanup failure following a
  successful generation remains explicit. Existing Antigravity primary-error and
  temporary-profile protections are retained.

Verification: **142 backend tests passed, 55 optional skips, zero failures**. The
19 additional regression cases exercise EOF framing, invalid JSON, validation
feedback privacy, login/quota, Codex same-turn correction and non-correctable
boundaries, persistence failure observability, cleanup, prompt logs and operational
messages. The first five reproductions failed before their fixes. Typecheck,
zero-warning ESLint and build passed. Real synthetic Windows native checks passed
again: Codex gpt-5.6-sol/medium in 23.7 seconds and Antigravity
gemini-3.8-flash-high/high in 24.5 seconds, each doing
rules_search → rules_get → roll_dice with one source fact and citation. Live Claude
is still deferred for weekly quota; synthetic Claude tests pass. No user campaign
was modified. No migration is required.

This does not promise that every operating-system, account or provider failure can
be recovered automatically. The actual cause must be resolved for login, exhausted
quota, unavailable PostgreSQL, missing migrations, storage or file permissions.

## Literal error-code source catalog

Updated from the current source after remediation.

| Code                          | HTTP status | Shared automatic repair | Source                                                                                                              |
| ----------------------------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/app.ts:99](../../rpg_be_local/src/app.ts#L99)                                                     |
| `upload_required`             | 422         | No                      | [rpg_be_local/src/app.ts:241](../../rpg_be_local/src/app.ts#L241)                                                   |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/app.ts:251](../../rpg_be_local/src/app.ts#L251)                                                   |
| `upload_required`             | 422         | No                      | [rpg_be_local/src/app.ts:268](../../rpg_be_local/src/app.ts#L268)                                                   |
| `rules_reference_resolved`    | 409         | No                      | [rpg_be_local/src/app.ts:315](../../rpg_be_local/src/app.ts#L315)                                                   |
| `rules_files_missing`         | 422         | No                      | [rpg_be_local/src/app.ts:446](../../rpg_be_local/src/app.ts#L446)                                                   |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/app.ts:881](../../rpg_be_local/src/app.ts#L881)                                                   |
| `validation`                  | 422         | No                      | [rpg_be_local/src/app.ts:901](../../rpg_be_local/src/app.ts#L901)                                                   |
| `upload_limit`                | 413         | No                      | [rpg_be_local/src/app.ts:908](../../rpg_be_local/src/app.ts#L908)                                                   |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/config.ts:12](../../rpg_be_local/src/config.ts#L12)                                               |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/config.ts:22](../../rpg_be_local/src/config.ts#L22)                                               |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/config.ts:28](../../rpg_be_local/src/config.ts#L28)                                               |
| `dice_references`             | 502         | Eligible                | [rpg_be_local/src/domain/diceResponse.ts:43](../../rpg_be_local/src/domain/diceResponse.ts#L43)                     |
| `knowledge_invalid`           | 422         | Eligible                | [rpg_be_local/src/domain/knowledge.ts:122](../../rpg_be_local/src/domain/knowledge.ts#L122)                         |
| `knowledge_not_found`         | 404         | No                      | [rpg_be_local/src/domain/knowledgeRecall.ts:141](../../rpg_be_local/src/domain/knowledgeRecall.ts#L141)             |
| `knowledge_cursor`            | 422         | No                      | [rpg_be_local/src/domain/knowledgeRecall.ts:159](../../rpg_be_local/src/domain/knowledgeRecall.ts#L159)             |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/domain/responseRetry.ts:39](../../rpg_be_local/src/domain/responseRetry.ts#L39)                   |
| `rules_citations_invalid`     | 502         | Eligible                | [rpg_be_local/src/domain/ruleCitationValidation.ts:13](../../rpg_be_local/src/domain/ruleCitationValidation.ts#L13) |
| `invalid_operation`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:70](../../rpg_be_local/src/domain/state.ts#L70)                                   |
| `invalid_operation`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:72](../../rpg_be_local/src/domain/state.ts#L72)                                   |
| `invalid_operation`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:83](../../rpg_be_local/src/domain/state.ts#L83)                                   |
| `invalid_operation`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:92](../../rpg_be_local/src/domain/state.ts#L92)                                   |
| `invalid_operation`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:107](../../rpg_be_local/src/domain/state.ts#L107)                                 |
| `knowledge_invalid`           | 422         | Eligible                | [rpg_be_local/src/domain/state.ts:139](../../rpg_be_local/src/domain/state.ts#L139)                                 |
| `conflict`                    | 409         | No                      | [rpg_be_local/src/errors.ts:10](../../rpg_be_local/src/errors.ts#L10)                                               |
| `provider_quota`              | 503         | No                      | [rpg_be_local/src/processingErrors.ts:6](../../rpg_be_local/src/processingErrors.ts#L6)                             |
| `provider_auth`               | 503         | No                      | [rpg_be_local/src/processingErrors.ts:16](../../rpg_be_local/src/processingErrors.ts#L16)                           |
| `provider_failure`            | 502         | Eligible                | [rpg_be_local/src/processingErrors.ts:21](../../rpg_be_local/src/processingErrors.ts#L21)                           |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/processingErrors.ts:31](../../rpg_be_local/src/processingErrors.ts#L31)                           |
| `local_service`               | 503         | No                      | [rpg_be_local/src/processingErrors.ts:37](../../rpg_be_local/src/processingErrors.ts#L37)                           |
| `local_storage`               | 503         | No                      | [rpg_be_local/src/processingErrors.ts:43](../../rpg_be_local/src/processingErrors.ts#L43)                           |
| `local_permissions`           | 503         | No                      | [rpg_be_local/src/processingErrors.ts:49](../../rpg_be_local/src/processingErrors.ts#L49)                           |
| `local_service`               | 503         | No                      | [rpg_be_local/src/processingErrors.ts:54](../../rpg_be_local/src/processingErrors.ts#L54)                           |
| `provider_cleanup`            | 503         | No                      | [rpg_be_local/src/processingErrors.ts:80](../../rpg_be_local/src/processingErrors.ts#L80)                           |
| `provider_contract`           | 422         | No                      | [rpg_be_local/src/providers/adapters.ts:59](../../rpg_be_local/src/providers/adapters.ts#L59)                       |
| `provider_unknown`            | 422         | No                      | [rpg_be_local/src/providers/adapters.ts:60](../../rpg_be_local/src/providers/adapters.ts#L60)                       |
| `provider_isolation`          | 502         | No                      | [rpg_be_local/src/providers/adapters.ts:76](../../rpg_be_local/src/providers/adapters.ts#L76)                       |
| `provider_budget`             | 502         | No                      | [rpg_be_local/src/providers/adapters.ts:85](../../rpg_be_local/src/providers/adapters.ts#L85)                       |
| `provider_isolation`          | 502         | No                      | [rpg_be_local/src/providers/adapters.ts:105](../../rpg_be_local/src/providers/adapters.ts#L105)                     |
| `provider_failure`            | 502         | Eligible                | [rpg_be_local/src/providers/adapters.ts:111](../../rpg_be_local/src/providers/adapters.ts#L111)                     |
| `provider_isolation`          | 502         | No                      | [rpg_be_local/src/providers/adapters.ts:117](../../rpg_be_local/src/providers/adapters.ts#L117)                     |
| `provider_budget`             | 502         | No                      | [rpg_be_local/src/providers/adapters.ts:120](../../rpg_be_local/src/providers/adapters.ts#L120)                     |
| `provider_json`               | 502         | Eligible                | [rpg_be_local/src/providers/adapters.ts:143](../../rpg_be_local/src/providers/adapters.ts#L143)                     |
| `catalog_setup`               | 503         | No                      | [rpg_be_local/src/providers/antigravity.ts:72](../../rpg_be_local/src/providers/antigravity.ts#L72)                 |
| `provider_isolation`          | 503         | No                      | [rpg_be_local/src/providers/antigravity.ts:106](../../rpg_be_local/src/providers/antigravity.ts#L106)               |
| `provider_contract`           | 422         | No                      | [rpg_be_local/src/providers/antigravity.ts:138](../../rpg_be_local/src/providers/antigravity.ts#L138)               |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityDice.ts:60](../../rpg_be_local/src/providers/antigravityDice.ts#L60)         |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityDice.ts:72](../../rpg_be_local/src/providers/antigravityDice.ts#L72)         |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityDice.ts:81](../../rpg_be_local/src/providers/antigravityDice.ts#L81)         |
| `dice_protocol`               | 502         | Eligible                | [rpg_be_local/src/providers/antigravityDice.ts:92](../../rpg_be_local/src/providers/antigravityDice.ts#L92)         |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:66](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L66)   |
| `rules_calls_exhausted`       | 422         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:88](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L88)   |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:152](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L152) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:160](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L160) |
| `context_overflow`            | 422         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:190](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L190) |
| `gameplay_tool_arguments`     | 422         | Eligible                | [rpg_be_local/src/providers/antigravityMcpBook.ts:242](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L242) |
| `gameplay_tool_arguments`     | 422         | Eligible                | [rpg_be_local/src/providers/antigravityMcpBook.ts:254](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L254) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:268](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L268) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:279](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L279) |
| `rules_calls_exhausted`       | 422         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:285](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L285) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:316](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L316) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:343](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L343) |
| `provider_json`               | 502         | Eligible                | [rpg_be_local/src/providers/antigravityMcpBook.ts:354](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L354) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:362](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L362) |
| `dice_protocol`               | 502         | Eligible                | [rpg_be_local/src/providers/antigravityMcpBook.ts:372](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L372) |
| `antigravity_cleanup`         | 500         | No                      | [rpg_be_local/src/providers/antigravityMcpBook.ts:404](../../rpg_be_local/src/providers/antigravityMcpBook.ts#L404) |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/claudeDice.ts:138](../../rpg_be_local/src/providers/claudeDice.ts#L138)                 |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/claudeDice.ts:151](../../rpg_be_local/src/providers/claudeDice.ts#L151)                 |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/claudeDice.ts:154](../../rpg_be_local/src/providers/claudeDice.ts#L154)                 |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/claudeDice.ts:166](../../rpg_be_local/src/providers/claudeDice.ts#L166)                 |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/claudeDice.ts:186](../../rpg_be_local/src/providers/claudeDice.ts#L186)                 |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/claudeDice.ts:221](../../rpg_be_local/src/providers/claudeDice.ts#L221)                 |
| `codex_login`                 | 503         | No                      | [rpg_be_local/src/providers/codex.ts:110](../../rpg_be_local/src/providers/codex.ts#L110)                           |
| `codex_catalog`               | 503         | No                      | [rpg_be_local/src/providers/codex.ts:131](../../rpg_be_local/src/providers/codex.ts#L131)                           |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/codex.ts:218](../../rpg_be_local/src/providers/codex.ts#L218)                           |
| `codex_model`                 | 422         | No                      | [rpg_be_local/src/providers/codex.ts:222](../../rpg_be_local/src/providers/codex.ts#L222)                           |
| `codex_auth_link`             | 503         | No                      | [rpg_be_local/src/providers/codex.ts:237](../../rpg_be_local/src/providers/codex.ts#L237)                           |
| `codex_cleanup`               | 500         | No                      | [rpg_be_local/src/providers/codex.ts:282](../../rpg_be_local/src/providers/codex.ts#L282)                           |
| `codex_model`                 | 422         | No                      | [rpg_be_local/src/providers/codexDice.ts:71](../../rpg_be_local/src/providers/codexDice.ts#L71)                     |
| `codex_auth_link`             | 503         | No                      | [rpg_be_local/src/providers/codexDice.ts:79](../../rpg_be_local/src/providers/codexDice.ts#L79)                     |
| `codex_cleanup`               | 500         | No                      | [rpg_be_local/src/providers/codexDice.ts:127](../../rpg_be_local/src/providers/codexDice.ts#L127)                   |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/codexDice.ts:232](../../rpg_be_local/src/providers/codexDice.ts#L232)                   |
| `gameplay_transport_conflict` | 409         | No                      | [rpg_be_local/src/providers/codexDice.ts:239](../../rpg_be_local/src/providers/codexDice.ts#L239)                   |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/codexDice.ts:287](../../rpg_be_local/src/providers/codexDice.ts#L287)                   |
| `context_overflow`            | 422         | No                      | [rpg_be_local/src/providers/codexDice.ts:302](../../rpg_be_local/src/providers/codexDice.ts#L302)                   |
| `codex_protocol`              | 502         | No                      | [rpg_be_local/src/providers/codexDice.ts:332](../../rpg_be_local/src/providers/codexDice.ts#L332)                   |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/codexDice.ts:340](../../rpg_be_local/src/providers/codexDice.ts#L340)                   |
| `provider_json`               | 502         | Eligible                | [rpg_be_local/src/providers/codexDice.ts:350](../../rpg_be_local/src/providers/codexDice.ts#L350)                   |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/codexDice.ts:365](../../rpg_be_local/src/providers/codexDice.ts#L365)                   |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/codexDice.ts:375](../../rpg_be_local/src/providers/codexDice.ts#L375)                   |
| `dice_rpc_identity`           | 409         | No                      | [rpg_be_local/src/providers/diceMcp.ts:31](../../rpg_be_local/src/providers/diceMcp.ts#L31)                         |
| `dice_isolation`              | 502         | No                      | [rpg_be_local/src/providers/diceProtocol.ts:54](../../rpg_be_local/src/providers/diceProtocol.ts#L54)               |
| `dice_limit`                  | 422         | No                      | [rpg_be_local/src/providers/diceProtocol.ts:56](../../rpg_be_local/src/providers/diceProtocol.ts#L56)               |
| `dice_input`                  | 422         | No                      | [rpg_be_local/src/providers/diceProtocol.ts:59](../../rpg_be_local/src/providers/diceProtocol.ts#L59)               |
| `dice_rpc_identity`           | 409         | No                      | [rpg_be_local/src/providers/diceProtocol.ts:65](../../rpg_be_local/src/providers/diceProtocol.ts#L65)               |
| `provider_setup`              | 503         | No                      | [rpg_be_local/src/providers/discovery.ts:29](../../rpg_be_local/src/providers/discovery.ts#L29)                     |
| `provider_setup`              | 503         | No                      | [rpg_be_local/src/providers/discovery.ts:35](../../rpg_be_local/src/providers/discovery.ts#L35)                     |
| `provider_setup`              | 503         | No                      | [rpg_be_local/src/providers/discovery.ts:39](../../rpg_be_local/src/providers/discovery.ts#L39)                     |
| `gameplay_schema`             | 503         | No                      | [rpg_be_local/src/providers/gameplayContract.ts:20](../../rpg_be_local/src/providers/gameplayContract.ts#L20)       |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/gameplayMcp.ts:89](../../rpg_be_local/src/providers/gameplayMcp.ts#L89)                 |
| `gameplay_tool`               | 422         | No                      | [rpg_be_local/src/providers/gameplayMcp.ts:91](../../rpg_be_local/src/providers/gameplayMcp.ts#L91)                 |
| `dice_limit`                  | 422         | No                      | [rpg_be_local/src/providers/gameplayMcp.ts:96](../../rpg_be_local/src/providers/gameplayMcp.ts#L96)                 |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:178](../../rpg_be_local/src/providers/gameplayTools.ts#L178)           |
| `gameplay_tool_invalid`       | 422         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:181](../../rpg_be_local/src/providers/gameplayTools.ts#L181)           |
| `gameplay_transport_conflict` | 409         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:191](../../rpg_be_local/src/providers/gameplayTools.ts#L191)           |
| `gameplay_calls_exhausted`    | 422         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:199](../../rpg_be_local/src/providers/gameplayTools.ts#L199)           |
| `gameplay_calls_exhausted`    | 422         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:208](../../rpg_be_local/src/providers/gameplayTools.ts#L208)           |
| `gameplay_arguments_invalid`  | 422         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:220](../../rpg_be_local/src/providers/gameplayTools.ts#L220)           |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/gameplayTools.ts:230](../../rpg_be_local/src/providers/gameplayTools.ts#L230)           |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/processRunner.ts:30](../../rpg_be_local/src/providers/processRunner.ts#L30)             |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/processRunner.ts:93](../../rpg_be_local/src/providers/processRunner.ts#L93)             |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/providers/processRunner.ts:103](../../rpg_be_local/src/providers/processRunner.ts#L103)           |
| `provider_timeout`            | 504         | No                      | [rpg_be_local/src/providers/processRunner.ts:108](../../rpg_be_local/src/providers/processRunner.ts#L108)           |
| `process_unavailable`         | 503         | No                      | [rpg_be_local/src/providers/processRunner.ts:114](../../rpg_be_local/src/providers/processRunner.ts#L114)           |
| `provider_output`             | 502         | No                      | [rpg_be_local/src/providers/processRunner.ts:125](../../rpg_be_local/src/providers/processRunner.ts#L125)           |
| `provider_output`             | 502         | No                      | [rpg_be_local/src/providers/processRunner.ts:146](../../rpg_be_local/src/providers/processRunner.ts#L146)           |
| `provider_protocol`           | 502         | Eligible                | [rpg_be_local/src/providers/processRunner.ts:166](../../rpg_be_local/src/providers/processRunner.ts#L166)           |
| `prompt_log`                  | 503         | No                      | [rpg_be_local/src/providers/promptLog.ts:49](../../rpg_be_local/src/providers/promptLog.ts#L49)                     |
| `catalog_setup`               | 503         | No                      | [rpg_be_local/src/providers/service.ts:141](../../rpg_be_local/src/providers/service.ts#L141)                       |
| `codex_version`               | 503         | No                      | [rpg_be_local/src/providers/service.ts:196](../../rpg_be_local/src/providers/service.ts#L196)                       |
| `provider_unavailable`        | 503         | No                      | [rpg_be_local/src/providers/service.ts:382](../../rpg_be_local/src/providers/service.ts#L382)                       |
| `model_unavailable`           | 422         | No                      | [rpg_be_local/src/providers/service.ts:389](../../rpg_be_local/src/providers/service.ts#L389)                       |
| `effort_unavailable`          | 422         | No                      | [rpg_be_local/src/providers/service.ts:391](../../rpg_be_local/src/providers/service.ts#L391)                       |
| `dice_provider`               | 503         | No                      | [rpg_be_local/src/providers/service.ts:459](../../rpg_be_local/src/providers/service.ts#L459)                       |
| `dice_model`                  | 503         | No                      | [rpg_be_local/src/providers/service.ts:466](../../rpg_be_local/src/providers/service.ts#L466)                       |
| `rules_provider_unavailable`  | 503         | No                      | [rpg_be_local/src/providers/service.ts:481](../../rpg_be_local/src/providers/service.ts#L481)                       |
| `rules_dispatch`              | 503         | No                      | [rpg_be_local/src/providers/service.ts:512](../../rpg_be_local/src/providers/service.ts#L512)                       |
| `gameplay_registry`           | 503         | No                      | [rpg_be_local/src/providers/service.ts:567](../../rpg_be_local/src/providers/service.ts#L567)                       |
| `gameplay_dispatch`           | 503         | No                      | [rpg_be_local/src/providers/service.ts:575](../../rpg_be_local/src/providers/service.ts#L575)                       |
| `dice_provider`               | 503         | No                      | [rpg_be_local/src/providers/service.ts:662](../../rpg_be_local/src/providers/service.ts#L662)                       |
| `host_denied`                 | 403         | No                      | [rpg_be_local/src/security.ts:17](../../rpg_be_local/src/security.ts#L17)                                           |
| `origin_denied`               | 403         | No                      | [rpg_be_local/src/security.ts:20](../../rpg_be_local/src/security.ts#L20)                                           |
| `client_header`               | 403         | No                      | [rpg_be_local/src/security.ts:23](../../rpg_be_local/src/security.ts#L23)                                           |
| `origin_required`             | 403         | No                      | [rpg_be_local/src/security.ts:29](../../rpg_be_local/src/security.ts#L29)                                           |
| `content_type`                | 415         | No                      | [rpg_be_local/src/security.ts:35](../../rpg_be_local/src/security.ts#L35)                                           |
| `desktop_only`                | 403         | No                      | [rpg_be_local/src/security.ts:68](../../rpg_be_local/src/security.ts#L68)                                           |
| `lan_disabled`                | 403         | No                      | [rpg_be_local/src/security.ts:74](../../rpg_be_local/src/security.ts#L74)                                           |
| `pairing_limit`               | 429         | No                      | [rpg_be_local/src/security.ts:78](../../rpg_be_local/src/security.ts#L78)                                           |
| `pairing_code`                | 403         | No                      | [rpg_be_local/src/security.ts:91](../../rpg_be_local/src/security.ts#L91)                                           |
| `pairing_required`            | 403         | No                      | [rpg_be_local/src/security.ts:117](../../rpg_be_local/src/security.ts#L117)                                         |
| `desktop_only`                | 403         | No                      | [rpg_be_local/src/security.ts:125](../../rpg_be_local/src/security.ts#L125)                                         |
| `source_reference`            | 422         | No                      | [rpg_be_local/src/services/campaigns.ts:85](../../rpg_be_local/src/services/campaigns.ts#L85)                       |
| `source_reference`            | 422         | No                      | [rpg_be_local/src/services/campaigns.ts:101](../../rpg_be_local/src/services/campaigns.ts#L101)                     |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/campaigns.ts:141](../../rpg_be_local/src/services/campaigns.ts#L141)                     |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/campaigns.ts:148](../../rpg_be_local/src/services/campaigns.ts#L148)                     |
| `character_capacity`          | 503         | No                      | [rpg_be_local/src/services/characterParser.ts:77](../../rpg_be_local/src/services/characterParser.ts#L77)           |
| `database_setup`              | 503         | No                      | [rpg_be_local/src/services/dice.ts:66](../../rpg_be_local/src/services/dice.ts#L66)                                 |
| `dice_inactive`               | 409         | No                      | [rpg_be_local/src/services/dice.ts:99](../../rpg_be_local/src/services/dice.ts#L99)                                 |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/services/dice.ts:101](../../rpg_be_local/src/services/dice.ts#L101)                               |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/services/dice.ts:106](../../rpg_be_local/src/services/dice.ts#L106)                               |
| `dice_session`                | 409         | No                      | [rpg_be_local/src/services/dice.ts:138](../../rpg_be_local/src/services/dice.ts#L138)                               |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/services/dice.ts:145](../../rpg_be_local/src/services/dice.ts#L145)                               |
| `dice_limit`                  | 422         | No                      | [rpg_be_local/src/services/dice.ts:152](../../rpg_be_local/src/services/dice.ts#L152)                               |
| `dice_input`                  | 422         | No                      | [rpg_be_local/src/services/dice.ts:155](../../rpg_be_local/src/services/dice.ts#L155)                               |
| `dice_character`              | 422         | No                      | [rpg_be_local/src/services/dice.ts:162](../../rpg_be_local/src/services/dice.ts#L162)                               |
| `dice_order`                  | 409         | No                      | [rpg_be_local/src/services/dice.ts:168](../../rpg_be_local/src/services/dice.ts#L168)                               |
| `dice_specification`          | 409         | No                      | [rpg_be_local/src/services/dice.ts:177](../../rpg_be_local/src/services/dice.ts#L177)                               |
| `dice_order`                  | 409         | No                      | [rpg_be_local/src/services/dice.ts:183](../../rpg_be_local/src/services/dice.ts#L183)                               |
| `dice_reroll`                 | 422         | No                      | [rpg_be_local/src/services/dice.ts:192](../../rpg_be_local/src/services/dice.ts#L192)                               |
| `dice_limit`                  | 422         | No                      | [rpg_be_local/src/services/dice.ts:199](../../rpg_be_local/src/services/dice.ts#L199)                               |
| `dice_limit`                  | 422         | No                      | [rpg_be_local/src/services/dice.ts:211](../../rpg_be_local/src/services/dice.ts#L211)                               |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:269](../../rpg_be_local/src/services/library.ts#L269)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:279](../../rpg_be_local/src/services/library.ts#L279)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:293](../../rpg_be_local/src/services/library.ts#L293)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:303](../../rpg_be_local/src/services/library.ts#L303)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:316](../../rpg_be_local/src/services/library.ts#L316)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:328](../../rpg_be_local/src/services/library.ts#L328)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:360](../../rpg_be_local/src/services/library.ts#L360)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:382](../../rpg_be_local/src/services/library.ts#L382)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:393](../../rpg_be_local/src/services/library.ts#L393)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:415](../../rpg_be_local/src/services/library.ts#L415)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:425](../../rpg_be_local/src/services/library.ts#L425)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:438](../../rpg_be_local/src/services/library.ts#L438)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:448](../../rpg_be_local/src/services/library.ts#L448)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:465](../../rpg_be_local/src/services/library.ts#L465)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:474](../../rpg_be_local/src/services/library.ts#L474)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:481](../../rpg_be_local/src/services/library.ts#L481)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:496](../../rpg_be_local/src/services/library.ts#L496)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:505](../../rpg_be_local/src/services/library.ts#L505)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:533](../../rpg_be_local/src/services/library.ts#L533)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:536](../../rpg_be_local/src/services/library.ts#L536)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:538](../../rpg_be_local/src/services/library.ts#L538)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:544](../../rpg_be_local/src/services/library.ts#L544)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:550](../../rpg_be_local/src/services/library.ts#L550)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:562](../../rpg_be_local/src/services/library.ts#L562)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:565](../../rpg_be_local/src/services/library.ts#L565)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:567](../../rpg_be_local/src/services/library.ts#L567)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:573](../../rpg_be_local/src/services/library.ts#L573)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:585](../../rpg_be_local/src/services/library.ts#L585)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:594](../../rpg_be_local/src/services/library.ts#L594)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:600](../../rpg_be_local/src/services/library.ts#L600)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:603](../../rpg_be_local/src/services/library.ts#L603)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:609](../../rpg_be_local/src/services/library.ts#L609)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:613](../../rpg_be_local/src/services/library.ts#L613)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:621](../../rpg_be_local/src/services/library.ts#L621)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:623](../../rpg_be_local/src/services/library.ts#L623)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:627](../../rpg_be_local/src/services/library.ts#L627)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:642](../../rpg_be_local/src/services/library.ts#L642)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:655](../../rpg_be_local/src/services/library.ts#L655)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:675](../../rpg_be_local/src/services/library.ts#L675)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:681](../../rpg_be_local/src/services/library.ts#L681)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:687](../../rpg_be_local/src/services/library.ts#L687)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:697](../../rpg_be_local/src/services/library.ts#L697)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:725](../../rpg_be_local/src/services/library.ts#L725)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:736](../../rpg_be_local/src/services/library.ts#L736)                         |
| `archive_invalid`             | 422         | No                      | [rpg_be_local/src/services/library.ts:757](../../rpg_be_local/src/services/library.ts#L757)                         |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/library.ts:925](../../rpg_be_local/src/services/library.ts#L925)                         |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/library.ts:944](../../rpg_be_local/src/services/library.ts#L944)                         |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/library.ts:1136](../../rpg_be_local/src/services/library.ts#L1136)                       |
| `rules_backup_size`           | 413         | No                      | [rpg_be_local/src/services/ruleBackup.ts:75](../../rpg_be_local/src/services/ruleBackup.ts#L75)                     |
| `rules_backup_size`           | 413         | No                      | [rpg_be_local/src/services/ruleBackup.ts:80](../../rpg_be_local/src/services/ruleBackup.ts#L80)                     |
| `rules_backup_invalid`        | 422         | No                      | [rpg_be_local/src/services/ruleBackup.ts:99](../../rpg_be_local/src/services/ruleBackup.ts#L99)                     |
| `rules_default_protected`     | 422         | No                      | [rpg_be_local/src/services/ruleLibrary.ts:24](../../rpg_be_local/src/services/ruleLibrary.ts#L24)                   |
| `rules_import_invalid`        | 422         | No                      | [rpg_be_local/src/services/ruleLibrary.ts:31](../../rpg_be_local/src/services/ruleLibrary.ts#L31)                   |
| `rules_preview_missing`       | 404         | No                      | [rpg_be_local/src/services/ruleLibrary.ts:91](../../rpg_be_local/src/services/ruleLibrary.ts#L91)                   |
| `rules_path_invalid`          | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:80](../../rpg_be_local/src/services/ruleLookup.ts#L80)                     |
| `rules_path_invalid`          | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:86](../../rpg_be_local/src/services/ruleLookup.ts#L86)                     |
| `rules_path_invalid`          | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:88](../../rpg_be_local/src/services/ruleLookup.ts#L88)                     |
| `rules_node_missing`          | 404         | No                      | [rpg_be_local/src/services/ruleLookup.ts:92](../../rpg_be_local/src/services/ruleLookup.ts#L92)                     |
| `rules_path_invalid`          | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:96](../../rpg_be_local/src/services/ruleLookup.ts#L96)                     |
| `cursor_expired`              | 409         | No                      | [rpg_be_local/src/services/ruleLookup.ts:158](../../rpg_be_local/src/services/ruleLookup.ts#L158)                   |
| `rules_context_changed`       | 409         | No                      | [rpg_be_local/src/services/ruleLookup.ts:164](../../rpg_be_local/src/services/ruleLookup.ts#L164)                   |
| `rules_cursor_invalid`        | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:166](../../rpg_be_local/src/services/ruleLookup.ts#L166)                   |
| `rules_request_limit`         | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:177](../../rpg_be_local/src/services/ruleLookup.ts#L177)                   |
| `rules_budget_exhausted`      | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:230](../../rpg_be_local/src/services/ruleLookup.ts#L230)                   |
| `rules_budget_exhausted`      | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:248](../../rpg_be_local/src/services/ruleLookup.ts#L248)                   |
| `rules_filter_invalid`        | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:270](../../rpg_be_local/src/services/ruleLookup.ts#L270)                   |
| `rules_filter_invalid`        | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:284](../../rpg_be_local/src/services/ruleLookup.ts#L284)                   |
| `rules_budget_exhausted`      | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:398](../../rpg_be_local/src/services/ruleLookup.ts#L398)                   |
| `rules_budget_exhausted`      | 422         | No                      | [rpg_be_local/src/services/ruleLookup.ts:409](../../rpg_be_local/src/services/ruleLookup.ts#L409)                   |
| `rules_preview_size`          | 413         | No                      | [rpg_be_local/src/services/rulePreview.ts:40](../../rpg_be_local/src/services/rulePreview.ts#L40)                   |
| `rules_preview_quota`         | 429         | No                      | [rpg_be_local/src/services/rulePreview.ts:47](../../rpg_be_local/src/services/rulePreview.ts#L47)                   |
| `rules_preview_missing`       | 404         | No                      | [rpg_be_local/src/services/rulePreview.ts:65](../../rpg_be_local/src/services/rulePreview.ts#L65)                   |
| `rules_reference_unresolved`  | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:56](../../rpg_be_local/src/services/ruleStore.ts#L56)                       |
| `rules_system_empty`          | 422         | No                      | [rpg_be_local/src/services/ruleStore.ts:70](../../rpg_be_local/src/services/ruleStore.ts#L70)                       |
| `rules_system_missing`        | 404         | No                      | [rpg_be_local/src/services/ruleStore.ts:97](../../rpg_be_local/src/services/ruleStore.ts#L97)                       |
| `rules_name_invalid`          | 422         | No                      | [rpg_be_local/src/services/ruleStore.ts:122](../../rpg_be_local/src/services/ruleStore.ts#L122)                     |
| `rules_context_changed`       | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:150](../../rpg_be_local/src/services/ruleStore.ts#L150)                     |
| `rules_transport_invalid`     | 422         | No                      | [rpg_be_local/src/services/ruleStore.ts:260](../../rpg_be_local/src/services/ruleStore.ts#L260)                     |
| `rules_context_missing`       | 422         | No                      | [rpg_be_local/src/services/ruleStore.ts:263](../../rpg_be_local/src/services/ruleStore.ts#L263)                     |
| `rules_inactive`              | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:285](../../rpg_be_local/src/services/ruleStore.ts#L285)                     |
| `rules_context_changed`       | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:291](../../rpg_be_local/src/services/ruleStore.ts#L291)                     |
| `rules_budget_exhausted`      | 422         | No                      | [rpg_be_local/src/services/ruleStore.ts:332](../../rpg_be_local/src/services/ruleStore.ts#L332)                     |
| `rules_inactive`              | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:333](../../rpg_be_local/src/services/ruleStore.ts#L333)                     |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/ruleStore.ts:378](../../rpg_be_local/src/services/ruleStore.ts#L378)                     |
| `rules_attempt_active`        | 409         | No                      | [rpg_be_local/src/services/ruleStore.ts:380](../../rpg_be_local/src/services/ruleStore.ts#L380)                     |
| `rules_upload_size`           | 413         | No                      | [rpg_be_local/src/services/ruleUpload.ts:24](../../rpg_be_local/src/services/ruleUpload.ts#L24)                     |
| `source_review`               | 422         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:21](../../rpg_be_local/src/services/sourceLibrary.ts#L21)               |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:54](../../rpg_be_local/src/services/sourceLibrary.ts#L54)               |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:69](../../rpg_be_local/src/services/sourceLibrary.ts#L69)               |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:85](../../rpg_be_local/src/services/sourceLibrary.ts#L85)               |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:99](../../rpg_be_local/src/services/sourceLibrary.ts#L99)               |
| `original_unavailable`        | 404         | No                      | [rpg_be_local/src/services/sourceLibrary.ts:105](../../rpg_be_local/src/services/sourceLibrary.ts#L105)             |
| `source_empty`                | 422         | No                      | [rpg_be_local/src/services/sources.ts:28](../../rpg_be_local/src/services/sources.ts#L28)                           |
| `source_limit`                | 413         | No                      | [rpg_be_local/src/services/sources.ts:30](../../rpg_be_local/src/services/sources.ts#L30)                           |
| `ocr_language`                | 422         | No                      | [rpg_be_local/src/services/sources.ts:48](../../rpg_be_local/src/services/sources.ts#L48)                           |
| `upload_limit`                | 413         | No                      | [rpg_be_local/src/services/sources.ts:49](../../rpg_be_local/src/services/sources.ts#L49)                           |
| `source_format`               | 415         | No                      | [rpg_be_local/src/services/sources.ts:56](../../rpg_be_local/src/services/sources.ts#L56)                           |
| `source_format`               | 415         | No                      | [rpg_be_local/src/services/sources.ts:61](../../rpg_be_local/src/services/sources.ts#L61)                           |
| `source_format`               | 415         | No                      | [rpg_be_local/src/services/sources.ts:70](../../rpg_be_local/src/services/sources.ts#L70)                           |
| `source_extraction`           | e.status    | No                      | [rpg_be_local/src/services/sources.ts:92](../../rpg_be_local/src/services/sources.ts#L92)                           |
| `source_extraction`           | 422         | No                      | [rpg_be_local/src/services/sources.ts:97](../../rpg_be_local/src/services/sources.ts#L97)                           |
| `source_url`                  | 422         | No                      | [rpg_be_local/src/services/sources.ts:111](../../rpg_be_local/src/services/sources.ts#L111)                         |
| `source_url`                  | 422         | No                      | [rpg_be_local/src/services/sources.ts:120](../../rpg_be_local/src/services/sources.ts#L120)                         |
| `source_url`                  | 422         | No                      | [rpg_be_local/src/services/sources.ts:123](../../rpg_be_local/src/services/sources.ts#L123)                         |
| `source_fetch`                | 422         | No                      | [rpg_be_local/src/services/sources.ts:136](../../rpg_be_local/src/services/sources.ts#L136)                         |
| `source_fetch`                | 422         | No                      | [rpg_be_local/src/services/sources.ts:143](../../rpg_be_local/src/services/sources.ts#L143)                         |
| `source_limit`                | 413         | No                      | [rpg_be_local/src/services/sources.ts:153](../../rpg_be_local/src/services/sources.ts#L153)                         |
| `audio_language`              | 422         | No                      | [rpg_be_local/src/services/sources.ts:194](../../rpg_be_local/src/services/sources.ts#L194)                         |
| `audio_setup`                 | 503         | No                      | [rpg_be_local/src/services/sources.ts:196](../../rpg_be_local/src/services/sources.ts#L196)                         |
| `rules_provider_unavailable`  | 503         | No                      | [rpg_be_local/src/services/turns.ts:87](../../rpg_be_local/src/services/turns.ts#L87)                               |
| `cancelled`                   | 409         | No                      | [rpg_be_local/src/services/turns.ts:206](../../rpg_be_local/src/services/turns.ts#L206)                             |
| `rules_context_changed`       | 409         | No                      | [rpg_be_local/src/services/turns.ts:256](../../rpg_be_local/src/services/turns.ts#L256)                             |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/services/turns.ts:460](../../rpg_be_local/src/services/turns.ts#L460)                             |
| `gameplay_unavailable`        | 503         | No                      | [rpg_be_local/src/services/turns.ts:467](../../rpg_be_local/src/services/turns.ts#L467)                             |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/services/turns.ts:531](../../rpg_be_local/src/services/turns.ts#L531)                             |
| `dice_replay`                 | 409         | No                      | [rpg_be_local/src/services/turns.ts:643](../../rpg_be_local/src/services/turns.ts#L643)                             |
| `rules_citations_invalid`     | 502         | Eligible                | [rpg_be_local/src/services/turns.ts:683](../../rpg_be_local/src/services/turns.ts#L683)                             |
| `memory_overflow`             | 422         | No                      | [rpg_be_local/src/services/turns.ts:812](../../rpg_be_local/src/services/turns.ts#L812)                             |
| `memory_coverage`             | 422         | No                      | [rpg_be_local/src/services/turns.ts:819](../../rpg_be_local/src/services/turns.ts#L819)                             |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/store.ts:39](../../rpg_be_local/src/store.ts#L39)                                                 |
| `rules_campaign_mirror`       | 503         | No                      | [rpg_be_local/src/store.ts:42](../../rpg_be_local/src/store.ts#L42)                                                 |
| `not_found`                   | 404         | No                      | [rpg_be_local/src/store.ts:97](../../rpg_be_local/src/store.ts#L97)                                                 |
| `dice_context`                | 409         | No                      | [rpg_be_local/src/store.ts:217](../../rpg_be_local/src/store.ts#L217)                                               |
| `source_index_changed`        | 503         | No                      | [rpg_be_local/src/store.ts:348](../../rpg_be_local/src/store.ts#L348)                                               |
