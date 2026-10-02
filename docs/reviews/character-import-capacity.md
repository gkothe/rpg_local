# Character import capacity and text formats

The old character parser imposed an 8,000-unit ceiling before the CLI's 3,200-unit reserve and
used estimated tokens, while actual generation enforces UTF-8 bytes. This could reject ordinary
character dossiers or pass requests later rejected by generation. Sigurd's supplied sheet is
6,244 UTF-8 bytes, not an unusually large file.

The parser now uses the selected provider's actual available request budget and serialized UTF-8
byte measurements. Sheets fitting one call retain full-schema parsing. Longer sheets are processed
sequentially in bounded sections using a partial schema. Every source character is covered,
paragraph and Unicode boundaries are preserved, and prior extracted JSON does not inflate the
next prompt. Partial fields merge deterministically: nested keys survive, arrays deduplicate,
descriptive strings combine, later explicit scalar values take precedence. Final validation uses
the normal character schema. Ownership/revision checks stop obsolete parsing before further calls.

Source imports accept arbitrary UTF-8 text formats (Markdown, JSON, YAML, CSV, custom extensions)
without assuming they already match the character schema. JSON is still normalized by the LLM.
Binary control data, invalid UTF-8, invalid PDFs, empty text and existing upload limits remain
rejected. PDFs retain local extraction/OCR; imported text remains data rather than executable
instructions. Source text is saved verbatim and no private sheet contents enter repository tests.

Verification: 86 backend tests passed (42 environment-gated skips), 45 frontend tests and five
targeted Windows Chrome browser tests passed, with lint/typecheck/build. Synthetic tests cover
complete multi-section coverage, bounded sequential calls, nested field merging, malformed output,
stale ownership, JSON/text inputs and binary rejection. Actual Antigravity retry of the user's
saved sheet is recorded below after completion; Claude remains user-deferred.

## Actual local retry

Antigravity gemini-3.8-flash high successfully parsed the user's existing 6,244-byte Sigurd sheet. Saved one player character to the previously failed setup campaign using existing revision-checked CampaignService. Imported sheet remained saved unchanged; no duplicate character was created. Parsed fields include nine attributes, health, willpower, humanity, skills and disciplines. No private sheet or generated character body was committed as a test fixture.
