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
- POST `/campaigns/:id/sources` JSON `{revision,name,text}` => Campaign (draft, not used by GM).
- POST `/campaigns/:id/sources/extract` multipart `file`, `revision`, `language` ('eng'/'por'/'eng+por') => Campaign with extracted draft; or JSON `{revision,url,name?}` public Google Docs only. Text/MD/PDF up to20MiB; PDF requires configured local Python dependencies. No browser file paths.
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

`GET /providers` retains ordinary installation/no-tools support and adds separate `dice:{supported,reason}` at provider and model levels. Only verified dice capabilities allow gameplay. Current Claude dice transport uses an exclusive per-attempt loopback MCP capability; Codex uses one native dynamic-tool call per interrupted phase, then a fresh ephemeral process/thread with the bounded application-owned transcript; no opaque continuation history is carried forward. Models require a verified native context budget, and assembled phase bytes, aggregate output bytes and the overall deadline are bounded. Antigravity dice is unsupported until exclusive owned-tool attachment is verified. These diagnostics never include endpoint authorization, provider login material or raw CLI logs.

Terminal Turn responses add optional `diceSessionId`, `retryOfTurnId`, `rolls`, `rollInterpretations` and derived `diceRetry:{available,reason}`. Each roll contains its canonical ID/session/campaign, slot, original reason/declaration, groups with individual faces, optional actor/target/reroll references and UTC creation time. Running/pending turns do not expose partial dice. Terminal attempts expose only their own received prefix, so an earlier failure does not acquire rolls generated later by a retry. Derived retry eligibility is advisory; the write rechecks it under locks.

`POST /campaigns/:id/turns/:turnId/retry` accepts strict `{revision,requestId,settings?}` and returns the existing 202 `{data:Turn}` envelope. It creates a new attempt sharing the original logical dice session, action and frozen prompt. Require failed/cancelled/interrupted local status, current revision, idle campaign, no later superseding attempt and unchanged canonical gameplay digest. Private notes, timestamps and provider preferences do not alter that digest; game state, rules, sheets, memory and active history do. The selected provider must fit the frozen context and its bounded replay reserve. Imported sessions cannot execute.

HTTP uncertainty is resolved with the same request ID and exact input; it never starts another generation. A confirmed terminal retry uses a new request ID. Changing a reused request's payload conflicts. Ordered replay must reproduce the entire original specification/declaration and consume every original slot before appending new randomness. Tool records commit before faces are returned. Cancellation, failed final validation, lease recovery and undo preserve their immutable audit. Only deleting the campaign removes that audit by cascade.

Exports now use `local-rpg` archive version 2 with canonical `diceSessions` and `diceRecords`, terminal attempt prefixes and interpretation references. Import also accepts version 1, normalizing absent dice arrays to empty arrays. Version-2 import validates face ranges/limits, exact canonical prefixes, session totals, slot ordering, reroll/actor/attempt links and completed-turn interpretations. Explicit UUID references are remapped; historical prompt/narrative text is preserved. Imported sessions are marked non-executable. Archives exclude active capabilities, credentials and derived retry eligibility. Templates do not carry roll history.

Trusted faces do not mechanically prove that the GM requested every roll required by a game system, interpreted arithmetic correctly or kept narration consistent. The application validates the structured audit and mutations; free-form rule interpretation remains the AI's responsibility.
