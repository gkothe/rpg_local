# Local RPG HTTP contract

Base `/api`. Every successful JSON response is `{ data: T }`. Collections: `{ data: T[], pagination: { nextCursor: string|null } }`; `limit` (1..100 default20), `cursor` numeric offset. Errors RFC problem JSON: `{type,title,status,detail,code}`. All mutations require `X-RPG-Client: local-rpg`; JSON except multipart upload. GET never invokes AI. No application login. Default loopback4100. Dates ISO UTC; IDs UUID. Frontend should fetch providers/settings on mount and preserve draft text on errors.

## DTOs

`ProviderSettings = {provider:string, model:string, effort:string|null}`. Blank provider allowed during manual campaign setup.

`Character = {id,name,type:'player'|'npc',attributes:object,inventory:object,description:object,notes:string,revision:number}`

`Source = {id,name,kind:'text'|'file'|'pdf'|'google-doc',text:string,status:'draft'|'confirmed',version:number,pages:object[],warnings:string[],originalAvailable?:boolean}`

Campaigns also include `pinnedSourceSections: {sourceId:string,version:number,index:number}[]`. PATCH campaign accepts this field; references must match existing confirmed current-version source sections.

`Memory = {id,text,coveredTurnIds:string[],valid:boolean,createdAt:string}`

`Campaign = {id,name,description,instructions,revision:number,notes:string,notesRevision:number,characters:Character[],sources:Source[],settings:ProviderSettings,pinnedSourceIds:string[],budgets:{compaction:number},state:object,memory:Memory|null,createdAt:string,updatedAt:string}`

`Turn = {id,campaignId,requestId,status:'pending'|'running'|'completed'|'failed'|'cancelled'|'interrupted',action,narrative:string|null,changes:string[],error:string|null,undone:boolean,settings:ProviderSettings,context:object|null,createdAt,completedAt:string|null}`

`CampaignDetail = Campaign & {turns:Turn[]}`; turns include full audit with undone flags. GET detail loads latest100 turns; GET turns collection pages full transcript.

## Routes

- GET `/health`: `{status:'ok'|'degraded',database:boolean}` (503 when database unavailable).
- GET `/settings`: `{turnStatuses:string[],sourceKinds:string[],characterTypes:string[],audio:{available:boolean,reason:string|null,maxSeconds:number},lan:{enabled:boolean},limits:{uploadBytes:number}}`.
  Also `combat:{fieldKindOptions,rollScopeOptions,rollKindOptions,limits}`. The response carries no contract version.
  Additional canonical options: `turnStatusOptions[{id,label,active,terminal,completed}]`, `sourceStatusOptions[{id,label,confirmed}]`, `sourceKindOptions[{id,label}]`, `characterTypeOptions[{id,label,default}]`, `ocrLanguageOptions[{id,label,default}]`, `transcriptionLanguageOptions[{id,label,default}]`, and `defaults{characterType,ocrLanguage,transcriptionLanguage,budgets}`. Frontend derives labels/state behavior from these options.
- GET `/providers`: `Provider[]` where `{id,name,available:boolean,supported:boolean,reason:string|null,version:string|null,models:{id,label,efforts:string[],inputTokens:number}[],catalogProvenance:string}`. Installed but unsupported isolation is disabled, not a working adapter. Models are administrator configured/verified options, never guessed dynamic subscription availability.
- GET/POST `/campaigns`; POST `{name,description?,instructions?,settings?}` => Campaign. GET rows are Campaign summaries (same shape; FE can use name/updatedAt).
- GET `/campaigns/:id` => CampaignDetail.
- PATCH `/campaigns/:id` `{revision,name?,description?,instructions?,settings?,pinnedSourceIds?,budgets?,state?}` => Campaign. Revision is informational; older values are accepted.
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
- Memory rebuild (`/campaigns/:id/memory/rebuilds`, all bodies strict, every mutating call carries a UUID `requestId`). Automatic compaction appends each new batch summary to the exact prior valid memory text (separator `\n`), so existing summary text is never rewritten; coverage stays a duplicate-free consecutive prefix. A rebuild reconstructs derived memory from the original active completed turns plus applicable correction guidance, without seeding the model with the current summary:
  - `POST` `{requestId}` => `202` job (replay of the same `requestId` returns the original job; `422 memory_invalid` when there are no completed turns; `409 memory_busy` when another rebuild, Journal task or turn is active).
  - `GET ?limit=1..100&cursor=<offset>` => `{jobs,current,nextCursor}`; `current` is the newest job needing attention (active, ready, failed or interrupted). `GET /:jobId` => job.
  - `POST /:jobId/cancel {requestId}` (state-idempotent), `/resume {requestId}` (only failed or interrupted jobs; a durable receipt makes a repeated request replay instead of launching another attempt; `409 memory_stale` if the story changed), `/apply {requestId,proposalDigest}` => `{campaign,job}` (only a ready draft; the digest covers candidate text, coverage, source identity and target identity), `/discard {requestId}` => `{campaign,job}`.
  - Job: `{id,campaignId,status,statusLabel,active,processedTurns,totalTurns,createdAt,updatedAt,errorCode,safeError,allowedActions,baseline,candidate,decision}`. `baseline` is the public Memory captured at start (or null); `candidate` is `{text,coveredTurnIds,proposalDigest}` only while `ready` or `applied`; `decision` is `{action,requestId,memoryId}` or null. Frozen input, owner and provider data are never exposed.
  - Nothing changes campaign memory except Apply, which verifies the current transcript/correction identity and target memory identity (not revision counters), inserts a new checkpoint and records the decision in one transaction. Old checkpoints are retained. Unrelated edits do not make a draft stale; new turns, undo, accepted corrections or a different current memory do (`409 memory_stale`).
  - Named errors: `memory_busy`, `memory_stale`, `memory_invalid`, `memory_request_reused` (409/422), `memory_database_setup` 503 (run migration 0018), `memory_interrupted` as a job `errorCode`. `GET /api/settings` advertises `memoryRebuild.statusOptions` (`id,label,active,actions`), `actionOptions` and `limits`. While a rebuild is pending/running, gameplay, undo, manual memory, export and Journal tasks return 409 `memory_busy`; a ready draft does not block play.
