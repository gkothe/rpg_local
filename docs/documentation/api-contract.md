# Local RPG HTTP contract v1

Base `/api`. Every successful JSON response is `{ data: T }`. Collections: `{ data: T[], pagination: { nextCursor: string|null } }`; `limit` (1..100 default20), `cursor` numeric offset. Errors RFC problem JSON: `{type,title,status,detail,code}`. All mutations require `X-RPG-Client: local-rpg`; JSON except multipart upload. GET never invokes AI. No application login. Default loopback4100. Dates ISO UTC; IDs UUID. Frontend should fetch providers/settings on mount and preserve draft text on errors.

## DTOs

`ProviderSettings = {provider:string, model:string, effort:string|null}`. Blank provider allowed during manual campaign setup.

`Character = {id,name,type:'player'|'npc',attributes:object,inventory:object,description:object,notes:string,revision:number}`

`Source = {id,name,kind:'text'|'file'|'pdf'|'google-doc',text:string,status:'draft'|'confirmed',version:number,pages:object[],warnings:string[],originalAvailable?:boolean}`

Campaigns also include `pinnedSourceSections: {sourceId:string,version:number,index:number}[]`. PATCH campaign accepts this field; references must match existing confirmed current-version source sections.

`Memory = {id,text,coveredTurnIds:string[],valid:boolean,createdAt:string}`

`Campaign = {id,name,description,instructions,revision:number,notes:string,notesRevision:number,characters:Character[],sources:Source[],settings:ProviderSettings,pinnedFacts:string[],pinnedSourceIds:string[],budgets:{gameplay:number,compaction:number,memory:number},state:object,memory:Memory|null,createdAt:string,updatedAt:string}`

`Turn = {id,campaignId,requestId,status:'pending'|'running'|'completed'|'failed'|'cancelled'|'interrupted',action,narrative:string|null,changes:string[],error:string|null,undone:boolean,settings:ProviderSettings,context:object|null,createdAt,completedAt:string|null}`

`CampaignDetail = Campaign & {turns:Turn[]}`; turns include full audit with undone flags. GET detail loads latest100 turns; GET turns collection pages full transcript.

## Routes

- GET `/health`: `{status:'ok'|'degraded',database:boolean}` (503 when database unavailable).
- GET `/settings`: `{version:1,turnStatuses:string[],sourceKinds:string[],characterTypes:string[],audio:{available:boolean,reason:string|null,maxSeconds:number},lan:{enabled:boolean},limits:{uploadBytes:number}}`.
  Additional canonical options: `turnStatusOptions[{id,label,active,terminal,completed}]`, `sourceStatusOptions[{id,label,confirmed}]`, `sourceKindOptions[{id,label}]`, `characterTypeOptions[{id,label,default}]`, `ocrLanguageOptions[{id,label,default}]`, `transcriptionLanguageOptions[{id,label,default}]`, and `defaults{characterType,ocrLanguage,transcriptionLanguage,budgets}`. Frontend derives labels/state behavior from these options.
