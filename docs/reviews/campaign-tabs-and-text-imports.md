# Campaign settings tab and direct text imports

System rules and CLI/model/effort settings now live in a Game master campaign tab. The panel
remains mounted while hidden, preserving component state. Composer drafts persist when changing
tabs and providers. The new campaign screen retains its settings controls.

Valid UTF-8 .md/.markdown/.txt file extraction now creates a confirmed source directly, preserving
its text verbatim. No extra confirmation request or version bump is needed. Blank, malformed and
oversized inputs retain existing rejection. PDF conversion, Google Docs and pasted-source drafts
retain explicit review. Sources remain editable; confirmed rows offer View / edit text. Character
parsing and final Add character remain explicit actions. Previously saved drafts keep their state;
this change does not mass-confirm existing campaign documents.

Checks passed: root lint, typecheck and build; 41 frontend unit tests; 4 targeted backend tests;
6 targeted Windows Chrome browser tests, covering tab visibility, preserved drafts, direct-file
import display, PDF review, gameplay, saved dice retry and undo. Live database/provider/OCR and
environment-gated rules-library tests were not run for this change. Documentation and gated
browser selectors were updated to the new tab flow.
