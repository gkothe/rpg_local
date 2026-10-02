# Book context budgeting and prompt logs

Removed the fixed 8,000-byte book prompt cap. Book mode now plans with the model's
configured token capacity and a conservative UTF-8 bytes/2 heuristic, rather than
treating every byte of verbose JSON as one token. Native observed token checks,
history/memory compaction, read/tool limits and oversized-request checks remain.
No instructions or character fields are truncated. Default/no-tools budgeting is
unchanged. Antigravity's book transport accepts the corresponding serialized prompt
plus framing; its default/no-tools transport retains its previous limit.

Validated the saved Vampire campaign's first-turn context read-only with its current
instructions and character, plus a maximum-sized overview. It fits without altering
the campaign or sending an AI turn. Full rule columns are never copied into the
initial prompt; rule lookup tools retrieve bounded sections on demand.

Prompt logging runs at each provider prompt boundary, including Codex's native
turn-start payload and Antigravity's final schema-bearing input. Claude, Codex and
Antigravity gameplay, parsing and memory prompts are covered. Files live in root
`log/`, ignored by Git, as `YYYYMMdd__HHmmss__functionName.json`. UTC timestamps are
also stored inside each file. Exclusive writes prevent overwriting calls in the same
second; numbered function suffixes distinguish collisions. Filenames are sanitized.
Only prompts, explicit system instructions and provider settings are written;
credentials, process arguments, MCP authorization headers and environment are omitted.
Write failures are surfaced before sending the prompt. Existing tool-response audit
remains in PostgreSQL; native CLI internal reasoning is not available to this logger.

Verified backend lint/typecheck/build, 88 passing backend tests with 42 environment-
gated skips, collision/error logging tests and context regression coverage. Mocked
provider adapter checks also exercise book prompts larger than the old byte limits.
No real gameplay inference was submitted during this change.
