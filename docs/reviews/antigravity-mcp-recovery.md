# Antigravity MCP request recovery

The reported campaign's opening action failed with `Antigravity attempted a tool outside its private MCP` after saving a Rouse Check of 9. The original log did not capture the rejected tool envelope, so the precise requested server/tool cannot be recovered. A live saved-dice retry completed successfully in turn `c8feca0c-20c6-40bc-89a0-ec0511c94f56`, reusing that same 9; no extra player action was submitted.

Unavailable requests through the native `call_mcp_tool` gateway now produce the distinct recoverable `gameplay_tool_unavailable` problem. The CLI is terminated before granting access or dispatching the invalid request. Existing response recovery retries up to twice, naming the exact owned server/tools and retaining frozen context and saved dice. Native shell/file/other capability attempts remain non-retryable isolation failures. No tool permissions were expanded.

Tool completion metadata may omit its arguments. Such a DONE marker is accepted only when its gateway and step index match an already validated, dispatched owned tool call. An unmatched marker, changed explicit tool/server envelope or foreign native activity remains rejected. Local rejected-tool diagnostics are saved to Git-ignored `log/` using the existing naming convention.

Ten targeted tests passed, covering legitimate argument-free completion, foreign servers/tools and unmatched completions with zero dispatch, same-provider correction feedback, cancellation and isolation failures. Live recovery verified turn commit and preserved face, but did not reproduce the original rejected tool envelope. Future occurrences now have that diagnostic rather than only the generic error.