- Selective history (`/campaigns/:id/history`). Optional `Campaign.historyRecall = {enabled,activeOverviewId,protectedKnowledgeIds,protectedSectionIds,protectedMemoryIds}`; absent means disabled and the prompt carries the full memory exactly as before. When enabled, new contexts carry the overview, protected originals, relevant sections and the newest three pairs; older history the index has not summarized yet stays in the prompt as raw backlog. Nothing is deleted: conversations, memory checkpoints and every earlier index version remain stored.
  - `GET ?query=&kind=&limit=1..100&cursor=` => `{items:[{id,title,kind,sourceTurnIds,startAt,endAt,excerpt,protected,available}],nextCursor,status}`; the cursor is an opaque base64url string bound to the corpus, query and options (an explicit exception to numeric cursors; a mismatch is `422 history_cursor`). `status` = `{enabled,activeOverviewId,protectedKnowledgeIds,protectedSectionIds,protectedMemoryIds,coveredTurns,totalTurns,searchableSections,pendingRefresh,unavailableProtectedIds,diagnostics:{targetBytes,suppliedBytes,mandatoryBytes,overflowBytes,included:[{id,reason}],omitted:{count,reasonCounts}}}`.
  - `GET /:fragmentId?originals=true&limit=1..20&cursor=` => `{item,sourceLocators,originals:[{turnId,player,gm,createdAt}],nextCursor,correctionGuidance:{instruction,items}}`. Original pages default to 4 complete pairs and stop before a whole extra pair would pass a 16,384-byte soft target; one larger pair is returned uncut.
  - `PATCH /protection/knowledge/:id`, `/protection/sections/:id`, `/protection/memories/:id` with `{requestId,expected,protected}` => `{status}`. `PATCH /settings {requestId,enabled:false,expectedEnabled}` only switches off; enabling goes through Prepare, Review and Activate. Mutations verify the expected flag under the campaign lock (not the revision) and are made idempotent by `history_setting_requests` receipts; a changed payload for a used request ID is `409 history_request_reused`, a stale expectation `409 history_changed`. Only public knowledge can be protected; hidden records are 404.
  - `POST /memory/rebuilds {requestId,purpose?}`: purpose `memory` (default, unchanged) or `compact_history`, which stages sections, chapters and an overview from the original turns. Jobs and `GET /api/settings` expose `purpose`/`purposeOptions`; a compact job's `candidate` is the overview text with its source coverage and `compact:{sections,chapters}`. `POST /apply` on a compact job accepts optional `preserveMemory:true` (also protects the exact current memory text), publishes the fragments, retires the previous index to `stale`, and enables selective history; it never replaces `Memory.text`. A stale or changed transcript, correction or active index rejects with `409 memory_stale`.
  - Gameplay tools `campaign_history_search {query,kind?,cursor?}` and `campaign_history_get {id,includeOriginals?,limit?,cursor?}` exist only for attempts that captured `frozenHistory`; legacy attempts keep their original registry. They read the attempt's frozen corpus (a changed fragment is `409 history_source_changed`).
  - Undo retires fragments built from the undone turn and everything derived from them; accepting a Journal correction retires the current index until it is prepared again. Exports carry optional `historyTurnVersions`, `historyFragments`, `campaign.historyRecall` and session/context `frozenHistory`; import validates every reference and hash before remapping and recomputes IDs, hashes and digests afterwards. Older archives import with selective history disabled. `GET /api/settings` advertises `history.{kindOptions,reasonOptions,limits,defaults}`.
- GET `/campaigns/:id/export` => Archive `{format:'local-rpg',campaign:Campaign,turns:Turn[],snapshots:object[],memories:Memory[],diceSessions:object[],diceRecords:object[],combatPreparations:object[],combatPreparedCharacters:object[]}`. Idle campaign only; no paths/credentials/audio/raw files. The archive has no format version.
- POST `/campaigns/import` `{archive:Archive}` => CampaignDetail with new UUIDs. A file carrying `version` was exported by an older app and fails with `422 archive_unsupported` ("This file was exported by an older app and can no longer be imported.").
- POST `/audio/transcriptions` multipart `file`, `language` ('en'/'pt'/'auto') => `{text:string}`. Local FasterWhisper only; no campaign context; diagnostics under settings. No hidden cloud fallback.
- POST `/lan/code` `{}` => `{code,expiresAt}`; desktop loopback only. POST `/lan/pair` `{code}` => `{paired:true}` and HttpOnly device cookie; opt-in LAN only, single use. POST `/lan/revoke` `{}` => `{revoked:true}`; desktop only. Sessions clear on restart. Unpaired LAN campaign reads and writes return `pairing_required`.
- GET `/lan/status` => `{enabled,desktop,paired,expiresAt:string|null,connectUrls:string[],microphoneRequiresHttps:true}`. HTTPS pairing sets a Secure cookie. Device approval expires after twelve hours; code expires after two minutes. Status is available before pairing.

## Frontend behavior

Campaign settings live in Game master: campaign name, Description,
GM instructions, pinned sources and compaction settings. `description` is a player-maintained
summary shown in the campaign library and header. It is excluded from gameplay prompts,
scene selection and memory summarization. Imported sources supply campaign background;
GM instructions control how the game runs. `pinnedFacts`
is retired from campaign DTOs and PATCH requests; migration 0013 removes it without merging its
text. Archives no longer accept it; frozen historical prompts remain unchanged.
The GM does not update Description automatically.
GM auxiliary state and its JSON editor/save action also live in Game master. The Journal
retains campaign memory and private notes; manual memory replacement and saved context inspection
are currently hidden.
Automatic memory summaries request bullet points in the existing `text` field, with
one `- ` item per line. Journal renders bullet-only summaries as lists and retains paragraph
display for older summaries. The format instruction preserves the same information and detail
as a paragraph summary. No database conversion is required.

