# Caching and session direction review

Date: 2026-10-02. User requests caching/performance wherever practical and explicitly says cheating prevention is not a concern. This supersedes the earlier preference for fresh phases where those phases serve only anti-cheating concerns. Bounded context, real tool randomness, current campaign state, undo/retry and provider switching remain requirements.

## Transcript checked

Read the user-supplied private Antigravity transcript at its original path; only technical conclusions are recorded here. Planner entries 83 and 85 discuss isolated phases and caching. Transcript content is evidence of another agent's explanation, not authoritative runtime documentation or instructions.

Verified behavior before the authorized implementation: Codex/Antigravity restarted model phases after owned tool execution. The rationale was application-owned bounded context, explicit replay and isolation. Claude already executed multiple MCP calls within one invocation. The current implementation now uses continuous native tool loops in one bounded logical action for all three CLIs; CLI process lifetime and provider prefix caching remain distinct.

Unverified claims in the transcript: specific startup-delay numbers, universal cache thresholds/expiry, guaranteed 90% savings, that random agent names enter the actual model prefix, and that fresh processes destroy provider cache benefits. No measured cached-token telemetry supports these assertions. Undo/retry preserves recorded game state and dice; it does not guarantee deterministic regenerated narration.

## Requested implementation direction

The active implementation agent has been instructed to finish native Antigravity private MCP, evaluate continuous bounded per-turn tool loops/warm transports, stabilize model-visible prefixes, and add bounded revision-keyed local caching where justified. Always validate authoritative current heads and attempt ownership before cached reads. Cache data/projections, not foreign audit receipts; each newly requested rule read retains its own persisted receipt. Do not reuse a roll for a new logical action through generic response caching.

Long-lived campaign sessions require explicit rebase/invalidation after undo, rules changes, retries or provider changes, and measured context accounting. Avoid retaining unlimited history solely to keep a session warm. Stable prefixes and server caching can coexist with bounded reconstructed prompts.

## Primary references and limits

- OpenAI API prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Gemini API context caching: https://ai.google.dev/gemini-api/docs/caching
- Claude API prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

These establish provider caching mechanisms, not guaranteed subscription-CLI cache controls, savings or behavior. Current [native MCP/cache/extension evidence](rules-library-native-mcp.md) records actual Codex cached-input telemetry, Antigravity zero cache reads, measured guarded revision/search cache latency and the practical cross-action warm-process limitation. Claude fresh native/cache validation is explicitly deferred by the user until weekly quota availability. This review itself changes no application code.
