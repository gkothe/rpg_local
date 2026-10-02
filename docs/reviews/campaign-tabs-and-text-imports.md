# Campaign settings tab and direct text imports

System rules and CLI/model/effort settings now live in a Game master campaign tab. The panel
remains mounted while hidden, preserving component state. Composer drafts persist when changing
tabs and providers. The new campaign screen retains its settings controls.

All successfully imported documents (UTF-8 text/Markdown, PDFs, Google Docs and pasted text) now
create confirmed sources directly. No extra confirmation request or version bump is needed.
Blank, malformed and oversized inputs retain existing rejection. Optional review/correction
and explicit draft API support remain available. Confirmed rows offer View / edit text. Character
parsing and final Add character remain explicit actions.

Sources offers Add source to open a separate import view and Back to sources to return. The
hidden view remains mounted, preserving unfinished text and file selection. Existing user uploads
were activated under campaign revision/row locks with active-turn checks and canonical reindexing:
one local campaign, two sources; source text was unchanged. No schema migration was needed.

Checks passed: root lint, typecheck and build; 41 frontend unit tests; 83 backend tests (42 gated
skips); 7 targeted Windows Chrome browser tests, covering tab visibility, preserved drafts,
immediately usable import display, optional PDF editing, gameplay, saved dice retry and undo.
Live provider/OCR and environment-gated integration tests were not run for this change.
Documentation and gated browser selectors were updated to the new tab flow.