The Play view places “Load full saved transcript” inside the conversation panel, before any
messages, so it is available at the top when scrolling older messages. The right panel is empty
and reserved for future content. Characters, campaign memory and sources remain available in
their respective campaign sections.
When Play first opens, the conversation scrolls to the latest message after campaign settings
have loaded. Scrolling up to read older messages disables following new messages until the
player returns near the bottom.
The turn-audit and debug checkboxes sit outside and directly below the action composer panel.
The Utility tab contains Download campaign backup, Save campaign template, reusable character templates and Add a character
(including drafting from a confirmed source). Character creation drafts persist across tab changes. Individual
characters retain their Save character as template action in Characters and NPCs.
Character cards show editable Name and Character notes above their sheet sections, without an
Edit character accordion. Save character as template and NPC Delete character sit at the bottom,
with Save character aligned to the right. Player character cards have no Delete character button.
Name and notes stay as local drafts during automatic campaign refreshes and save only through
Save character. A full page reload discards unsaved drafts and opens the saved campaign data.

### Owned NPC lookup tools

Gameplay sessions expose `campaign_npcs_search({query:string,cursor?:string})`
and `campaign_npcs_get({id:uuid})` through the existing private owned tool transport, not HTTP
campaign routes. Search is case-insensitive across saved names and nested description strings,
AND-matches query tokens, and returns `{campaignId,npcs:[{id,name,revision,matchedFields}],nextCursor}`.
Empty query lists the roster. Query length is at most 256 characters, cursor at most 2048, and
page size is 20. Cursors are bound to the frozen campaign snapshot and normalized query.

Get returns `{campaignId,npc:{id,name,type:'npc',attributes,inventory,description,revision},knowledgeLinks}`.
Links contain `{id,title,kind,origin,certainty,status,visibility?}`; use `campaign_knowledge_get`
for the full record. Private notes are excluded. Missing or player IDs produce `npc_not_found`404;
invalid/mismatched cursors produce `npc_cursor`422; invalid arguments use `gameplay_arguments_invalid`422.
Sessions store the roster in `frozenKnowledge.npcCharacters`; archives preserve and remap it.

Revision fields remain in request contracts for compatibility and audit; older values do not reject mutations. refetch after turn completes/cancels/undo. Toolbar changes use PATCH campaign/settings; turn captures settings. Don't lose local unsaved character/composer text while refetching. Read-aloud is frontend local SpeechSynthesis only. LAN opt-in configuration stays a desktop setup feature; unpaired LAN protected reads and writes require pairing cookie.

## Trusted dice and explicit recovery

Every GM response carries `rollInterpretations` (see "One gameplay contract" below). The existing operation constraints still apply. Each interpretation is `{rollId,explanation,corrections?:[{explanation}],afterParagraph?}`; every recorded roll must be referenced exactly once. Unknown, duplicated or missing references are corrected through field repair or reject the answer before any game-state commit. No AI-authored face array is accepted. Source extraction and memory compaction use the no-tools generator.

The dice tool is `roll_dice`. Its strict arguments are `{slot,groups:[{label,count,sides}],reason,declaration,scope,actorId?,targetId?,encounterId?,combatKind?,rerollOf?:{rollId,reason}}`. It generates individual cryptographic faces and performs no bonus arithmetic, keep-high/low selection, success counting or game-rule interpretation. Known modifiers and targets belong in the opaque declaration before reveal; later explained corrections appear separately. Actors/targets must belong to the frozen context; a reroll references an earlier roll in the same logical session.

Backend-owned `GET /settings` adds `dice:{enabled,limits}`. Limits are 12 sequential logical slots (starting at 0), 24 requests per attempt, 8 uniquely labelled groups per call, 50 dice per group, 100 faces per call, 200 new faces per logical session, 2–1,000,000 sides, 4,096 UTF-8 input bytes, 8,192 input/result transcript bytes and a 180-second attempt deadline. Labels/reasons/declarations are capped at 80/240/600 characters. Provider subprocess output remains capped at 2,000,000 bytes. Invalid requests consume the request allowance; attempts stop rather than silently rerolling or dropping transcript context.

`GET /providers` retains ordinary installation/no-tools support and adds separate `dice:{supported,reason}` at provider and model levels. Only verified dice capabilities allow gameplay. Claude uses an exclusive per-attempt loopback MCP capability. Codex replies to pending native dynamic calls using the installed `DynamicToolCallResponse` schema and continues one ephemeral thread/turn. Antigravity 1.2.14 uses actual authenticated private HTTP MCP in an owned temporary profile with exact private tool permissions and excluded ambient customizations; no shared configuration is changed. All execute the persistent DiceService. The CLI owns context/output capacity and inference counts; application generation has no token ceiling or overall AI deadline and remains cancellable. Aggregate input across continuations is distinct from a single context window. New logical actions reconstruct authoritative application context; no cross-action process pool or opaque canonical state. These diagnostics never include endpoint authorization, provider login material or raw CLI logs.

Terminal Turn responses add optional `diceSessionId`, `retryOfTurnId`, `rolls`, `rollInterpretations` and derived `diceRetry:{available,reason}`. Each roll contains its canonical ID/session/campaign, slot, original reason/declaration, groups with individual faces, optional actor/target/reroll references and UTC creation time. Running/pending turns do not expose partial dice. Terminal attempts expose only their own received prefix, so an earlier failure does not acquire rolls generated later by a retry. Derived retry eligibility is advisory; the write rechecks it under locks.

`POST /campaigns/:id/turns/:turnId/retry` accepts strict `{revision,requestId,settings?}` and returns the existing 202 `{data:Turn}` envelope. It creates a new attempt sharing the original logical dice session, action and frozen prompt. Require failed/cancelled/interrupted local status, an idle campaign, no later superseding attempt and an executable local session. Revision or gameplay-digest changes do not block retry. Actual mutation expected values still validate against current state. The selected provider receives the frozen context and saved-dice replay; soft capacity estimates do not block retries. Imported sessions cannot execute.

HTTP uncertainty is resolved with the same request ID and exact input; it never starts another generation. A confirmed terminal retry uses a new request ID. Changing a reused request's payload conflicts. Ordered replay must reproduce the entire original specification/declaration and consume every original slot before appending new randomness. Tool records commit before faces are returned. Cancellation, failed final validation, lease recovery and undo preserve their immutable audit. Only deleting the campaign removes that audit by cascade.

