# Prompt instruction duplication review

Reviewed 2026-10-03. Read-only investigation of the three files currently in `log/`
and the context/provider assembly code. No prompts, database instructions or runtime
behavior were changed. Character extraction and gameplay are separate requests;
the final-response file records output, not another input request.

## Verified findings

1. **The gameplay narrator instructions are sent twice.** In
   `20261002__153732__generateAntigravity.json`, all 1,783 characters of
   `prompt.mandatory.instructions` occur verbatim at the beginning of the
   separately supplied agent instructions. `domain/context.ts` adds
   `BOOK_GAMEPLAY_NARRATOR`; `providers/antigravityMcpBook.ts` adds it again to
   `agentPrompt`. Removing one occurrence would save 1,783 characters, about
   8.5% of this request's 20,905 input characters, excluding transport overhead.
   These are character counts, not measured tokens. The same duplication is
   present in Claude and Codex source assembly, although this folder contains
   no live logs for those providers.

2. **The database's Vampire instructions repeat application mechanics.** The
   5,943-character `mandatory.systemInstructions` includes book authority,
   original-text retrieval, trusted randomness, provisional/conflicting rulings,
   identifier/private-note restrictions, operations, tool isolation and response
   formatting. Those responsibilities also occur in the application narrator.
   Keep Vampire-specific interpretation, Hunger, optional resource decisions,
   fair challenge, player agency and narrative style. Consolidate generic
   protocol obligations in one application-owned instruction block. This is
   semantic overlap, not an exact second copy of the full database column.

3. **The overview repeats rule policy.** `domain/ruleMapping.ts` generates a
   384-character overview combining populated columns with book authority,
   discovery/retrieval, citations and conflict/provisional policy already in the
   narrator. Keep dynamic navigation metadata; centralize fixed policy.

4. **Antigravity tool schemas have two publication routes.** The agent prompt
   explicitly includes 4,159 characters of tool definitions, while
   `providers/gameplayMcp.ts` also serves the same definitions through MCP
   `tools/list`. This is a candidate optimization, not proof that this log shows
   both copies entering the model context. Verify native discovery and argument
   generation in a live dice/rules turn before removing the textual definitions.

## What is not unnecessary duplication

- Each new player action uses a fresh provider context. Application policy and
  the current selected system instructions therefore still need to be supplied
  for each new turn. Deduplication within a request does not mean omitting them
  from later turns or relying on provider conversation memory.
- The character-import request contains source text and its extraction schema;
  gameplay contains the resulting character JSON. These serve different tasks.
- The gameplay response schema occurs once in the logged user prompt. The
  Antigravity adapter's schema-presence check prevents a second append here.
  Codex's native transport envelope is distinct from the application schema.
- The gameplay log contains a short overview, not the full `core_rules` column.
  `rules` and `pinnedRules` are empty in this sample; books are accessed by tools.
- `antigravityFinalResponse` is the returned GM object. Its logging field named
  `prompt` is misleading, but does not imply resubmission to the CLI.

## Recommended follow-up

Keep one application policy block in the native system/agent instructions for
all gameplay adapters. Keep campaign state, action, system-specific instructions,
navigation metadata and the output contract in the user context. Preserve the
complete inspectable context manifest if removing narrator text at the provider
boundary instead of changing context construction. Verify extraction and memory
requests separately; they have different contracts.

Shorten the Vampire instructions without removing its game-specific behavior.
Reduce the overview to navigation metadata. Evaluate Antigravity's schema
duplication independently with live native MCP checks. Add provider-boundary
checks demonstrating that application narration policy occurs once and required
system instructions remain present. Do not remove book/dice validation or change
fresh-session behavior as part of this cleanup.

Evidence is limited to one extraction request and one successful gameplay
request with its final response. No latency, billing, token savings or cache-hit
measurements are available from these three files. No live CLI calls or database
changes were performed during this review.

## Follow-up: improvised campaign content

The old `rpg_be/src/services/rpgLogic.js` requested an `existingInfo` boolean
indicating whether the answer came from the supplied scenario. Searching the old
backend/frontend found this field only in the prompt: the shown save path does
not consume or persist it. The old `generated_things` table stores chat and
`others` records, and introduced NPCs are stored as characters. `isUnique` marks
unique versus generic characters, not source provenance.

The current implementation supports character creation and campaign-state
operations (`domain/state.ts`), persisted turn narratives and campaign memory.
It does not have a typed source-versus-improvised provenance field in `Character`
or a dedicated structured registry of improvised world facts. A narrative detail
is in the transcript; durable structured storage depends on a returned operation,
and later recall may depend on history/memory. The library remains separate from
campaign state; generated story facts do not automatically become book rules.

For stronger continuity, consider campaign-owned facts with entity-level origin
(source reference, GM improvisation or player contribution), creating turn,
status (established fact versus belief/rumor) and stable identity. Integrate their
changes with existing atomic turn commits, undo and export/import. Keep rules
adjudications separate and explicitly provisional. A single boolean covering an
entire mixed answer cannot represent this reliably. This is a proposal, not
implemented behavior.
