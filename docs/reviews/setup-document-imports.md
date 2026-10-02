# Campaign setup document imports

New campaign setup now exposes multiple campaign-file selection and a separate character-sheet
file selection, with public Google Docs links for both sections and backend-provided OCR languages.
It reuses the existing extraction routes. No new database schema or API is needed.

Files import sequentially after campaign creation, carrying each returned revision to the next
request. Sources stay unconfirmed. Character extraction remains an explicit operation after source
review, producing an editable draft requiring Add character. Failure stops the batch and exposes
the saved campaign for review; it cannot create another campaign or automatically retry an
uncertain import. Navigation away prevents subsequent queued uploads and redirects.

Verification: frontend lint, typecheck, formatting check, production build, 40 unit tests and
5 targeted Playwright tests passed. Browser tests used installed Windows Chrome through
LOCAL_BROWSER_PATH because the bundled Playwright browser was absent. They cover creation with
no uploads, separate campaign/character uploads, review, play/undo and existing responsive layout.
Unit tests cover ordered revisions, both Google Docs links, partial failure, unsupported files,
and unmount during creation. External OCR and CLI parsing were mocked; no live campaign or
provider subscription was used for these checks.