Exports carry canonical `diceSessions` and `diceRecords`, terminal attempt prefixes and interpretation references. Import validates face ranges/limits, exact canonical prefixes, session totals, slot ordering, reroll/actor/attempt links and completed-turn interpretations. Explicit UUID references are remapped; historical prompt/narrative text is preserved. Imported sessions are marked non-executable. Archives exclude active capabilities, credentials and derived retry eligibility. Templates do not carry roll history.

Trusted faces do not mechanically prove that the GM requested every roll required by a game system, interpreted arithmetic correctly or kept narration consistent. The application validates the structured audit and mutations; free-form rule interpretation remains the AI's responsibility.

## Shared current rules libraries

Backend owners: domain/rules.ts (eleven columns, schemas and RULE_LIMITS), ruleStore/ruleLibrary/ruleLookup/ruleBackup and provider gameplay registry. All routes retain Host/Origin/device/write protections and {data} envelopes. Numeric collection continuation is returned in pagination.nextCursor; opaque rule lookup cursors/locators are bound to system/arguments and may expire on server restart.

| Method/path under /api                                | Request / bounded response                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET /rule-systems                                     | limit/cursor; context metadata plus backend-derived isDefault/selectable. Empty/structural-only books are not selectable.                                                                                                                                                                                                      |
| POST /rule-systems                                    | {systemKey,name}; stable safe slug and name; creates an empty library.                                                                                                                                                                                                                                                         |
| GET /rule-systems/:id                                 | Context, instructions, source descriptors, populatedColumns, booksAllowed and served limits; no full tree. Also `sheetLayout`, `sheetLayoutUpdatedAt` and `sheetLayoutOptions` (`widgets`, `limits`); `GET /campaigns/:id/rule-system` serves the same fields.                                                                 |
| PATCH /rule-systems/:id/instructions                  | {revision,requestId,instructions}; <=8192 UTF-8 bytes, idempotent; revision informational; editor stays open.                                                                                                                                                                                                                  |
| PUT /rule-systems/:id/sheet-layout                    | {requestId,sheetLayout}; display-only layout hints validated by the backend (422 `sheet_layout_invalid` with issue paths); idempotent per requestId, 409 when reused with another layout; allowed for library and default systems; never changes revision or content hash. See [sheet layouts](sheet-layouts.md).              |
| POST /rule-systems/:id/imports                        | multipart files plus revision; manifest + exactly listed .md files, <=12 files, <=10 MiB each, <=20 MiB combined during streaming; preview only.                                                                                                                                                                               |
| POST /rule-systems/:id/imports/:previewId/confirm     | {revision,requestId}; atomically replaces one source partition/mapping, preserves instructions/other books; committed identity replays even after consumed preview/later revision.                                                                                                                                             |
| GET /rule-systems/:id/search                          | query, optional columns comma list/source/cursor; <=10 hits, bounded snippet and direct-text locator.                                                                                                                                                                                                                          |
| GET /rule-systems/:id/nodes                           | path/view=text or fields, optional cursor or locator (exclusive); view=children delegates bounded rules_list.                                                                                                                                                                                                                  |
| GET /rule-systems/:id/mapping                         | optional column/cursor; compact paginated column layouts, never exhaustive text/path indexes.                                                                                                                                                                                                                                  |
| PATCH /campaigns/:id/rule-system                      | {revision,requestId,systemId:UUID or null}; idle latest selection; null explicitly chooses protected default; preserves state/history/event memory.                                                                                                                                                                            |
| GET /campaigns/:id/rule-system                        | Effective current metadata or explicit {unresolved}; never silent missing-book fallback.                                                                                                                                                                                                                                       |
| GET /campaigns/:id/rule-system/resolution             | Saved reference, exact-key/kind candidate and hashChanged; no fuzzy name match.                                                                                                                                                                                                                                                |
| POST /campaigns/:id/rule-system/resolution            | Binding payload above; explicitly resolves an unresolved reference/default choice.                                                                                                                                                                                                                                             |
| GET /campaigns/:id/turns/:turnId/rule-reads           | Terminal-owned audit only, numeric cursor; <=16 KiB serialized envelope with explicit continuation; foreign turn/campaign denied.                                                                                                                                                                                              |
| GET /rule-systems/:id/backups                         | Private local-rpg-rules current-row backup in data; <=32 MiB, no PDF/files/scripts/credentials, separate from campaign exports.                                                                                                                                                                                                |
| POST /rule-systems/backups/imports                    | Separate multipart file route <=32 MiB; strict UTF-8/schema/content hash; owned restore preview. Static routes precede UUID detail routes.                                                                                                                                                                                     |
| POST /rule-systems/backups/imports/:previewId/confirm | {systemId,systemKey,revision:number or null,requestId,replace:boolean}; preview identity owns local target, explicit replacement for existing key/default; identity collision fails atomically, imported revision counter ignored. Existing row always advances local revision, even same hash; replay does not advance again. |

Private rule backups carry an optional `system.sheetLayout` outside the hashed content; backups without it still import (a new system gets an empty layout, a replaced one keeps its layout), and the restore preview warns when the backup layout differs. Older app versions reject backups that contain it.

A rules-book manifest requires format/source (slug/title/pageCount/pdfHash nullable), mandatory column/file/hash records, converter id/version, markerFormatVersion=1, coverage description/omissions, optional keyed enrichment. Hashes verify raw uploaded column bytes; original PDF hash is only a declaration when PDF is unavailable. Parser uses strict UTF-8, LF normalization and canonical UTF-16 direct-text offsets after control/navigation-marker removal. It retains original body Markdown/tables/order, recognizes boundaries outside fenced code, requires explicit parents and safe unique slugs, accepts heading-before-marker or marker-before-heading, `pages:-`/`printed:-` and inline PDF markers without a printed label. Recognized header metadata keys: title, edition, publication, converter, version, marker-format, nodes, pages, plus the exact observed splitter generator annotation; unknown controls fail. Actual private eleven-column package validation passed read-only, with unchanged hashes. Owner confirmation of manifest metadata and future enrichment offset semantics remains T001; neither import hashes nor that check certify OCR completeness. `npm run rules:manifest` validates unchanged columns before writing a new manifest outside their directory and refuses overwrites. A manifest or private backup that carries `version` was prepared by an older app and is rejected; regenerate the manifest with `npm run rules:manifest` and export the backup again.

