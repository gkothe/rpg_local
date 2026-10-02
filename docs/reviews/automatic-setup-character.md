# Automatic setup character import

Dedicated character file/Google Docs input now triggers existing extraction, selected CLI parsing
and character creation sequentially when creating a campaign. Existing backend character-drafts
validates AI output against the application sheet schema; characters creation applies it under
campaign revision checks. The backend-advertised default player type overrides any AI NPC role.
No new transport, provider integration, schema or migration is needed.

Setup identifies the character source from the new source ID, not a filename or a campaign
document. File and link are alternatives; supplying both is rejected before saving. A CLI/model
is required only when requesting automatic character import; campaign-only setup still works
without a CLI. Uploaded sheets are usable immediately and need no review or manual Add character.
AI/parser/save failure retains the campaign and source and shows the actual error, with no
automatic mutation retry or duplicate campaign creation. Navigation stops subsequent steps.

Character parsing uses the existing bounded no-tools prompt and selected campaign provider.
Large sheets or malformed AI results retain existing actionable errors. The manual additional
character draft/edit/Add workflow remains available. This implements player character creation;
it does not introduce a separate main-character database flag.

Verification: frontend lint, typecheck/build, unit tests and five targeted Windows Chrome browser
tests. Tests exercise file and Google Docs source IDs, exact parsed JSON persistence, forcing
player role, revision order, parsing failure, missing CLI, conflicting inputs and navigation.
CLI/OCR boundaries were mocked; no live provider quota was consumed.
