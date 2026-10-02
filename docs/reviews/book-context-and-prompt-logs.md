# CLI capacity, response recovery and prompt logs

The user's latest policy supersedes the earlier 8KB/16K book-context limits. Campaign budgets are soft targets for optional retrieval and occasional memory compaction, never reasons to reject mandatory instructions, characters, pinned material or uncovered history. No authoritative content is truncated. Providers own context/output capacity, automatic native compaction and inference count; app generation subprocesses and the private MCP listener have no attempt deadline. Cancellation, ownership/revision guards, permitted tools, structured state validation and dice integrity remain required. Discovery diagnostics and non-AI input contracts remain separate.

System instructions are sent in full at each new player turn, alongside campaign instructions and canonical state. Initial prompts contain a small rule overview; original book sections are retrieved through owned tools rather than copying entire rule columns every turn.

The old app's `rpg_be/src/services/llm.js` made two attempts per OpenRouter model and then switched providers/models. This version automatically retries a rejected GM response up to twice on the selected CLI/model, with validation feedback. Malformed JSON, invalid final-schema fields, rejected citations/roll references/mutations and provider generation failures qualify. Cancellation, context changes, ownership conflicts and forbidden tools stop immediately. The same turn and frozen context are retained. Only the dice replay cursor is reset; saved faces stay append-only. Each retry replays original roll specifications. Rule transport receipts receive an attempt namespace. No game-state changes are committed before complete validation, and successful completion writes one snapshot atomically.

Live debugging also identified Antigravity's empty DONE/unknown marker. Only a marker containing non-action metadata is accepted; unknown events carrying commands, tools or content remain rejected. Final JSON validation exposes field paths without private values, providing useful repair feedback.

Prompt logging runs at each provider boundary, including native continuation prompts and correction feedback. Root `log/` is Git-ignored. Names are `YYYYMMdd__HHmmss__functionName.json`, with collision-safe numbered suffixes and an internal UTC timestamp. Logged data includes prompts, explicit system instructions and provider settings; credentials, process arguments, MCP authorization headers and environment are excluded. Write failures surface before the CLI call. Extra Antigravity final-response/unknown-event diagnostics aid local investigation. Logs contain private campaign and book material and must not be committed.

Verified checks: 91 backend tests passed with 43 environment-gated skips; 49 frontend unit tests and seven Windows Chrome play tests passed, including animated loading, editable draft and available Cancel. Separate temporary PostgreSQL testing passed seven dice lifecycle tests, including same-face automatic JSON recovery with one revision and snapshot, and eight campaign integration tests, including complete mandatory context above the soft target. Claude live testing remains on hold because the user's weekly quota is exhausted. Android and other operating systems remain deferred.

## Live campaign check

Three Antigravity Gemini 3.8 Flash High responses completed in campaign `d159a00a-d9a9-45b7-8732-1cd16f2bb223`:

- `a058c518-f545-42db-8ee8-efe27105e99c`: opening scene, saved Rouse Check and Hunger increase.
- `50076cc3-375d-4dc2-8873-9f0ba935db12`: questioning Flavius and a tool-rolled Insight check; a rejected response recovered automatically.
- `e2cd472c-a330-485a-9695-44eeb6cc392e`: continued guard/companion dialogue and a further recorded social check.

All three committed without a final error. Earlier failed/interrupted attempts remain audit and retain dice. No extra player actions remain running. Some GM rulings explicitly used provisional model adjudication after rule lookup difficulties; successful chat/roll transport does not establish perfect rule interpretation or guarantee retrieval for every question.