Node-wide PDF page ranges are approximate. Inline page markers produce nonoverlapping canonical direct-text pageSpans; exact quote pages require full known span coverage. Printed labels are separate; missing provenance is unknown. Text evidence validates exact quote/offset membership without semantic certification; visual evidence remains explicit/manual. Structural parents and descendant text cannot support direct citations.

Owned book tools: rules_map/search/get/list plus roll_dice. Tool requests <=1024 bytes, opaque ASCII cursor/locator <=192 chars, query 1–240 chars/<=12 terms, <=10 hits/20 children, serialized result <=4096 bytes, rule request/result transcript <=8192 bytes, rule calls <=12. Dice keep 12 slots/200 faces and a separate 8192-byte dice transcript. Provider model rules capability supplies supported/reason/efforts; verified book combinations are Claude2.1.232 sonnet medium, Codex0.159.2 gpt-5.6-sol medium and Antigravity1.2.14 gemini-3.8-flash low/medium. Claude historical native passes remain evidence; fresh repeat is an explicit user-deferred weekly-quota TODO. No global JSON-upload limit increased.

The shared gameplay registry owns tool name/description/Zod validation/derived JSON schema/purpose/capability budget/handler. Its typed dispatch carries exact definitions to the provider service; transports translate and dispatch generically. Request identity binds tool plus arguments, replay rechecks active ownership and cancellation, and invalid requests retain owned audit/accounting. Future tools require explicit registration in an implemented purpose; the synthetic extension test adds no production tool. Transports return readable JSON; TurnService validates and field-repairs the final response.

Process-local immutable snapshots are keyed by system ID/revision/hash/kind and shared per Store (four entries,64 MiB serialized content). Each access locks the current database row and uses its revision/hash to select the cache entry; owner/lease/cancellation and fresh read receipt persistence remain outside caches. Search caches retain at most8 queries/4096 candidate hits per snapshot; cursors/locators and receipts are newly generated. Stale revisions cannot be returned from cache. `GameplayNativeUsage.cacheReadTokens` forwards actual provider telemetry when reported; absent is unknown, not zero. No subscription cost reduction is promised.

A turn captures lightweight system ID/key/kind/revision/contentHash/name and stores append-only bounded read receipts before reveal. Active owner/lease/cancellation guards apply before every replay/read, dice creation/draw, context rebuild and final commit. Revision changes do not abort attempts. Rule lookups read current available system rows; each receipt records the version actually delivered, and citations bind to that receipt rather than the turn-start revision. Failed/cancelled/undone reads remain audit, excluded from active narrative context. Responses carry ruleCitations: receiptId/path/source/systemId/revision/contentHash/quote/start/end/precision/pdfPages/printedPages. Only exact retrieved direct text supports citations (quote<=600 UTF-16 chars); mapping/search/fields/structural nodes do not. Missing rules and contradictory books remain explicit/provisional model narration rather than executable mechanics.

Campaign import remaps campaign/turn/read/dice IDs and validates saved receipt hashes/provenance/citation offsets; historical captured system UUIDs remain audit metadata, so a missing library can still import. Exact stable key/kind/hash selects a different local UUID; absent/different current content remains explicitly unresolved until choice. Full books are never reconstructed from audit. Imported dice sessions remain non-executable. Templates contain a reference and setup, no history/books. Private backups retain only one current system, regenerate local identity as necessary and restore under an atomic current-row lock.

Principal errors: rules_import_invalid/rules_backup_invalid (422), rules_preview_missing (404), rules_system_empty (422), rules_reference_unresolved/rules_context_changed (409), rules_provider_unavailable (503), rules_request_invalid/rules_budget_exhausted/rules_calls_exhausted (422), rules_attempt_active (409), rules_upload_size/rules_backup_size (413), and existing identity conflict errors (409). See the actual capability report for tested paths and external limitations.

### CLI version compatibility

Provider responses add optional `compatibilityWarning: string | null`. CLI versions differing from the recorded tested baselines no longer disable discovery, dice or book gameplay. The warning is informational and must not be treated as `reason` or as unsupported capability by clients. Required flags, subscription authentication, model/effort constraints, context limits, owned tool isolation and runtime response validation still apply. Selection and Settings show the warning; actual failed turns retain their visible errors. Recorded version/model evidence above is historical test coverage, not an exact-version allowlist.

Current import policy: all successful source imports, including PDFs, public Google Docs and pasted text, create confirmed sources immediately. Source review/correction and explicit draft status remain supported but are optional. No review step is required between upload and GM use or character draft generation. Invalid/empty/oversized inputs remain rejected.

Character parsing accepts imported UTF-8 text in any extension (including JSON/Markdown/YAML), or locally extracted PDF text, and normalizes it through the selected LLM into the existing draft JSON schema. It uses actual serialized UTF-8 request bytes and available provider capacity. Oversized single requests are split into sequential bounded sections, merged and validated instead of asking the user to shorten the sheet. Source text remains saved and no section is silently discarded. Campaign revisions do not invalidate parsing; the resulting draft still requires explicit confirmation. Binary/invalid UTF-8 inputs remain rejected.

### CLI capacity and automatic response repair

Gameplay has no configurable size ceiling: relevant retrieved passages and matching campaign facts are included without a token gate. New gameplay contexts always include the latest three completed, non-undone player/GM text pairs, using the final delivered narrative, plus any older uncovered backlog. History entries contain only player/gm text; IDs remain in the manifest, and dice/tool audit is not repeated in these entries. Existing summary overlap is preserved; frozen retries keep their original context. Compaction covers only older uncovered turns, triggered above 6,000 UTF-8 bytes of eligible history or a missing prompt, never by protected-only history. It retains a consecutive-prefix batch target (default 32,768 UTF-8 bytes, measured by the conservative estimator). Legacy gameplay/memory budget fields are accepted and discarded from edits/imports. Mandatory context is preserved even above a target. Native CLI context/output/compaction and inference limits apply; the app adds no AI attempt deadline. Ordinary generation, field repair and narrative editing also accept successful CLI responses above soft capacity, or without token-usage telemetry; usage is diagnostic rather than an admission gate, including partial or malformed usage metadata. Memory checkpoints are accepted above their soft target for manual saves and archive imports. Explicit model catalogs accept any positive input-token target. Successful isolated completion and valid response JSON remain required. Active turn Cancel remains available. Version warnings remain informational, and installed model-supported efforts plus Default are accepted.

