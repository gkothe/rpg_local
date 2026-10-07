import type { FlowEdge, FlowItem, FlowStep, FlowTool } from './types';
import {
  ids,
  npc,
  knowledgeGetResult,
  knowledgeSearchResult,
  ruleResult,
  ruleReceiptId,
  ruleContext,
  combatPrepareArgs,
  combatPrepareResult,
} from './examples';

function item(
  id: string,
  label: string,
  summary: string,
  timing: string,
  input: string,
  output: string,
  storage: string,
  section: string,
  sources: string[],
  detail?: string
): FlowItem {
  return { id, label, summary, timing, input, output, storage, section, sources, detail };
}
export const nodes: FlowItem[] = [
  item(
    'browser',
    'Browser',
    'You enter an action in the journal. Once the app accepts the result, the journal shows the story and any saved changes. Trusted rolls follow their linked narrative paragraph; rolls without placement append to the same GM message.',
    'When you submit an action and when the app reports progress.',
    'Your action, the current campaign version (revision), and a request ID that identifies this submission.',
    'The browser sends a POST request to the turn API. It then receives progress events (SSE) and checks the backend for the saved result.',
    'Your unsent draft stays in the browser. The database holds the saved campaign.',
    '2.1',
    ['rpg_fe_local/src/features/journal/Journal.tsx', 'rpg_be_local/src/app.ts']
  ),
  item(
    'api',
    'Access boundary / API',
    'The backend checks that this device has access and that the request has the required fields. It then passes the action to TurnService.',
    'Whenever the browser sends a request.',
    "The browser request and the device's access status, including pairing when LAN access requires it.",
    'A checked action and request ID, or an HTTP error explaining why the request failed.',
    'These checks run before the app calls the model.',
    '2.1',
    ['rpg_be_local/src/app.ts', 'rpg_be_local/src/security.ts']
  ),
  item(
    'turn',
    'TurnService',
    'TurnService manages one attempt to resolve your action. It checks the campaign version and prevents competing turns. If the same request arrives again, it returns the original result.',
    'After the access checks, throughout the turn, and when saving the result.',
    'The checked action, its requestId, and an informational campaign revision.',
    'The turn moves from pending to running, then finishes as completed, failed, cancelled, or interrupted.',
    'PostgreSQL stores the turn and its temporary permission to run, called a lease. A campaign lock prevents competing turns.',
    '2.2',
    ['rpg_be_local/src/services/turns.ts'],
    'Required narrative editing is a separate stage: resume it without replaying gameplay or rolling again. A pending turn has a 45-second lease. Every 10 seconds, a heartbeat checks cancellation and ownership. Revision changes do not interrupt the attempt, and rule lookups use current system rows. Recovery checks for expired leases every 15 seconds and marks those turns interrupted. You must request a retry to run the AI again.'
  ),
  item(
    'context',
    'Context builder',
    'The context builder prepares the information the model will receive: GM instructions, saved character sheets, scene facts, earlier turns, and reference text. Campaign context settings live in the Game master tab. Description is a player summary shown in the library and header; it is not sent to the GM.',
    'Before the model responds. The app may first summarize older turns to shorten the context.',
    'The saved campaign, completed turns that have not been undone, confirmed source excerpts, and the selected rule system.',
    'Separate system instructions and a JSON user prompt. The app also keeps a ContextManifest that records what it selected, and saves a fixed copy for this attempt.',
    'The app reads PostgreSQL and copies campaign knowledge into memory for the turn. It leaves private notes out of the gameplay context it builds automatically.',
    '4.3',
    ['rpg_be_local/src/domain/context.ts', 'rpg_be_local/src/domain/knowledgeRecall.ts'],
    'Every context includes a catalog of confirmed campaign documents and frozen source tools. The opening turn includes preparation seeds even for a short action such as start. Both public and hidden knowledge can reach the GM; only public projections reach the player. The prompt includes every player sheet. The app selects NPCs by names or IDs mentioned in the scene, and always includes every participant of an active encounter. It also selects relevant campaign knowledge and searches source text for matching words. Gameplay has no token target: relevant retrieved sections and matching campaign facts are included without size-based omission. History is summarized in consecutive batches independently of gameplay prompt size. Memory summaries request bullet points while preserving the same information as paragraph summaries. Summaries can lose detail, so the app keeps the original turns.'
  ),
  item(
    'model',
    'Provider CLI / LLM',
    "The selected provider's language model writes the story and proposes campaign changes. It can also ask the app to run one of the allowed tools.",
    'While the app waits for the model, before it opens the transaction that saves the gameplay result.',
    'System instructions, the fixed user prompt, the required response format (schema), allowed tool definitions, and any tool results.',
    "Tool requests followed by a final JSON proposal in the app's response format.",
    "The app runs locally, but the model response comes from the provider's cloud service.",
    '2.3',
    [
      'rpg_be_local/src/providers/claudeDice.ts',
      'rpg_be_local/src/providers/codexDice.ts',
      'rpg_be_local/src/providers/antigravityDice.ts',
    ],
    'The app launches the provider through its command-line program (CLI). Claude and Antigravity exchange tool messages through a private local HTTP MCP server. Codex uses its app-server through standard input and output (stdio). The configured session disables other native tools. The launched process still needs provider authentication and may inherit sensitive environment values.'
  ),
  item(
    'tools',
    'Owned tool registry',
    'The tool registry checks each requested tool and its arguments. The app runs calls one at a time and sends each result back to the model.',
    'Whenever the model requests a tool while resolving the action.',
    'An allowed tool name and arguments in the required JSON format.',
    "Recorded dice results, campaign knowledge from the turn's fixed copy, or rulebook navigation and text. Rule reads also have saved records called receipts.",
    "Dice results and rule reads are saved separately from the final gameplay result. Knowledge lookup uses the turn's copy in memory.",
    '2.3',
    [
      'rpg_be_local/src/providers/gameplayTools.ts',
      'rpg_be_local/src/services/dice.ts',
      'rpg_be_local/src/services/ruleStore.ts',
    ],
    'Default mode has five tools, including campaign source search and reading. Book mode adds four rulebook tools. The model cannot use these tools to run arbitrary SQL, shell commands, file access, or network requests. Instructions tell it when to call a tool; the app does not automatically verify every decision against the game rules.'
  ),
  item(
    'validate',
    'Validate and edit narration',
    'The app validates gameplay first, then sends only the final narrative to a separate editor call. No gameplay change reaches the player until both stages succeed.',
    'After the model responds and before the app saves the gameplay result.',
    'The response: story text, proposed changes, explanations of dice rolls, rule citations, campaign knowledge changes, and combat effects and paragraph references for each combatant.',
    'Validated changes, their explanations and a prose-only edited narrative. An editing failure preserves the private candidate for editing-only resume.',
    'A rejected proposal leaves the saved gameplay state unchanged. The app can request up to two corrections, sending evidence linked to the invalid fields. A collection whose only valid value is empty (no encounter participants) is corrected in code without a correction call. Unresolved references or collection errors retain the complete evidence bundle.',
    '5.1',
    [
      'rpg_be_local/src/domain/gameplayResponse.ts',
      'rpg_be_local/src/domain/state.ts',
      'rpg_be_local/src/services/turns.ts',
    ],
    "The app checks roll IDs, quoted text and its saved receipt, the origin of new facts, and expected previous values. It does not prove that the story's arithmetic or interpretation of a rule is correct. Mechanical mutations need indexed explanations backed by current state, original sources or saved dice. Hidden explanations remain private. The editor receives no campaign JSON, rules or tools and cannot change operations. A response may have no citations. The app computes citation positions and pages from exact supplied quotes without an AI call. Every change to a tracked combat field needs a combat effect on the same character, and every effect and combat roll needs a paragraph reference; this proves the links, not the rules. Readable v6 response errors use tools-free CLI corrections restricted to invalid field paths; the narrative and valid fields stay unchanged. When no encounter participants exist, references must be empty; repair may clear that invalid collection while preserving the narrative and saved dice. Participant corrections use UUID schemas. Exhausted repair reports the invalid field and reason, then stops instead of regenerating the scene. Unreadable JSON retains generation retries with saved-dice replay. Editor repair is separate and never replays gameplay."
  ),
  item(
    'commit',
    'Atomic commit / return',
    'The app saves an accepted result only if the attempt still has permission to finish. The browser then refreshes the saved campaign.',
    'In the final database transaction, after the model has finished.',
    'The checked changes and snapshot, plus a final check of the attempt, campaign version, and selected rules.',
    'The updated campaign version, completed story, and snapshot, saved together.',
    'PostgreSQL saves the gameplay result as one transaction: all of it succeeds or none of it does. Earlier summaries, dice results, and rule receipts may already be saved.',
    '5.2',
    ['rpg_be_local/src/services/turns.ts', 'rpg_be_local/src/store.ts'],
    "Undo restores the fields this turn changed. It first checks that later edits have not changed those same fields. It keeps unrelated edits, private notes, and the turn's history."
  ),
  item(
    'database',
    'PostgreSQL',
    'The backend reads and writes the database. The model receives the data the app selects and returns through tools; it has no direct SQL connection.',
    'When preparing context, answering permitted tool calls, or saving a result.',
    "Read and write requests from the app's Store, rule, and dice services.",
    'Saved campaign data, turn history, searchable source excerpts, rule text, and records of tool calls.',
    'PostgreSQL keeps data between app runs. Knowledge lookup tools use the fixed copy the app already loaded into memory for the turn.',
    '3.1',
    ['rpg_be_local/src/store.ts', 'rpg_be_local/src/services/ruleStore.ts']
  ),
];
const edgePairs = [
  [
    'request',
    'browser',
    'api',
    'Action request',
    'Your action, the campaign version, and its requestId',
  ],
  [
    'dispatch',
    'api',
    'turn',
    'Validated dispatch',
    'The checked request after the device passes access checks',
  ],
  [
    'prepare',
    'turn',
    'context',
    'Prepare context',
    'The current turn and the campaign version it must use',
  ],
  [
    'prompt',
    'context',
    'model',
    'Send prompt',
    'System instructions, the JSON user prompt, and allowed tool definitions',
  ],
  [
    'call',
    'model',
    'tools',
    'Request a tool',
    'The tool name and arguments to check before execution',
  ],
  [
    'result',
    'tools',
    'model',
    'Return tool result',
    'Dice results, campaign knowledge, or rulebook text',
  ],
  [
    'proposal',
    'model',
    'validate',
    'Final proposal',
    'A JSON proposal that the app has not yet saved',
  ],
  [
    'write',
    'validate',
    'commit',
    'Commit edited accepted result',
    'Checked changes, reasons and snapshot plus required narrative-only edit',
  ],
  [
    'refresh',
    'commit',
    'browser',
    'Refresh journal',
    'A progress event followed by a fresh read of the saved campaign and turn',
  ],
  [
    'dbread',
    'database',
    'context',
    'Read context data',
    'The app reads saved campaign data, history, and source excerpts',
  ],
  [
    'dbtool',
    'tools',
    'database',
    'Tool service I/O',
    'The app saves dice results and reads rules with receipts. Knowledge lookup uses memory.',
  ],
  [
    'dbwrite',
    'commit',
    'database',
    'Atomic database write',
    'The campaign version, snapshot, and completed turn, saved together',
  ],
] as const;
export const edges: FlowEdge[] = edgePairs.map(([id, from, to, label, data]) => ({
  ...item(
    id,
    label,
    `${nodes.find((n) => n.id === from)!.label} → ${nodes.find((n) => n.id === to)!.label}`,
    'When information passes between these two parts of the system.',
    data,
    data,
    'Select the sender or receiver to see which data it reads and saves.',
    id === 'call' || id === 'result' ? '2.3' : '2.2',
    ['rpg_be_local/src/services/turns.ts']
  ),
  from,
  to,
}));
export const steps: FlowStep[] = [
  {
    id: 'request',
    label: '1. Submit an action',
    node: 'browser',
    data: 'Mira says, "I cross the bridge." The browser sends this action with the current campaign version and a new requestId.',
  },
  {
    id: 'access',
    label: '2. Check access',
    node: 'api',
    data: 'The backend checks the request fields and confirms that the device has access. LAN devices must be paired when pairing is required.',
  },
  {
    id: 'own',
    label: '3. Claim the turn',
    node: 'turn',
    data: 'The app checks the campaign version and whether it has already received this request. It reserves the turn with a temporary lease, then starts the attempt.',
  },
  {
    id: 'prepare',
    label: '4. Freeze context',
    node: 'context',
    data: 'The app reads character sheets, history, and sources. It always includes the latest three player/GM text pairs, plus any older turns not yet summarized. It summarizes only older turns while keeping their originals. It saves a fixed prompt and a complete copy of campaign knowledge for this attempt.',
  },
  {
    id: 'infer',
    label: '5. Ask the provider',
    node: 'model',
    data: 'The app sends the instructions, JSON context, required response format, and allowed tool definitions to the provider you selected.',
  },
  {
    id: 'tool',
    label: '6. Answer tool calls',
    node: 'tools',
    data: 'In this example, roll_dice returns 14 on a d20. The app saves that result before showing it to the model. Knowledge tools read the fixed copy in memory; book tools ask the backend for rule text.',
  },
  {
    id: 'check',
    label: '7. Validate the proposal',
    node: 'validate',
    data: "The model proposes changing Mira's HP from 10 to 9. The app computes citation positions and pages from exact supplied quotes, then checks the format, roll IDs, provenance and Mira's saved HP. Invalid fields can receive restricted CLI corrections without changing the scene or rerolling dice.",
  },
  {
    id: 'edit',
    label: '8. Edit the final narrative',
    node: 'validate',
    data: 'The selected CLI and model, using low effort when advertised (otherwise its lowest advertised effort or CLI default), rewrites only the validated final prose. Numbers, names, quoted dialogue and the player decision are checked conservatively. The original candidate stays private if editing fails; Resume narrative editing continues this stage without new dice or a new GM turn.',
  },
  {
    id: 'commit',
    label: '9. Commit and refresh',
    node: 'commit',
    data: 'The app checks once more that the turn can finish and the campaign version still matches. It saves the changes, snapshot, and story in one transaction, then refreshes the journal.',
  },
];
export const tools: FlowTool[] = [
  {
    ...item(
      'campaign_npcs_search',
      'campaign_npcs_search',
      'Find an existing NPC even when their sheet is absent from the initial prompt.',
      'Before using an older NPC or creating a potentially duplicate character.',
      'Saved name or description terms; an empty query lists the roster. An optional cursor retrieves the next page.',
      'Up to 20 matching IDs and names. Duplicate names remain separate choices.',
      'Uses this turn’s frozen NPC roster in memory, without another database query. Search results are navigation; get retrieves the saved sheet.',
      '4.7',
      ['rpg_be_local/src/domain/npcRecall.ts']
    ),
    bookOnly: false,
    args: { query: 'ferryman' },
    result: {
      campaignId: ids.campaign,
      npcs: [{ id: ids.npc, name: 'Ivo', revision: 0, matchedFields: ['description'] }],
      nextCursor: null,
    },
  },
  {
    ...item(
      'campaign_npcs_get',
      'campaign_npcs_get',
      'Read an existing NPC’s complete saved sheet.',
      'After choosing an NPC ID, before relying on stats absent from the prompt.',
      'The NPC’s unique ID.',
      'Saved attributes, inventory, description and revision, plus links to knowledge records. Private notes are excluded.',
      'Reads the frozen roster. Current saved sheet values remain distinct from historical events, rumors and GM-only knowledge.',
      '4.7',
      ['rpg_be_local/src/domain/npcRecall.ts']
    ),
    bookOnly: false,
    args: { id: ids.npc },
    result: { campaignId: ids.campaign, npc: { ...npc, revision: 0 }, knowledgeLinks: [] },
  },
  {
    ...item(
      'campaign_sources_search',
      'campaign_sources_search',
      'Find relevant original campaign document sections.',
      'During the GM action.',
      'One query or up to 6 queries, optional source ID; cursor only with a single query.',
      'Ranked original section matches with titles, source version, exact offsets and alreadySupplied status; a batch returns one result group per query.',
      'Searches meaningful whole tokens and phrases in the frozen confirmed-source snapshot. Snippets point at matching terms. The catalog and lookup agree on complete sections supplied through seeds, pins or retrieval; partial sections remain unread in full. Reuse supplied sections; repeated reads remain available. Every accepted request has a persisted read receipt.',
      '2.3',
      [
        'rpg_be_local/src/domain/campaignSourceRecall.ts',
        'rpg_be_local/src/services/campaignSourceLookup.ts',
      ]
    ),
    bookOnly: false,
    args: { query: 'ferryman' },
    result: {
      entries: [
        {
          sourceId: ids.source,
          version: 1,
          sectionIndex: 0,
          name: 'River town notes',
          title: 'Section 1',
          alreadySupplied: false,
          start: 0,
          end: 36,
          text: 'The ferryman offers a safe crossing.',
        },
      ],
      nextCursor: null,
      reason: null,
    },
  },
  {
    ...item(
      'campaign_sources_get',
      'campaign_sources_get',
      'Read the original section behind a campaign source match.',
      'After finding a section or using the catalog.',
      'Source ID, version and section index.',
      'A persisted receipt ID, original UTF-16 source span, section title and alreadySupplied status.',
      'The frozen text stays fixed through this logical action; it is distinct from published rulebook text.',
      '2.3',
      ['rpg_be_local/src/services/campaignSourceLookup.ts']
    ),
    bookOnly: false,
    args: { sourceId: ids.source, version: 1, sectionIndex: 0 },
    result: {
      receiptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Section 1',
      alreadySupplied: false,
      sectionIndex: 0,
      sourceSpan: {
        id: ids.source,
        version: 1,
        name: 'River town notes',
        text: 'The ferryman offers a safe crossing.',
        start: 0,
        end: 36,
      },
    },
  },

  {
    ...item(
      'combat_prepare',
      'combat_prepare',
      'Register every combatant as an individual character sheet before combat dice.',
      'Once per fight, before the first combat roll; later batches continue the same encounter.',
      'A batch key and participants: saved characters by ID, or new NPC drafts with their own keys, each with tracked attribute paths for vitality, damage, conditions or resources.',
      'The encounter ID, the participants with reserved IDs and the exact create operations to copy into the final proposal.',
      'Saves an append-only preparation receipt for this action. Nothing appears in the campaign until the turn commits; a retry gets the same IDs back.',
      '2.10',
      ['rpg_be_local/src/services/combatPreparation.ts', 'rpg_be_local/src/domain/combat.ts'],
      'Two soldiers from one description become two sheets with different IDs. Health and conditions stay on each sheet; state.combat stores only IDs, labels and tracked paths. The app does not calculate damage or rules.'
    ),
    bookOnly: false,
    args: combatPrepareArgs,
    result: combatPrepareResult,
  },
  {
    ...item(
      'roll_dice',
      'roll_dice',
      'Request a dice roll that the app generates and records.',
      'When a roll is needed during gameplay.',
      'The roll number (slot), dice to roll, reason, declared modifiers or targets, and scope: combat (encounter, kind, actor and, for attacks, target), character, or oracle (no actor).',
      'The saved rollId and dice results. The final response must explain every recorded roll.',
      'The dice service saves the results in PostgreSQL before returning them. Repeating a matching request reuses the saved results.',
      '5.3',
      ['rpg_be_local/src/domain/dice.ts', 'rpg_be_local/src/services/dice.ts'],
      'A session allows 12 roll slots, up to 100 dice results per call and 200 per session. An attempt allows 24 requests and an 8192-byte tool transcript. The declared 180-second constant does not impose a gameplay deadline.'
    ),
    bookOnly: false,
    args: {
      slot: 0,
      groups: [{ label: 'Crossing', count: 1, sides: 20 }],
      reason: 'Cross the damaged bridge',
      declaration: 'Resolve the crossing',
      scope: 'character',
      actorId: ids.player,
    },
    result: {
      rollId: ids.roll,
      slot: 0,
      groups: [{ label: 'Crossing', sides: 20, faces: [14] }],
      reused: false,
    },
  },
  {
    ...item(
      'campaign_knowledge_search',
      'campaign_knowledge_search',
      'Search campaign facts, objectives, and other records that may be absent from the initial prompt.',
      'When the model needs to recall something from the campaign.',
      'Search text and optional record type, status, or next-page cursor.',
      "Matching records from this turn's copy. Use campaign_knowledge_get to read one record in full.",
      'The search uses the fixed copy in memory, without querying PostgreSQL again. It searches active records by default; an explicit status can include resolved or retracted records.',
      '4.2',
      ['rpg_be_local/src/domain/knowledgeRecall.ts']
    ),
    bookOnly: false,
    args: { query: 'watchtower' },
    result: knowledgeSearchResult,
  },
  {
    ...item(
      'campaign_knowledge_get',
      'campaign_knowledge_get',
      'Read a specific campaign knowledge record using its ID.',
      'After a search, or whenever the model already knows the record ID.',
      "The record's unique ID (UUID).",
      'The complete record as it was when the turn started, including how certain it is, where it came from, and who supplied it.',
      "The tool reads the turn's copy in memory. To change knowledge, the model must propose an update in the final knowledgeChanges field.",
      '4.2',
      ['rpg_be_local/src/domain/knowledgeRecall.ts']
    ),
    bookOnly: false,
    args: { id: '66666666-6666-4666-8666-666666666666' },
    result: knowledgeGetResult,
  },
  {
    ...item(
      'rules_find',
      'rules_find',
      'Find relevant book rules and read original text in one request.',
      'Preferred first lookup in new book turns.',
      'A query, optional source/columns and search continuation cursor.',
      'Search metadata, up to three eligible original-text receipts, suppliedOriginals with exact continuation arguments, and unread paths.',
      'Saves ordinary rules_search/rules_get receipts, each guarded independently.',
      '5.4',
      ['rpg_be_local/src/providers/rulesFind.ts', 'rpg_be_local/src/services/ruleLookup.ts'],
      'The first three reads are a retrieval page, not a call limit. Reuse returned originals and receipts; copy suppliedOriginals.nextRead to continue partial text. Copy paths exactly from tool results. Intentional rereads remain available. Historical frozen tool sets remain unchanged.'
    ),
    bookOnly: true,
    args: { query: 'crossing', columns: ['core_rules'] },
    result: {
      search: { entries: [{ path: ruleResult.path, readableOriginal: true }], cursor: null },
      reads: [ruleResult],
      suppliedOriginals: [
        {
          receiptId: ruleReceiptId,
          path: ruleResult.path,
          start: ruleResult.start,
          end: ruleResult.end,
          complete: true,
          nextRead: null,
        },
      ],
      unreadPaths: [],
    },
  },
  ...(['rules_map', 'rules_search', 'rules_get', 'rules_list'] as const).map((name): FlowTool => ({
    ...item(
      name,
      name,
      name === 'rules_get'
        ? 'Read original rulebook text that the model can quote in its final response.'
        : name === 'rules_search'
          ? 'Find possible rule passages by searching for matching words.'
          : name === 'rules_map'
            ? 'See how the selected rulebook is organized.'
            : 'List the entries under a selected rulebook section.',
      'When the model requests it in book mode.',
      'The search text or book section path, with options for which information to return.',
      name === 'rules_get'
        ? 'Original text, its position and pages in the book, and the ID of the saved read receipt.'
        : 'Section lists or search results that help the model find original text. The model must read that text before citing a rule.',
      "The app's rule service reads PostgreSQL and saves a receipt for each call, including navigation calls and errors.",
      '5.4',
      ['rpg_be_local/src/services/ruleStore.ts', 'rpg_be_local/src/domain/rules.ts'],
      'A citation must match a receipt from this turn, the selected rule system, its version and content hash, the exact quoted text, and its pages. Text positions use UTF-16 offsets, as JavaScript strings do. These checks verify the quote; they do not judge its interpretation. Rule reads retain audit counters without an accumulated request or byte ceiling after migration 0011. HTTP MCP limits arguments to 1024 bytes, even though the dice validator allows more.'
    ),
    bookOnly: true,
    args:
      name === 'rules_get'
        ? { path: ruleResult.path, view: 'text' }
        : name === 'rules_search'
          ? { query: 'crossing', columns: ['core_rules'] }
          : name === 'rules_list'
            ? { path: 'core_rules.teaching' }
            : { column: 'core_rules' },
    result:
      name === 'rules_get'
        ? ruleResult
        : {
            revision: 1,
            contentHash: ruleContext.contentHash,
            receipt: ruleReceiptId,
            complete: true,
            omitted: false,
            cursor: null,
            entries:
              name === 'rules_map'
                ? [{ key: 'column', value: { column: 'core_rules', name: 'Crossing rules' } }]
                : [
                    {
                      path: ruleResult.path,
                      name: 'Crossing',
                      source: 'teaching',
                      review: 'verified',
                      ...(name === 'rules_search'
                        ? {
                            derived: false,
                            readableOriginal: true,
                            matchedTerms: ['crossing'],
                            exactTitle: true,
                            snippet: ruleResult.text,
                            locator: 'synthetic-locator',
                          }
                        : {}),
                      pages: ruleResult.pages,
                    },
                  ],
          },
  })),
];
export const storageItems: FlowItem[] = [
  item(
    'campaigns',
    'Campaign document',
    'The saved campaign lives in campaigns.document, a PostgreSQL JSONB document. It contains characters, state, sources, and knowledge.',
    'The app reads it when preparing context and updates it after a validated turn or an edit you save.',
    'Accepted character, state, and knowledge changes.',
    'The saved data the next turn will use.',
    'PostgreSQL stores these records inside the campaign document, rather than in separate character, source, or knowledge tables.',
    '3.1',
    ['rpg_be_local/src/store.ts', 'rpg_be_local/src/domain/types.ts']
  ),
  item(
    'turns',
    'Turns & snapshots',
    'The app stores each action, its status and story, and a snapshot of the fields it changed. These records support history and undo.',
    'When a turn is submitted, finishes, fails, is cancelled, or is undone.',
    'The submitted action and the changes the app accepted.',
    'A record of what happened and the previous values needed for undo.',
    'The records remain after undo. The app leaves failed and undone turns out of the gameplay history it selects automatically.',
    '5.5',
    ['rpg_be_local/src/domain/state.ts', 'rpg_be_local/src/services/turns.ts']
  ),
  item(
    'memory',
    'Memory milestones',
    'Summaries shorten the older history sent to the model. They can lose detail, so the original turns remain stored.',
    'When the app needs to shorten older context before resolving an action.',
    'Completed turns that the current summary does not already cover.',
    'Summary text and the IDs of the turns it covers.',
    'The app may save summaries before gameplay finishes, so they can survive a later failure. Undo invalidates summaries that cover the undone turn and restores an earlier valid summary.',
    '5.6',
    ['rpg_be_local/src/services/turns.ts']
  ),
  item(
    'audit',
    'Dice sessions & rule receipts',
    'Saved prompts, attempts, dice results, and rule reads record what happened while the model resolved the action.',
    'Before returning dice results and when answering rulebook requests.',
    'Checked tool calls linked to the current attempt.',
    'Evidence for reusing dice results, checking quoted rules, and matching roll explanations to recorded rolls.',
    'These records are saved separately and survive a failed gameplay result. Sessions imported from an archive can be inspected but cannot run again.',
    '5.3',
    ['rpg_be_local/src/services/dice.ts', 'rpg_be_local/src/services/ruleStore.ts']
  ),
  item(
    'sources',
    'Sources & artifacts',
    'The app extracts text from imports and divides it into searchable excerpts for later prompts.',
    'When importing a source, extracting its text, or saving a correction.',
    'Valid UTF-8 text files or checked PDF files. The app extracts PDF text and uses OCR when needed.',
    'Text becomes confirmed immediately, including OCR results. You can correct it later.',
    'The campaign document stores the text, PostgreSQL source_chunks stores searchable excerpts, and disk storage holds original files. A correction updates the source version, rebuilds the search index, and clears affected pins.',
    '2.6',
    ['rpg_be_local/src/services/sources.ts', 'rpg_be_local/src/domain/sourceSections.ts']
  ),
  item(
    'books',
    'Rule systems & previews',
    'Private uploads organize rulebook text into sections and create a version of the rule system you can select.',
    'During upload preview, then when you choose to publish it.',
    'A manifest describing the upload and files for the book columns. The limit is 12 files, including the manifest.',
    "An organized rule library that the app's book tools can read.",
    'Temporary previews expire after 30 minutes. Disk backups and published rule systems in PostgreSQL have separate lifetimes. Each rule system also stores a display-only character sheet layout that is never sent to the GM.',
    '2.7',
    ['rpg_be_local/src/services/ruleLibrary.ts', 'rpg_be_local/src/services/ruleUpload.ts']
  ),
  item(
    'journal',
    'Journal ledger & jobs',
    'The Journal shows what your character knows from saved knowledge. Optional backfill and correction jobs add a private ledger of what changed and why.',
    'When you open the Journal, run Fill from past conversations, or flag and accept a correction.',
    'Your saved conversations and the facts your character can see, never private notes, hidden GM knowledge or your own suspicions.',
    'New entries, or one corrected fact with its exact quotes, a before and after value and a retained history.',
    'Journal jobs live in journal_jobs and finish only when you start them, so a failed or cancelled run adds nothing. The ledger is stored in the campaign document and travels with backups, not templates. Accepting a correction retires memory summaries and changes the facts the next GM context uses.',
    '2.12',
    [
      'rpg_be_local/src/services/journal.ts',
      'rpg_be_local/src/domain/journalChanges.ts',
      'rpg_be_local/src/domain/journalCompatibility.ts',
    ]
  ),
];
export const branches = [
  {
    label: 'Source / PDF / OCR',
    text: 'The app extracts text from an imported file, confirms it, and creates searchable excerpts. Later prompts can include matching excerpts. You can correct extracted or OCR text, but import does not require a review first. Extraction runs without holding a database transaction open.',
    section: '2.6',
  },
  {
    label: 'Character parsing',
    text: 'The app sends selected source text to the provider and checks the returned character draft against the required format. You choose whether to apply that draft. This is separate from gameplay tool calls and saving a turn.',
    section: '2.6',
  },
  {
    label: 'Audio',
    text: 'Local FasterWhisper turns a microphone recording of up to 120 seconds into text you can edit before sending. To read the story aloud, the browser uses its installed local voices. The backend does not provide a text-to-speech endpoint.',
    section: '2.6',
  },
  {
    label: 'Archives & templates',
    text: 'Archives include private notes, unrevealed GM knowledge and combat preparation receipts but leave out original binary files. Import assigns new IDs to structured records and refuses files exported by an older app. Saved templates may contain notes; creating a campaign from a template clears those notes and leaves out the played knowledge timeline.',
    section: '2.8',
  },
  {
    label: 'Journal backfill & corrections',
    text: 'You can ask the selected CLI to read every saved conversation in order and add missing people, places and unfinished business, or to check one fact you flag. Both run sequentially outside gameplay, make no turns or dice rolls, and commit nothing unless they finish. A correction is proposed with exact quotes and changes the record only after you accept it. Old conversations are never rewritten.',
    section: '2.12',
  },
  {
    label: 'Prompt logs & privacy',
    text: "The repository's log/ folder keeps prompt files that can contain full prompts and private content. New logs include an exact JSON file and a readable Markdown file with the same name. Open the .md file to read settings, system instructions, and the formatted prompt. The app does not automatically redact or expire them. A failed log write can stop generation and produces a prompt_log error. Private notes are excluded from automatically built gameplay context, but archives and logs can still contain private information.",
    section: '3.3',
  },
];
