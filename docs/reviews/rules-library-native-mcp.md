# Native MCP and caching verification

Date: 2026-10-02. This replaces the production JSON phase strategy following the user's explicit preference for native tools and caching. Earlier rejected Antigravity JSON probes remain historical failures; they are not the transport now enabled.

Claude retains its existing continuous private HTTP MCP conversation. Codex replies to pending native dynamic calls with the installed 0.159.2 `DynamicToolCallResponse` schema (`contentItems: inputText`, `success`) and continues the same ephemeral thread/turn. Antigravity 1.2.14 uses its actual HTTP MCP gateway, an owned temporary USERPROFILE, exact private MCP permissions, empty native tool list and excluded ambient customizations. Existing subscription authentication works without copying credentials or editing shared CLI settings. The stable private agent name and instruction/tool-schema body are reused; random endpoint credentials remain in transport configuration. No claim is made that these configuration values previously appeared in the model prefix.

Each logical action reconstructs authoritative application context. All tool continuations for that action share one bounded native invocation. Existing time, protocol-byte, per-tool/combined call, input-window and output budgets remain enforced. Antigravity checks each reported inference window against 16000 input tokens and 2048 output tokens, with at most 25 inferences; its aggregate input total may exceed one window. Codex retains its 128000-token window, 2048-token inference output and 25-inference limits. Fresh native turns rebase after retry, undo, provider/rule changes; provider history is never the sole campaign state. There is no process pool across logical actions. Codex can create additional threads in an app-server process, but shared process/authentication lifetime and concurrent campaign event routing have not been implemented or certified. Antigravity cross-action reset/continuation is unverified. These are implementation limits, not claims that fresh processes prevent server caching.

## Actual Windows evidence

All gameplay fixtures below contain original synthetic text and use isolated PostgreSQL schemas on the owned loopback test cluster. Direct probes do not substitute for the full campaign scenario.

| Check                                                                  | Result                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex medium actual rule → dice → rule → v3, continuous native replies | Passed, 28.272 s; two persisted reads and one persisted genuine roll.                                                                                                                |
| Antigravity low actual private MCP direct probe                        | Passed, 17.050 s and 22.699 s.                                                                                                                                                       |
| Claude → Antigravity low complete campaign                             | Passed, 50.629 s.                                                                                                                                                                    |
| Codex → Antigravity low complete campaign                              | Passed, 40.119 s.                                                                                                                                                                    |
| Antigravity medium direct native probe                                 | Passed, 26.792 s.                                                                                                                                                                    |
| Codex → Antigravity medium complete campaign                           | Passed, 46.728 s and 45.528 s.                                                                                                                                                       |
| Antigravity medium default dice → v2                                   | Passed, 13.300 s and 14.325 s, one persisted roll and no book reads.                                                                                                                 |
| Codex medium default dice → v2                                         | Passed, 10.200 s, one persisted roll and no book reads.                                                                                                                              |
| Native Codex against anonymous loopback Responses fixture              | Passed; two actual pending dynamic replies in one ephemeral turn, exact dice tool advertisement, no ambient instructions. This is runtime protocol evidence, not a live model claim. |

The complete campaign scenario rejects a final after late rule publication, retains failed read/roll audit, rejects explicit retry against the old head, switches provider and accepts a new action with the latest revision and literal citation. Antigravity native event metadata identified only `call_mcp_tool` for our named private server and allowed tools. Earlier JSON transport `manage_task` and `list_resources` events were actual intrinsic tools and were rejected; no broad tool-event allowlist was introduced.

Current exact book gates: Windows Claude 2.1.232/sonnet/medium, Codex 0.159.2/gpt-5.6-sol/medium, and Antigravity 1.2.14/gemini-3.8-flash/low or medium. Other combinations remain unverified. Claude's subsequent repeat attempts returned a pre-tool OAuth-expired diagnostic; no credential/configuration was changed. The user clarifies that the weekly subscription allowance is exhausted and explicitly defers fresh Claude validation as a TODO until quota is available. No re-login requirement or scheduled retry is asserted. Earlier successful Claude acceptance is retained as historical evidence, not a fresh authenticated run.

One medium campaign attempt coincided with isolated PostgreSQL recovery/ECONNRESET and failed; another under load failed CLI setup timeout before Antigravity tools. Neither counts as acceptance. Later full runs passed. The normal root regression rerun passed 110 backend tests (12 explicit opt-in skips) and 35 frontend tests. A sequential backend diagnostic run also passed. Skipped checks are not passed live runs.

## Measured caching

Codex's actual native `cachedInputTokens` telemetry included 3200, 3456 and 3584 tokens on continuations. Other accepted runs also reported zero for some continuations. Antigravity reported zero `cache_read_tokens` on every measured inference. Claude telemetry forwarding preserves reported `cacheReadInputTokens` when available; its fresh measurement is a user-deferred weekly-quota TODO. This is native telemetry, not a promise about subscription credits, cache prices or API billing.

The shared cache holds immutable rule snapshots per Store, keyed by system ID/revision/hash/kind. Every access first reads and locks the authoritative database head. Existing attempt ownership/cancellation checks and persist-before-reveal receipts remain outside the cache. A new requested read creates a fresh receipt. Limits are four snapshots and 64 MiB of serialized snapshot content; this bounds retained content, not exact JavaScript heap size. Search candidate caches hold at most eight queries/4096 hits per immutable snapshot; paging tokens and receipts are regenerated. Evicted snapshots and their weakly associated search data can be collected.

Thirty sequential Windows samples per fixture measured:

| Original fixture             | Uncached warm search p95 | Cold load/search p95 | Repeated cached query plus database-head check p95 |
| ---------------------------- | ------------------------ | -------------------- | -------------------------------------------------- |
| 596 nodes / 169823 bytes     | 0.891 ms                 | 3.368 ms             | 0.610 ms                                           |
| 10000 nodes / exactly 20 MiB | 48.629 ms                | 161.672 ms           | 0.749 ms                                           |

The last column cycles four primed queries and includes a transaction/shared head lock; the first two use distinct queries. This measures repeat-query benefit and is not a like-for-like speedup or cost ratio.

## Registering a future tool

`rpg_be_local/src/providers/gameplayTools.ts` owns `GameplayToolRegistration`: name, description, Zod argument schema, purpose, capability budget group and handler. Existing invalid-input handlers preserve persisted invalid-request audit. The registry derives JSON schemas, validates runtime arguments, serializes calls, binds request identity, guards cancellation/ownership and charges per-capability plus shared call/transcript budgets. Its dispatch function carries its exact definitions to the provider service. Claude MCP, Codex dynamic definitions and Antigravity MCP consume those definitions and dispatch names/arguments generically.

Register only an implemented handler in the explicit purpose set. Default gameplay currently exposes dice only; book gameplay exposes dice plus the four rule readers. The original `synthetic_echo(value)` test registration crossed an actual authenticated private MCP transport with no provider-specific name/parameter branches, rejected a foreign tool and extra arguments, and invoked its handler only for valid input. This synthetic tool is not installed or exposed in production. Native final response validation still owns the current v2/v3 campaign contracts; extending a product purpose or final contract requires an explicit application change.

Primary runtime references: [Antigravity MCP](https://antigravity.google/docs/mcp?tab=cli), [agent configuration](https://www.agy.dev/docs/subagents?tab=cli), [permissions](https://www.agy.dev/docs/permissions/), [headless event output](https://www.agy.dev/docs/cli/headless/). Codex response/usage schemas were generated read-only from the installed 0.159.2 executable into owned local TEMP.