Readable responses use field-only repair: application validation identifies allowed paths; a tools-free call to the same CLI/model/effort returns path/value corrections, which are checked and fully revalidated. Narrative and other valid fields stay unchanged. Citation offsets/pages are computed in code from exact, uniquely identifiable supplied quotes; computed fields are optional only on the CLI wire contract and remain required in storage/archives. Invalid or ambiguous quotes still require correction. Citation binding gathers every independently invalid citation path in one correction request, within the existing two-call repair limit; valid citations and unrelated fields remain protected. Without prior or proposed encounter participants, nonempty participantReferences authorizes correction of the whole collection to [], applied in code without a correction call (`field_repair_deterministic` trace event on the turn); ordinary character mentions do not register combatants. Reference corrections carry UUID schemas and explicit encounter-only guidance. Exhausted repair reports the invalid field and validation reason. Restricted repair failure stops without automatic scene regeneration. Unreadable JSON and pre-final generation failures retain up to two generation retries with saved-dice replay. Both correction loops stop on quota, cancellation, changed ownership or request context or forbidden capabilities. Diagnostic prompts and responses remain local Git-ignored logs. The UI keeps an animated busy indicator and an editable next-action draft.

Invalid Antigravity `call_mcp_tool` gateway server/tool envelopes use recoverable `gameplay_tool_unavailable`: dispatch is denied, the provider attempt closes, and correction feedback identifies the owned registry. Saved dice/context remain unchanged. Actual native capability violations retain non-retryable isolation errors. Argument-free DONE metadata is accepted only for an already validated/dispatched owned tool step.

The private HTTP MCP server supports `resources/list` and `resources/templates/list` with empty lists; resource reads remain unsupported. Antigravity is instructed to use the supplied gameplay registry without resource discovery. Its stream accepts `list_resources` and `list_resource_templates` only with an exact `ServerName: local_rpg` envelope and a fresh nonnegative step index. DONE metadata must match that discovery step; it may omit the envelope. Discovery does not dispatch gameplay, consume dice identities or expose data. Foreign discovery, extra arguments, resource reads and reused gameplay identities retain isolation failures.

### Campaign knowledge and instruction contract

Book and no-library actions share one response shape (see "One gameplay contract" below);
no-library citations are empty.
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

Root dice sessions persist the exact `systemPrompt`,
`frozenKnowledge:{campaignId,records,npcCharacters,characters:[{id,name}],sourceIds,sourceVersions:[{id,version}]}`,
`frozenSources` and `toolDefinitions:[{name,description,inputSchema}]` once; `frozenPrompt`
holds the exact user input. Retries use these immutable fields; a retry whose frozen tool
definitions differ from the current registry fails with "start a new action". Sessions created
before the instruction envelope have no system prompt and cannot be retried. Derived memory never
overrides knowledge certainty/status/evidence. Snapshots hold only touched
`beforeKnowledge`/`afterKnowledge` records; snapshots without them made no knowledge change,
never clearing the registry.

Archives validate/remap knowledge, attribution turns, character/source links,
book receipt links, undo snapshots and frozen session metadata consistently. Deleted
character/source links remain historical with retained names/quotes; structural UUIDs
receive new identities while narrative, private text and historical prompt strings
remain exact audit text. Imported sessions are non-executable. Templates retain setup and portable book references, excluding knowledge timeline,
turns, receipts, snapshots and frozen sessions.

`GET /api/campaigns/:id/turns/:turnId/context` loads the existing saved context
inspection on demand. It returns `{data: ContextManifest|null}`. Contexts hydrate exact
system/user inputs, frozen knowledge and definitions from the immutable owning root session;
ordinary campaign/turn lists retain only the reference. Turns whose session predates the
instruction envelope return their saved manifest. Cross-campaign IDs return 404.

If a session cannot be created because database columns are missing, the turn
fails before a CLI call with an actionable `setup-database.cmd` migration message
instead of the generic invalid-response message. No game changes are committed.

## Audited gameplay

Campaign sources have a `purpose`: `campaign`, `character` or `reference`. Sources
saved without a purpose are treated as references. Confirmed source text
is frozen for each action. Opening turns include deterministic source excerpts; the GM
can retrieve more through `campaign_sources_search` and `campaign_sources_get`.
`campaign_sources_search` takes either one `query` (with an optional `cursor`) or `queries`:
up to 6 distinct terms answered in one call as `{ results: [{ query, entries, nextCursor, reason }] }`,
one group per query in input order. Each group equals the single-query result, pages
independently, and continues with a single `query` plus its `cursor`; `sourceId` applies to every
query. A batch is persisted as one read receipt. Changing the tool schema changes the frozen tool
definitions, so an action whose dice session was frozen before this change fails a retry with
409 `dice_context` once; start a new action.
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
without another GM generation or dice roll. Revision changes do not prevent resume; expected mutation values still validate before commit.
Cancel abandons the pending candidate. Pending editing blocks new actions.

Local trace records correlate the action, provider attempts, tool requests/results,
validation, editor and commit. `traceWarning` reports incomplete post-save logging;
it does not undo a committed turn or trigger another roll.
Antigravity `native_completion` records completion status, reported turn count, response
presence/length and pending dispatch count before validation. Rejected completion messages
identify the failing condition; diagnostics do not store the rejected response text.
Antigravity `provider_stage_start`/`provider_stage_end` events separate `hooks`,
`agent_setup`, `prompt_logging`, `generation_process` and `agent_cleanup`. End events
record status, monotonic `durationMs`, elapsed time since adapter entry (`elapsedMs`)
and a classified failure code when applicable, using the existing execution/turn/purpose
correlation. `generation_process` includes subprocess startup and all CLI inference/tool
work; it is not a measurement of model inference alone. Stage diagnostics contain no
environment, credentials or raw subprocess output and impose no execution deadline.
Antigravity Settings discovery reads CLI help, version and model catalog without running
the ambient-profile `/hooks` command. Hook isolation is checked at each actual generation
in its launch environment; a successful empty-hooks check is reused for 10 minutes per launch
environment (an owned temporary profile counts as one environment), and the `hooks` stage end
reports `cached`. Failed or nonempty checks are never cached. A slow or customized ambient profile does not disable gameplay
during Settings refresh. CLI discovery failures retain their diagnostic reason.