- GET `/providers`: `Provider[]` where `{id,name,available:boolean,supported:boolean,reason:string|null,version:string|null,models:{id,label,efforts:string[],inputTokens:number}[],catalogProvenance:string}`. Installed but unsupported isolation is disabled, not a working adapter. Models are administrator configured/verified options, never guessed dynamic subscription availability.
- GET/POST `/campaigns`; POST `{name,description?,instructions?,settings?}` => Campaign. GET rows are Campaign summaries (same shape; FE can use name/updatedAt).
- GET `/campaigns/:id` => CampaignDetail.
- PATCH `/campaigns/:id` `{revision,name?,description?,instructions?,settings?,pinnedFacts?,pinnedSourceIds?,budgets?,state?}` => Campaign. Revision conflicts409.
- DELETE `/campaigns/:id` `{revision}` => `{deleted:true}`; active turn409.
- PATCH `/campaigns/:id/notes` `{notes,notesRevision}` => Campaign (private notes don't enter prompt).
- POST `/campaigns/:id/characters` `{revision,name,type?,attributes?,inventory?,description?,notes?}` => Campaign.
- PATCH `/campaigns/:id/characters/:characterId` `{revision,name?,attributes?,inventory?,description?,notes?}` => Campaign. DELETE same path `{revision}` => Campaign.
- POST `/campaigns/:id/sources` JSON `{revision,name,text}` => Campaign with a confirmed source, immediately eligible for GM context.
- POST `/campaigns/:id/sources/extract` multipart `file`, `revision`, `language` ('eng'/'por'/'eng+por') => Campaign with a confirmed extracted source; or JSON `{revision,url,name?}` public Google Docs only. Text/MD/PDF up to20MiB; PDF requires configured local Python dependencies. No browser file paths.
- PATCH `/campaigns/:id/sources/:sourceId` `{revision,text,name?,confirmed:boolean}` => Campaign; confirmation/correction bumps source version.
- DELETE `/campaigns/:id/sources/:sourceId` `{revision}` => Campaign.
- GET `/campaigns/:id/sources/:sourceId/sections` => sections `{id,index,text,start,end,page:number|null,version,pinned:boolean}[]`. Offsets are JavaScript string offsets; corrections invalidate old section pins.
- GET `/campaigns/:id/sources/:sourceId/original` => retained original binary/text with its content type, or `original_unavailable`404. Source/campaign deletion removes it; archives/templates omit binaries.
- POST `/campaigns/:id/character-drafts` `{revision,sourceId}` => `{draft:{name,type,attributes,inventory,description}}`; explicit POST character confirms draft. Missing provider returns actionable error.
- GET `/campaigns/:id/turns` => paged Turn[].
- POST `/campaigns/:id/turns` `{revision,requestId:uuid,action,settings?:ProviderSettings}` => Turn (202). Stable requestId binds payload: retry identical returns prior result; changed body409. Poll GET below; do not resubmit automatically.
- GET `/campaigns/:id/turns/:turnId` => Turn.
- GET `/campaigns/:id/turns/:turnId/events` SSE `event: status`, `data: <Turn>`; closes on terminal status. Stored polling is canonical.
- POST `/campaigns/:id/turns/:turnId/cancel` `{}` => Turn.
- POST `/campaigns/:id/undo` `{revision}` => CampaignDetail. Latest active completed turn only; conflicts reject rather than erase manual changes.
- POST `/campaigns/:id/memory` `{revision,text,coveredTurnIds:string[],confirm:true}` => Campaign. Coverage must be an exact consecutive prefix of active completed turns; bounded text, explicitly reviewed checkpoint.
- GET/POST `/templates`; POST `{name,campaignId,revision}` => Template `{id,name,setup:object,createdAt}`. DELETE `/templates/:id` `{}` => `{deleted:true}`. POST `/templates/:id/campaigns` `{name?}` => Campaign.
- GET/POST `/character-templates`; POST `{name,campaignId,characterId,revision}` => `{id,name,character:Character,createdAt}`. Private character notes are removed. DELETE `/character-templates/:id` `{}` => `{deleted:true}`. POST `/campaigns/:id/characters/from-template` `{templateId,revision}` => Campaign with a fresh character ID and empty private notes.
- GET `/campaigns/:id/export` => Archive `{format:'local-rpg',version:2,campaign:Campaign,turns:Turn[],snapshots:object[],memories:Memory[],diceSessions:object[],diceRecords:object[]}`. Idle campaign only; no paths/credentials/audio/raw files.
- POST `/campaigns/import` `{archive:Archive}` => CampaignDetail with new UUIDs.
- POST `/audio/transcriptions` multipart `file`, `language` ('en'/'pt'/'auto') => `{text:string}`. Local FasterWhisper only; no campaign context; diagnostics under settings. No hidden cloud fallback.
- POST `/lan/code` `{}` => `{code,expiresAt}`; desktop loopback only. POST `/lan/pair` `{code}` => `{paired:true}` and HttpOnly device cookie; opt-in LAN only, single use. POST `/lan/revoke` `{}` => `{revoked:true}`; desktop only. Sessions clear on restart. Unpaired LAN campaign reads and writes return `pairing_required`.
- GET `/lan/status` => `{enabled,desktop,paired,expiresAt:string|null,connectUrls:string[],microphoneRequiresHttps:true}`. HTTPS pairing sets a Secure cookie. Device approval expires after twelve hours; code expires after two minutes. Status is available before pairing.

## Frontend behavior

Always send current `revision` on campaign mutations; refetch after turn completes/cancels/undo. Toolbar changes use PATCH campaign/settings; turn captures settings. Don't lose local unsaved character/composer text while refetching. Read-aloud is frontend local SpeechSynthesis only. LAN opt-in configuration stays a desktop setup feature; unpaired LAN protected reads and writes require pairing cookie.

## Trusted dice and explicit recovery (archive v2)

Gameplay uses a separate version-2 GM response: `{version:2,narrative,operations,rollInterpretations}`. The existing operation constraints still apply. Each interpretation is `{rollId,explanation,corrections?:[{explanation}]}`; every recorded roll must be referenced exactly once. Unknown, duplicated or missing references reject the complete answer before any game-state commit. No AI-authored face array is accepted. Source extraction and memory compaction keep the original no-tools generator.

The only game tool is `roll_dice`. Its strict arguments are `{slot,groups:[{label,count,sides}],reason,declaration,actorId?,targetId?,rerollOf?:{rollId,reason}}`. It generates individual cryptographic faces and performs no bonus arithmetic, keep-high/low selection, success counting or game-rule interpretation. Known modifiers and targets belong in the opaque declaration before reveal; later explained corrections appear separately. Actors/targets must belong to the frozen context; a reroll references an earlier roll in the same logical session.

Backend-owned `GET /settings` adds `dice:{enabled,limits}`. Limits are 12 sequential logical slots (starting at 0), 24 requests per attempt, 8 uniquely labelled groups per call, 50 dice per group, 100 faces per call, 200 new faces per logical session, 2–1,000,000 sides, 4,096 UTF-8 input bytes, 8,192 input/result transcript bytes and a 180-second attempt deadline. Labels/reasons/declarations are capped at 80/240/600 characters. Provider subprocess output remains capped at 2,000,000 bytes. Invalid requests consume the request allowance; attempts stop rather than silently rerolling or dropping transcript context.

`GET /providers` retains ordinary installation/no-tools support and adds separate `dice:{supported,reason}` at provider and model levels. Only verified dice capabilities allow gameplay. Claude uses an exclusive per-attempt loopback MCP capability. Codex replies to pending native dynamic calls using the installed `DynamicToolCallResponse` schema and continues one bounded ephemeral thread/turn. Antigravity 1.2.14 uses actual authenticated private HTTP MCP in an owned temporary profile with exact private tool permissions and excluded ambient customizations; no shared configuration is changed. All execute the persistent DiceService. Context, aggregate protocol/transcript/output, inference/call counts and the overall deadline remain bounded. Antigravity input JSONL <=12,800 bytes; each reported inference input <=16,000 tokens/output <=2048, at most25 inferences. Aggregate input across continuations is distinct from a single context window. New logical actions reconstruct authoritative application context; no cross-action process pool or opaque canonical state. These diagnostics never include endpoint authorization, provider login material or raw CLI logs.

Terminal Turn responses add optional `diceSessionId`, `retryOfTurnId`, `rolls`, `rollInterpretations` and derived `diceRetry:{available,reason}`. Each roll contains its canonical ID/session/campaign, slot, original reason/declaration, groups with individual faces, optional actor/target/reroll references and UTC creation time. Running/pending turns do not expose partial dice. Terminal attempts expose only their own received prefix, so an earlier failure does not acquire rolls generated later by a retry. Derived retry eligibility is advisory; the write rechecks it under locks.

`POST /campaigns/:id/turns/:turnId/retry` accepts strict `{revision,requestId,settings?}` and returns the existing 202 `{data:Turn}` envelope. It creates a new attempt sharing the original logical dice session, action and frozen prompt. Require failed/cancelled/interrupted local status, current revision, idle campaign, no later superseding attempt and unchanged canonical gameplay digest. Private notes, timestamps and provider preferences do not alter that digest; game state, rules, sheets, memory and active history do. The selected provider must fit the frozen context and its bounded replay reserve. Imported sessions cannot execute.

HTTP uncertainty is resolved with the same request ID and exact input; it never starts another generation. A confirmed terminal retry uses a new request ID. Changing a reused request's payload conflicts. Ordered replay must reproduce the entire original specification/declaration and consume every original slot before appending new randomness. Tool records commit before faces are returned. Cancellation, failed final validation, lease recovery and undo preserve their immutable audit. Only deleting the campaign removes that audit by cascade.

Exports now use `local-rpg` archive version 2 with canonical `diceSessions` and `diceRecords`, terminal attempt prefixes and interpretation references. Import also accepts version 1, normalizing absent dice arrays to empty arrays. Version-2 import validates face ranges/limits, exact canonical prefixes, session totals, slot ordering, reroll/actor/attempt links and completed-turn interpretations. Explicit UUID references are remapped; historical prompt/narrative text is preserved. Imported sessions are marked non-executable. Archives exclude active capabilities, credentials and derived retry eligibility. Templates do not carry roll history.

Trusted faces do not mechanically prove that the GM requested every roll required by a game system, interpreted arithmetic correctly or kept narration consistent. The application validates the structured audit and mutations; free-form rule interpretation remains the AI's responsibility.

## Shared current rules libraries

Backend owners: domain/rules.ts (eleven columns, schemas and RULE_LIMITS), domain/versions.ts (package/backup v1, rule-response/archive v3), ruleStore/ruleLibrary/ruleLookup/ruleBackup and provider gameplay registry. All routes retain Host/Origin/device/write protections and {data} envelopes. Numeric collection continuation is returned in pagination.nextCursor; opaque rule lookup cursors/locators are bound to system/revision/hash/arguments and may expire on server restart.

| Method/path under /api                                | Request / bounded response                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /rule-systems                                     | limit/cursor; context metadata plus backend-derived isDefault/selectable. Empty/structural-only books are not selectable.                                                                                                                                                                                                   |
| POST /rule-systems                                    | {systemKey,name}; stable safe slug and name; creates an empty library.                                                                                                                                                                                                                                                      |
| GET /rule-systems/:id                                 | Context, instructions, source descriptors, populatedColumns, booksAllowed and served limits; no full tree.                                                                                                                                                                                                                  |
| PATCH /rule-systems/:id/instructions                  | {revision,requestId,instructions}; <=8192 UTF-8 bytes, revision-owned/idempotent; editor stays open.                                                                                                                                                                                                                        |
| POST /rule-systems/:id/imports                        | multipart files plus revision; manifest + exactly listed .md files, <=12 files, <=10 MiB each, <=20 MiB combined during streaming; preview only.                                                                                                                                                                            |
| POST /rule-systems/:id/imports/:previewId/confirm     | {revision,requestId}; atomically replaces one source partition/mapping, preserves instructions/other books; committed identity replays even after consumed preview/later revision.                                                                                                                                          |
| GET /rule-systems/:id/search                          | query, optional columns comma list/source/cursor; <=10 hits, bounded snippet and direct-text locator.                                                                                                                                                                                                                       |
| GET /rule-systems/:id/nodes                           | path/view=text or fields, optional cursor or locator (exclusive); view=children delegates bounded rules_list.                                                                                                                                                                                                               |
| GET /rule-systems/:id/mapping                         | optional column/cursor; compact paginated column layouts, never exhaustive text/path indexes.                                                                                                                                                                                                                               |
| PATCH /campaigns/:id/rule-system                      | {revision,requestId,systemId:UUID or null}; idle latest selection; null explicitly chooses protected default; preserves state/history/event memory.                                                                                                                                                                         |
| GET /campaigns/:id/rule-system                        | Effective current metadata or explicit {unresolved}; never silent missing-book fallback.                                                                                                                                                                                                                                    |
| GET /campaigns/:id/rule-system/resolution             | Saved reference, exact-key/kind candidate and hashChanged; no fuzzy name match.                                                                                                                                                                                                                                             |
| POST /campaigns/:id/rule-system/resolution            | Binding payload above; explicitly resolves an unresolved reference/default choice.                                                                                                                                                                                                                                          |
| GET /campaigns/:id/turns/:turnId/rule-reads           | Terminal-owned audit only, numeric cursor; <=16 KiB serialized envelope with explicit continuation; foreign turn/campaign denied.                                                                                                                                                                                           |
| GET /rule-systems/:id/backups                         | Private local-rpg-rules v1 current-row backup in data; <=32 MiB, no PDF/files/scripts/credentials, separate from campaign exports.                                                                                                                                                                                          |
| POST /rule-systems/backups/imports                    | Separate multipart file route <=32 MiB; strict UTF-8/schema/content hash; owned restore preview. Static routes precede UUID detail routes.                                                                                                                                                                                  |
| POST /rule-systems/backups/imports/:previewId/confirm | {systemId,systemKey,revision:number or null,requestId,replace:boolean}; preview identity owns local target, explicit replacement for existing key/default; stale collision fails atomically, imported revision counter ignored. Existing row always advances local revision, even same hash; replay does not advance again. |

rules-book v1 manifest requires format/version/source (slug/title/pageCount/pdfHash nullable), mandatory column/file/hash records, converter id/version, markerFormatVersion=1, coverage description/omissions, optional keyed enrichment. Hashes verify raw uploaded column bytes; original PDF hash is only a declaration when PDF is unavailable. Parser uses strict UTF-8, LF normalization and canonical UTF-16 direct-text offsets after control/navigation-marker removal. It retains original body Markdown/tables/order, recognizes boundaries outside fenced code, requires explicit parents and safe unique slugs, accepts heading-before-marker or marker-before-heading, `pages:-`/`printed:-` and inline PDF markers without a printed label. Recognized header metadata keys: title, edition, publication, converter, version, marker-format, nodes, pages, plus the exact observed splitter generator annotation; unknown controls fail. Actual private eleven-column package validation passed read-only, with unchanged hashes. Owner confirmation of manifest metadata and future enrichment offset semantics remains T001; neither import hashes nor that check certify OCR completeness. `npm run rules:manifest` validates unchanged columns before writing a new manifest outside their directory and refuses overwrites.

Node-wide PDF page ranges are approximate. Inline page markers produce nonoverlapping canonical direct-text pageSpans; exact quote pages require full known span coverage. Printed labels are separate; missing provenance is unknown. Text evidence validates exact quote/offset membership without semantic certification; visual evidence remains explicit/manual. Structural parents and descendant text cannot support direct citations.

Owned book tools: rules_map/search/get/list plus roll_dice. Tool requests <=1024 bytes, opaque ASCII cursor/locator <=192 chars, query 1–240 chars/<=12 terms, <=10 hits/20 children, serialized result <=4096 bytes, rule request/result transcript <=8192 bytes, rule calls <=12. Current verified Windows provider reserves lower dice calls to12/combined24 (preserving 12 slots/200 faces, separate8192-byte dice transcript,180s/2000000-byte output). Provider model rules capability supplies supported/reason/efforts/limits; verified book combinations are Claude2.1.232 sonnet medium, Codex0.159.2 gpt-5.6-sol medium and Antigravity1.2.14 gemini-3.8-flash low/medium. Default v2 gameplay and no-tools work keep independent gates/reserves. Claude historical native passes remain evidence; fresh repeat is an explicit user-deferred weekly-quota TODO. No global JSON-upload limit increased.

The shared gameplay registry owns tool name/description/Zod validation/derived JSON schema/purpose/capability budget/handler. Its typed dispatch carries exact definitions to the provider service; transports translate and dispatch generically. Request identity binds tool plus arguments, replay rechecks active ownership and cancellation, and invalid requests retain owned audit/accounting. Future tools require explicit registration in an implemented purpose; the synthetic extension test adds no production tool. Native final response validation retains current v2/v3 application contracts.

Process-local immutable snapshots are keyed by system ID/revision/hash/kind and shared per Store (four entries,64 MiB serialized content). Each access first checks/locks the authoritative database head; owner/lease/cancellation and fresh read receipt persistence remain outside caches. Search caches retain at most8 queries/4096 candidate hits per snapshot; cursors/locators and receipts are newly generated. Stale revisions cannot be returned from cache. `GameplayNativeUsage.cacheReadTokens` forwards actual provider telemetry when reported; absent is unknown, not zero. No subscription cost reduction is promised.

A turn captures lightweight system ID/key/kind/revision/contentHash/name and stores append-only bounded read receipts before reveal. Active owner/lease/campaign/current-rule guards apply before every replay/read, dice creation/draw, context rebuild and final commit; heartbeat aborts outdated attempts. Failed/cancelled/undone reads remain audit, excluded from active narrative context. V3 response retains operations/rollInterpretations and adds ruleCitations: receiptId/path/source/systemId/revision/contentHash/quote/start/end/precision/pdfPages/printedPages. Only exact retrieved direct text supports citations (quote<=600 UTF-16 chars); mapping/search/fields/structural nodes do not. Missing rules and contradictory books remain explicit/provisional model narration rather than executable mechanics.

Current campaign export version is3; named legacy1 and dice2 remain accepted independently. V1/v2 normalize to default. V3 remaps campaign/turn/read/dice IDs and validates saved receipt hashes/provenance/citation offsets; historical captured system UUIDs remain audit metadata, so a missing library can still import. Exact stable key/kind/hash selects a different local UUID; absent/different current content remains explicitly unresolved until choice. Full books are never reconstructed from audit. Imported dice sessions remain non-executable. Templates contain a reference and setup, no history/books. Private backups retain only one current system, regenerate local identity as necessary and restore under an atomic current-row lock.

Principal errors: rules_import_invalid/rules_backup_invalid (422), rules_preview_missing (404), rules_system_empty (422), rules_reference_unresolved/rules_context_changed (409), rules_provider_unavailable (503), rules_request_invalid/rules_budget_exhausted/rules_calls_exhausted (422), rules_attempt_active (409), rules_upload_size/rules_backup_size (413), and existing revision/identity conflict errors (409). See the actual capability report for tested paths and external limitations.

### CLI version compatibility

Provider responses add optional `compatibilityWarning: string | null`. CLI versions differing from the recorded tested baselines no longer disable discovery, dice or book gameplay. The warning is informational and must not be treated as `reason` or as unsupported capability by clients. Required flags, subscription authentication, model/effort constraints, context limits, owned tool isolation and runtime response validation still apply. Selection and Settings show the warning; actual failed turns retain their visible errors. Recorded version/model evidence above is historical test coverage, not an exact-version allowlist.

Current import policy: all successful source imports, including PDFs, public Google Docs and pasted text, create confirmed sources immediately. Source review/correction and explicit draft status remain supported but are optional. No review step is required between upload and GM use or character draft generation. Invalid/empty/oversized inputs remain rejected.

Character parsing accepts imported UTF-8 text in any extension (including JSON/Markdown/YAML), or locally extracted PDF text, and normalizes it through the selected LLM into the existing draft JSON schema. It uses actual serialized UTF-8 request bytes and available provider capacity. Oversized single requests are split into sequential bounded sections, merged and validated instead of asking the user to shorten the sheet. Source text remains saved and no section is silently discarded. Explicit campaign revision validation remains required throughout parsing. Binary/invalid UTF-8 inputs remain rejected.

### CLI capacity and automatic response repair

Campaign budgets are soft retrieval/compaction targets, not AI admission limits. Mandatory context is preserved even above a target. Native CLI context/output/compaction and inference limits apply; the app adds no AI attempt deadline. Active turn Cancel remains available. Version warnings remain informational, and installed model-supported efforts plus Default are accepted.

Current v5 readable responses use field-only repair: application validation identifies allowed paths; a tools-free call to the same CLI/model/effort returns path/value corrections, which are checked and fully revalidated. Narrative and other valid fields stay unchanged. Citation offsets/pages are computed in code from exact, uniquely identifiable supplied quotes; computed fields are optional only on the CLI wire contract and remain required in storage/archives. Invalid or ambiguous quotes still require correction. Restricted repair failure stops without automatic scene regeneration. Unreadable JSON and pre-final generation failures retain up to two generation retries with saved-dice replay; historical versions retain their complete-response retry behavior. Both correction loops stop on quota, cancellation, changed ownership/rules/campaign context or forbidden capabilities. Diagnostic prompts and responses remain local Git-ignored logs. The UI keeps an animated busy indicator and an editable next-action draft.

Invalid Antigravity `call_mcp_tool` gateway server/tool envelopes use recoverable `gameplay_tool_unavailable`: dispatch is denied, the provider attempt closes, and correction feedback identifies the owned registry. Saved dice/context remain unchanged. Actual native capability violations retain non-retryable isolation errors. Argument-free DONE metadata is accepted only for an already validated/dispatched owned tool step.

### Campaign knowledge and instruction contract (v4)

Gameplay and campaign exports now use v4 after the coordinated migration and
compatibility gate. Earlier archive-v2/v3 descriptions above remain historical
compatibility notes. New book and no-library responses share the strict shape
`{version:4,narrative,operations,rollInterpretations,ruleCitations,knowledgeChanges}`;
no-library citations are empty. Stored legacy retries retain their original version.
The selected rule-system instructions and optional campaign instructions are preserved
in full; one technical instruction block describes integration and owned tools.

`Campaign.knowledge` contains records separate from free-form `state`:
`{id,kind,title,text,origin,certainty,status,characterIds,characterNames,holderId?,holderName?,
createdTurnId,updatedTurnId,createdAt,updatedAt,revision,evidence,attributions}`.
Kinds are `npc|place|relationship|debt|objective|event|other`, origins
`source|gm|player|unknown`, certainty `established|rumor|belief`, and statuses
`active|resolved|retracted`. These values and labels are backend-owned options.
IDs, historical display names, revisions and UTC audit fields are assigned by the
server. Character deletion leaves historical identity, never a live editable character.

Knowledge changes are creates with fact/provenance fields or updates with an existing
`id`, exact `expectedRevision` and nonempty `changes`. Physical deletion and changes
to creation identity/origin/audit fields are rejected. Links accept existing character
UUIDs or `{operationIndex:number}` targeting a create in the complete operations array;
aliases resolve before persistence. Each created NPC has one introduction record.
Narration, character/state operations and knowledge commit atomically; the existing
chat change list reports changes. There is no separate editor or approval step.

Evidence is either `{type:'campaign_source',sourceId,version,sourceName,quote,start,end}`
or `{type:'book',citation:RuleCitation}`. Only source origin carries evidence, and
source origin requires it. Campaign quotes use absolute UTF-16 source offsets,
`end=start+quote.length`, and must fit one supplied frozen span with matching
identity/version/name and exact text. Book evidence uses existing exact original-book
receipt validation. Retained quote/name/version survive source deletion/replacement;
lookup labels missing or replaced source versions unavailable. Evidence validates provenance/coordinates,
not semantic truth.

Owned read-only tools `campaign_knowledge_search` and `campaign_knowledge_get` are
available independently of library mode. Search accepts `{query,kind?,status?,cursor?}`
and returns record summaries plus an opaque continuation; get accepts `{id}` and
returns the complete record with evidence and historical-link labels. Reads are scoped
to the immutable captured campaign registry, never current mutable state. Search
defaults to active records; resolved/retracted records require a status filter or exact
ID lookup. Knowledge reads do not draw dice or create authority receipts for books.

New root dice sessions persist `promptContractVersion:4`, `digestVersion:2`, exact
`systemPrompt`, `frozenKnowledge:{campaignId,records,characters:[{id,name}],sourceIds,sourceVersions?:[{id,version}]}`,
and `toolDefinitions:[{name,description,inputSchema}]` once; `frozenPrompt` holds the
exact user input. New frozen captures include current source versions; older v4 captures
without that optional metadata retain their source-ID-only availability semantics.
Retries use these immutable fields. Legacy absent metadata retains
the original contract/digest; no historical metadata is fabricated. A legacy retry
with nonempty new knowledge fails its context-change check. Derived memory never
overrides knowledge certainty/status/evidence. Legacy undo snapshots omit knowledge
fields; new snapshots hold only touched `beforeKnowledge`/`afterKnowledge` records.
Omission means no tracked changes, never clearing the registry.

Archive v4 validates/remaps knowledge, attribution turns, character/source links,
book receipt links, undo snapshots and frozen session metadata consistently. Deleted
character/source links remain historical with retained names/quotes; structural UUIDs
receive new identities while narrative, private text and historical prompt strings
remain exact audit text. Imported sessions are non-executable. Archives v1–v3 remain
accepted through strict legacy schemas; old campaigns receive empty knowledge on
activation without guessed origins. V4 fields are rejected in older archive versions.
Templates retain setup and portable book references, excluding knowledge timeline,
turns, receipts, snapshots and frozen sessions.

`GET /api/campaigns/:id/turns/:turnId/context` loads the existing saved context
inspection on demand. It returns `{data: ContextManifest|null}`. New v4 contexts
hydrate exact system/user inputs, digest version, frozen knowledge and definitions
from the immutable owning root session; ordinary campaign/turn lists retain only
the reference. Legacy contexts remain unchanged. Cross-campaign IDs return 404.

If a v4 session cannot be created because database columns are missing, the turn
fails before a CLI call with an actionable `setup-database.cmd` migration message
instead of the generic invalid-response message. No game changes are committed.

## Current audited gameplay contract (v5)

New actions use response version 5, archive version 5 and context digest version 3.
Older response/archive contracts remain strict and retain their original retry semantics.
Campaign sources have a `purpose`: `campaign`, `character` or `reference`. Legacy sources
without a purpose become references when preparing a v5 context. Confirmed source text
is frozen for each action. Opening turns include deterministic source excerpts; the GM
can retrieve more through `campaign_sources_search` and `campaign_sources_get`.
Get results retain receipt IDs and exact source spans for evidence validation.

Mechanical operations require `operationExplanations`, indexed by operation position,
with a reason, basis and optional saved dice/evidence references. Knowledge certainty
and visibility are separate: `player` records may appear in normal views; `gm_only`
records and their private attribution are withheld. Ordinary campaign, turn and event
responses use player projections. Explicit full exports and Advanced context diagnostics
remain private local backups/inspection and may contain spoilers.

A validated GM response is saved privately before narrative editing. The editor receives
only the narrative and writing instructions, with no tools or campaign state. Nothing is
committed or delivered until editing succeeds. Failed editing exposes `editingPending`
and `editingResume: {available, reason}` on the turn, never the raw narrative.
`POST /api/campaigns/:id/turns/:turnId/resume-editing` takes `{revision, requestId}`;
reuse that UUID after an uncertain acknowledgement. Resume edits the same saved candidate,
without another GM generation or dice roll. Changed campaign/rule context prevents resume.
Cancel abandons the pending candidate. Pending editing blocks new actions.

Local trace records correlate the action, provider attempts, tool requests/results,
validation, editor and commit. `traceWarning` reports incomplete post-save logging;
it does not undo a committed turn or trigger another roll.

### Rule-read accounting after migration 0011

Rule lookups have no accumulated request-count or transcript-byte ceiling. The database
keeps nonnegative audit counters and immutable receipts. Responses remain paginated;
a cursor requests the next page. Archive v5 preserves receipt totals above the former
8 KiB ceiling, while historical archive contracts remain unchanged.

Private tool-failure traces retain `database.sqlState` and safe table/column/constraint
identifiers. A PostgreSQL CHECK rejection is classified as `database_constraint`, rather
than an unrelated local-service connection failure. SQL text, rejected row values and
raw database messages are omitted.

Current source navigation adds `sections: {sectionIndex,title,headings:string[],supplied:boolean}[]` to each v5 campaign source catalog item. Search entries add `title` and `alreadySupplied`; get receipts add the same fields alongside the unchanged original source span and receipt ID. These additive diagnostics preserve frozen historic payloads and immutable receipt replay. Supplied tracking is execution-local, covers only complete original sections and advances after successful persistence; repeated reads remain unrestricted.

Narrative-only editing retains the GM provider/model but selects advertised `low`, then the lowest canonical advertised effort, then CLI default (`null`). GM settings are never modified. The selected editor effort is reused for its correction attempts. Field-only mechanical response repair continues to use the GM effort. Editor failure still withholds delivery until the stage succeeds.
