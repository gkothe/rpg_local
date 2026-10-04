# Flow copy and architecture follow-up, 2026-10-04

The humanizer pass revised all explanatory Flow copy into full, plain English sentences.
Technical field names remain where they connect the explanation to code. Exact prompts,
response schema, JSON fixtures and tool argument/result objects remain unchanged.

The follow-up compared all uncommitted files that affect the architecture. Provider changes
required updates to sections 2.3, 2.4, 2.5 and 3.3 of the architecture document and to Flow:

- Antigravity gateway routing, recoverable argument errors, and matching completion identity.
- Codex correction of selected tool arguments inside the native conversation.
- Final JSON protocol events without a newline and safe schema feedback.
- Account, migration, storage and permission diagnostics, including failure-recording outages.
- Prompt logging failures and preservation of the primary error during cleanup.

Existing contract checks confirm that prompt selection, the schema, fixed knowledge lookup,
example proposal and rule citation still match the backend. The API-contract additions about
saved context inspection describe an existing route and require no change to the teaching fixtures.
Concurrent backend and Journal edits were read but not changed by this pass.

Verification: seven Flow unit tests, four contract checks, 33 focused synthetic backend tests,
and five Chrome Flow browser scenarios passed. Frontend typecheck and zero-warning lint passed.
Browser checks include 360/768/1440px, keyboard navigation, pairing, and no campaign/provider
requests. These checks do not establish live provider or PostgreSQL outage behavior.