### Rule-read accounting after migration 0011

`rules_search` entries may include `alreadySupplied`,
`originalComplete` and `suppliedOriginals` receipt locators for original text delivered
in that execution at the same rule revision/hash/path. `rules_find` returns those
locators and skips automatic rereads of complete originals. Partial or explicit
`rules_get` reads remain available; metadata alone cannot support a ruling.
Restricted response corrections select evidence through invalid-field references,
with full-context fallback for unresolved references or collection errors. This does
not change response schemas, allowed correction paths or provider effort.

Rule lookups have no accumulated request-count or transcript-byte ceiling. The database
keeps nonnegative audit counters and immutable receipts. Responses remain paginated;
a cursor requests the next page. Archives preserve receipt totals without a size ceiling.

Private tool-failure traces retain `database.sqlState` and safe table/column/constraint
identifiers. A PostgreSQL CHECK rejection is classified as `database_constraint`, rather
than an unrelated local-service connection failure. SQL text, rejected row values and
raw database messages are omitted.

Current source navigation adds `sections: {sectionIndex,title,headings:string[],supplied:boolean}[]` to each campaign source catalog item. Search entries add `title` and `alreadySupplied`; get receipts add the same fields alongside the unchanged original source span and receipt ID. These additive diagnostics preserve frozen historic payloads and immutable receipt replay. Supplied tracking is execution-local, covers only complete original sections and advances after successful persistence; repeated reads remain unrestricted.

Narrative-only editing retains the GM provider/model but selects advertised `low`, then the lowest canonical advertised effort, then CLI default (`null`). GM settings are never modified. The selected editor effort is reused for its correction attempts. Field-only mechanical response repair continues to use the GM effort. Editor failure still withholds delivery until the stage succeeds.

### Combined book lookup

Book turns advertise `rules_find` through the owned native registry for Claude, Codex and Antigravity. It accepts the same arguments as `rules_search`: query, optional columns/source, and an optional search cursor. Search ranks whole Unicode terms across titles, aliases and original text, with conservative plural normalization and partial matches. Exact titles lead; summary-only matches remain derived navigation. Results identify matched terms, exact title matches and `readableOriginal` eligibility. This lexical search does not adjudicate rules or guarantee semantic matches.

`rules_find` returns `search`, `reads`, `suppliedOriginals` and `unreadPaths`. The supplied-original index lists successful nonempty original-text receipts with path, start/end, complete and nextRead. Copy nextRead verbatim for partial-read continuation; a complete read has nextRead null. Reuse these already delivered originals for evidence; intentional rereads remain unrestricted. Path values must be copied from tool results, never synthesized or converted to slash notation. It searches once, then reads the first three nonstructural, nonempty originals on that search page, sequentially from offset zero. Each original has an ordinary persisted `rules_get` receipt and continuation cursor. Reuse those originals for citations; retrieve additional windows/paths with the existing tools. Three reads are an initial payload choice, not a total lookup limit. Search and original pages retain their existing per-receipt pagination.

The wrapper stores only constituent search/get receipts, with deterministic child request IDs. Each child rechecks ownership, cancellation and captured library identity. Interrupted/replayed calls reuse committed children across lookup restarts without ephemeral locators. Old search/get cursors themselves remain execution-scoped and can expire; restart lookup when necessary. Retries reuse their frozen tool definitions and instructions.

### Inline roll placement

Roll interpretations may include `afterParagraph`, a positive 1-based index into blank-line-separated narrative paragraphs. The gameplay prompt requests it for every roll. Indices beyond the narrative are rejected. The narrative editor preserves paragraph count and order when placement is present. Stored turns and archives without placement remain supported. The Play transcript shows trusted rolls, declarations, interpretations and corrections directly after their linked paragraph, independently of debug information. Unplaced historical rolls and terminal attempts without narration append results at the end of the same GM message, without a separate box. Read-aloud uses only the original narrative text and offsets.

## Individual combat identity

- Every combatant is its own character sheet and UUID. Before combat dice, the GM calls the owned
  tool `combat_prepare` once per batch: `{localKey, encounterId?, participants:[{characterId,label,trackedFields} | {localKey,label,character:NpcDraft,introduction,trackedFields}]}`.
  New NPC drafts (`type:'npc'`, no notes, public `introduction`) receive server-reserved UUIDs.
  The tool is idempotent by batch `localKey` and per-individual `localKey`; reuse with different
  arguments fails with `combat_preparation_conflict`. One logical action (dice session, shared by
  its retries) prepares at most one encounter; later batches continue it. Preparation writes only
  append-only receipts (`combat_preparations`, `combat_prepared_characters`, migration 0014);
  nothing is published until the turn commits. Batches may reach 1 MiB of UTF-8 arguments (plus a
  64 KiB JSON-RPC envelope); other tools keep their 1024-byte argument ceiling.
- `trackedFields` are `{path,kind:'vitality'|'damage'|'condition'|'resource',label}`; paths are
  1–16 own-property segments inside `attributes` (no prototype keys, no prefix overlaps) and must
  already exist. At least one `vitality` or `damage` field is required. Values stay on the sheet.
- `state.combat` is absent or exactly `{id,active,round,participants:[{characterId,label,trackedFields}]}`;
  any other value fails with `combat_state`. Free-form combat notes belong in `state.combatNotes`,
  which the app never interprets as identities. An active encounter ends only with `active:false`;
  a new encounter ID must come from `combat_prepare`.
- `roll_dice` requires `scope`: `combat` (`encounterId`, `combatKind`, prepared `actorId`;
  attacks also `targetId`), `character`, or `oracle` (no actor/target). Participants of the
  active/prepared encounter roll with combat scope. Prepared IDs are authorized by receipt; the
  frozen session character list is unchanged.
- A prepared NPC is created by its exact `create` operation with `characterId` and
  `preparationReceiptId`. Response fields `combatEffects[{characterId,operationIndex,paths,reason,rollIds,afterParagraph}]`
  and `participantReferences[{afterParagraph,characterIds}]` are required structures: every change
  to a tracked path needs an effect on an attributes `set`; every effect and combat-roll participant
  needs a paragraph reference. Errors: `combat_identity`, `combat_preparation_conflict`,
  `combat_state`, `combat_effect`, `combat_reference`. Effect/reference/state paths are repairable;
  prepared identities and receipts are not.
- Committed turns expose `combatEffects` and `participantReferences`; receipts and drafts are never
  in player projections. Manual PATCH cannot create, replace or remove the structured encounter
  (an ended one may be removed) and cannot write free-form data into `state.combat`; free-form
  notes go to `state.combatNotes`. Character edits keep tracked paths but may change values;
  deleting an active participant returns 409.
- Archives carry `combatPreparations` and `combatPreparedCharacters` and remap encounter,
  receipt and participant IDs in state, snapshots, rolls, effects and references; free JSON and
  text keep historical UUIDs. Templates never carry state.

## One gameplay contract

The GM returns one strict JSON shape without a version field:
`{narrative,operations,rollInterpretations,ruleCitations,knowledgeChanges,operationExplanations,combatEffects,participantReferences}`.
A `create` operation carries an `introduction` with `visibility` and, for a prepared NPC,
`characterId` and `preparationReceiptId`. A response that carries `version` is rejected. Recorded
dice from before combat tracking keep no `scope`; every new request requires one.

Migration 0015 applies this contract to stored data. It refuses to run while any turn is pending,
running or awaiting narrative editing ("Finish or cancel pending turns before upgrading"), and
when a state holds both free-form `combat` and `combatNotes`. It moves any `state.combat` without
the former tracking marker (including JSON `null`) to `state.combatNotes` in campaigns and in
both snapshot states, removes the marker from structured encounters, removes retired contract
keys from saved turn contexts, and drops the `dice_sessions` contract columns while keeping
sessions immutable. Failed or cancelled turns recorded before the upgrade can no longer be
retried; start a new action.

## Journal knowledge browser

Read-only player projection of canonical campaign knowledge under `/api/campaigns/:id/journal`. No AI call is made.

- `GET /entries?query=&includePast=false&cursor=&limit=20` returns `{entries, groups, counts, total, nextCursor}`. `groups` carries backend-owned order and labels (`people_places`, `unfinished_business`, `discoveries`). Default shows active entries; `includePast=true` adds resolved/retracted ones. `limit` is 1..100 and `query` at most 200 characters. The cursor is bound to the query, filter and view digest; a changed view returns 409 `journal_changed`, a malformed cursor 422 `journal_invalid`.
- `GET /entries/:entryId` returns the full permitted text, connections (records sharing a linked character), evidence locators and attribution history.
- `GET /entries/:entryId/evidence/:evidenceId` returns a turn locator (with availability) or only the recorded quote of a campaign-source or book citation, never the whole source.
- Visibility: `publicKnowledge` runs first; `gm_only` records and `belief` certainty records never appear in lists, search, counts or details (404 `journal_not_found`). Kinds map npc/place to people and places, debt/objective to unfinished business, event/relationship/other to discoveries.
- Overviews are at most 400 characters (180 for completed items, labeled `excerpt`). A generic "X was introduced." NPC record is supplemented with the linked character's public description text only.
- `GET /api/settings` advertises `journal.groupOptions` and `journal.limits`.
- Frontend deep links: `/campaigns/:id?tab=journal&entry=:entryId` and `/campaigns/:id?tab=play&turn=:turnId` (loads the turn by id).

Jobs (all `POST` bodies are strict and carry a UUID `requestId`; `202` starts a durable job, replays of the same identity return the original job, a different body for a used identity is 409 `journal_request_reused`):

- `POST /backfills {requestId}` runs a whole-history, tools-free backfill with the campaign's selected CLI/model.
- `POST /entries/:entryId/checks {requestId, explanation}` (`explanation` 1..2000 characters) checks one recorded fact; the target must be a visible, non-belief record (404 otherwise).
- `GET /jobs/:jobId` returns `{id, jobId?, kind, status, statusLabel, active, progress, error, finding, decision, createdAt, updatedAt}`. `progress` is `{processedPairs, eligiblePairs, created, skipped}`, never a percentage; `finding` is `{outcome, outcomeLabel, reason, knowledgeId, proposalDigest, changes[{field,label,before,after}], evidence[{turnId,field,quote}]}` and never includes frozen inputs or raw model output.
- `POST /jobs/:jobId/cancel {requestId}` is idempotent. `POST /jobs/:jobId/retry {requestId}` resumes an interrupted or failed uncommitted job with its original capture (409 `journal_changed` when facts or history changed).
- `POST /jobs/:jobId/accept {requestId, proposalDigest}` updates the same canonical record, records the correction, retires every memory row and returns `{decision, entry}`; `POST /jobs/:jobId/dismiss {requestId}` changes nothing. A job has one terminal decision; the same request replays it. Findings that are not `proposed` cannot be accepted (422 `journal_invalid`).
- Named errors: `journal_not_found` 404; `journal_invalid`, `evidence_invalid` 422; `journal_busy`, `journal_changed`, `journal_proposal_changed`, `journal_request_reused`, `journal_correction_conflict`, `journal_correction_evidence`, `journal_context_changed` 409; `journal_provider_unavailable`, `journal_database_setup` 503.
- While a job is pending/running, gameplay, retry, undo, resume-editing and export return 409 `journal_busy`; reads and personal notes stay available.
- `GET /api/settings` also advertises `journal.jobKindOptions`, `jobStatusOptions` and `checkOutcomeOptions`.

Detail history items are `{at, kind: recorded|updated|recovered|corrected, origin, turnId, summary, changes?, reason?}`. A correction never rewrites the original conversation, sheets, inventory or campaign state.

Archives: the current unversioned campaign archive gains the optional `campaign.journal` ledger (`events`, `coverageTurnIds`, `undoneTurnIds`). Import validates digests and quotes against the archived transcript and remaps ids; archives without it import with an empty ledger, numbered archives remain `archive_unsupported`, and templates never include it.
