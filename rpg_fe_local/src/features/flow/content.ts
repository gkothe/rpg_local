import type { FlowEdge, FlowItem, FlowStep, FlowTool } from './types';
import {
  ids,
  knowledgeGetResult,
  knowledgeSearchResult,
  ruleResult,
  ruleReceiptId,
  ruleContext,
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
    'You describe an action. The journal shows the result only after the application accepts it.',
    'Before submission and after status updates.',
    'Your action, current campaign revision, request identity.',
    'POST to the turn API; later SSE notifications and canonical polling.',
    'Browser drafts are separate from committed campaign state.',
    '2.1',
    ['rpg_fe_local/src/features/journal/Journal.tsx', 'rpg_be_local/src/app.ts']
  ),
  item(
    'api',
    'Access boundary / API',
    'The backend checks access and parses the request before handing it to TurnService.',
    'For every request.',
    'Browser request, LAN pairing/access status.',
    'Validated action and identity, or an HTTP error.',
    'No model call at this boundary.',
    '2.1',
    ['rpg_be_local/src/app.ts', 'rpg_be_local/src/security.ts']
  ),
  item(
    'turn',
    'TurnService',
    'A turn is an owned, revision-bound attempt. Duplicate request identities replay the original outcome.',
    'After access checks; during execution and final commit.',
    'Parsed action, requestId and revision.',
    'Pending turn → running → completed, failed, cancelled or interrupted.',
    'PostgreSQL turn row and lease; campaign locking prevents competing turns.',
    '2.2',
    ['rpg_be_local/src/services/turns.ts'],
    'A pending lease lasts 45 seconds; heartbeats check ownership every 10 seconds. Recovery checks expired leases every 15 seconds and interrupts them; it does not automatically rerun the AI.'
  ),
  item(
    'context',
    'Context builder',
    'The app chooses what the model needs: canonical sheets, scene facts, history and reference text.',
    'Before gameplay inference, with optional compaction.',
    'Campaign JSONB, completed non-undone turns, confirmed source chunks and rules context.',
    'System instructions + JSON user payload + manifest metadata; a frozen session.',
    'PostgreSQL reads; frozen knowledge copied into memory. No private notes in automatic gameplay context.',
    '4.3',
    ['rpg_be_local/src/domain/context.ts', 'rpg_be_local/src/domain/knowledgeRecall.ts'],
    'All player sheets are included. NPCs are selected by scene/name/id signals. Relevant knowledge and lexical source retrieval use soft budgets. Summaries are lossy; original turn transcripts remain stored.'
  ),
  item(
    'model',
    'Provider CLI / LLM',
    'An authenticated provider model narrates and proposes changes. It may ask the app to run allowed tools.',
    'Outside the final database transaction.',
    'Instructions, frozen user payload, response schema, allowed tools and tool results.',
    'Tool requests, then a structured v4 final proposal.',
    'Inference uses provider cloud services. A local app does not imply offline inference.',
    '2.3',
    [
      'rpg_be_local/src/providers/claudeDice.ts',
      'rpg_be_local/src/providers/codexDice.ts',
      'rpg_be_local/src/providers/antigravityDice.ts',
    ],
    'Claude and Antigravity use owned loopback HTTP MCP; Codex uses stdio app-server dynamic calls. Native ambient tools are disabled in the configured session. This is a model tool boundary, not a claim that child-process environment/authentication contains no secrets.'
  ),
  item(
    'tools',
    'Owned tool registry',
    'The model names a tool; the app validates and serializes the call, then returns only its result.',
    'During inference when the model requests a tool.',
    'Allowed name + structured arguments.',
    'Trusted dice, frozen knowledge or rule-book navigation/text with receipts.',
    'Dice and rule reads persist independently; knowledge recall reads frozen memory.',
    '2.3',
    [
      'rpg_be_local/src/providers/gameplayTools.ts',
      'rpg_be_local/src/services/dice.ts',
      'rpg_be_local/src/services/ruleStore.ts',
    ],
    'Default mode has three tools; book mode adds four. There is no arbitrary SQL, shell, file or network tool. Model decisions about when to call remain subject to instructions, not a universal semantic rules engine.'
  ),
  item(
    'validate',
    'Validate proposal',
    'The response is a proposal until the app validates its structure, references and expected prior values.',
    'After inference, before committing gameplay.',
    'v4 narrative, operations, roll interpretations, citations, knowledge changes.',
    'Accepted state diff and snapshot, or a validation error.',
    'No gameplay state change on rejection. Eligible errors can trigger up to two repair retries.',
    '5.1',
    [
      'rpg_be_local/src/domain/gameplayResponse.ts',
      'rpg_be_local/src/domain/state.ts',
      'rpg_be_local/src/services/turns.ts',
    ],
    'Checks include exact roll identities, cited text/receipt identity, provenance and expected values. Narrative arithmetic and semantic rule fidelity are not proven. Empty citations are allowed. Repairs retain tool audit and do not reset the cumulative transcript budget.'
  ),
  item(
    'commit',
    'Atomic commit / return',
    'Only an accepted, still-owned turn can change canonical campaign data. The browser then refreshes.',
    'Final transaction, after inference has finished.',
    'Validated diff, snapshot, current owner/revision/rule identity.',
    'Campaign revision increment, completed narrative and snapshot together.',
    'PostgreSQL atomic gameplay commit; earlier memory/dice/receipts may already exist.',
    '5.2',
    ['rpg_be_local/src/services/turns.ts', 'rpg_be_local/src/store.ts'],
    'Undo is a later field-level operation. It checks touched fields for conflicts, preserves unrelated edits/private notes and keeps audit history.'
  ),
  item(
    'database',
    'PostgreSQL',
    'The app owns database access. The model receives selected data or tool results, never a SQL connection.',
    'Context preparation, permitted service calls and commit.',
    'Queries from Store, rule and dice services; validated writes from the application.',
    'Canonical JSONB, turn history, source chunks, rule text and audit records.',
    'Durable storage; recall tools use the already-frozen in-memory knowledge registry.',
    '3.1',
    ['rpg_be_local/src/store.ts', 'rpg_be_local/src/services/ruleStore.ts']
  ),
];
const edgePairs = [
  ['request', 'browser', 'api', 'Action request', 'Action + revision + requestId'],
  ['dispatch', 'api', 'turn', 'Validated dispatch', 'Parsed request after access checks'],
  ['prepare', 'turn', 'context', 'Prepare context', 'Owned turn + campaign revision'],
  [
    'prompt',
    'context',
    'model',
    'Send prompt',
    'System instructions + user JSON + tool definitions',
  ],
  ['call', 'model', 'tools', 'Request a tool', 'Tool name + validated arguments'],
  ['result', 'tools', 'model', 'Return tool result', 'Dice faces, knowledge or rule-book text'],
  ['proposal', 'model', 'validate', 'Final proposal', 'Structured v4 JSON, not committed state'],
  ['write', 'validate', 'commit', 'Apply accepted diff', 'Expected-value updates + snapshot'],
  [
    'refresh',
    'commit',
    'browser',
    'Refresh journal',
    'Status event → canonical campaign/turn reads',
  ],
  [
    'dbread',
    'database',
    'context',
    'Read context data',
    'App queries canonical data, history and source chunks',
  ],
  [
    'dbtool',
    'tools',
    'database',
    'Tool service I/O',
    'Dice writes and rule reads/receipts; knowledge recall stays in memory',
  ],
  [
    'dbwrite',
    'commit',
    'database',
    'Atomic database write',
    'Campaign revision + snapshot + completed turn',
  ],
] as const;
export const edges: FlowEdge[] = edgePairs.map(([id, from, to, label, data]) => ({
  ...item(
    id,
    label,
    `${nodes.find((n) => n.id === from)!.label} → ${nodes.find((n) => n.id === to)!.label}`,
    'At this transition in the guided turn.',
    data,
    data,
    'See the sender and receiver for persistence ownership.',
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
    data: 'Mira: “I cross the bridge.” Send the action with current revision and a fresh requestId.',
  },
  {
    id: 'access',
    label: '2. Check access',
    node: 'api',
    data: 'Parse the request and enforce the existing access/pairing boundary.',
  },
  {
    id: 'own',
    label: '3. Claim the turn',
    node: 'turn',
    data: 'Check revision and idempotency; create the pending lease, then start the owned attempt.',
  },
  {
    id: 'prepare',
    label: '4. Freeze context',
    node: 'context',
    data: 'Read sheets/history/sources. Compact older context if needed; preserve originals. Freeze prompt and full knowledge registry.',
  },
  {
    id: 'infer',
    label: '5. Ask the provider',
    node: 'model',
    data: 'Send instructions, JSON context, schema and tool definitions to the selected authenticated provider.',
  },
  {
    id: 'tool',
    label: '6. Answer tool calls',
    node: 'tools',
    data: 'Illustrative roll_dice call: persist a d20 result of 14 before revealing it. Knowledge lookup uses frozen memory; book reads use the app service.',
  },
  {
    id: 'check',
    label: '7. Validate the proposal',
    node: 'validate',
    data: 'Mira HP: expected 10 → proposed 9. Check v4 shape, roll IDs, citations/provenance and actual prior values.',
  },
  {
    id: 'commit',
    label: '8. Commit and refresh',
    node: 'commit',
    data: 'Recheck ownership/revision. Atomically save canonical changes + snapshot + narrative. Refresh the journal.',
  },
];
export const tools: FlowTool[] = [
  {
    ...item(
      'roll_dice',
      'roll_dice',
      'Ask for trusted random faces rather than inventing a roll in prose.',
      'When a roll is needed during gameplay.',
      'Slot, dice groups, reason, declaration and optional actor/target.',
      'Recorded rollId and faces; final response must acknowledge every roll.',
      'Dice service writes PostgreSQL before returning. Matching replay specifications reuse faces.',
      '5.3',
      ['rpg_be_local/src/domain/dice.ts', 'rpg_be_local/src/services/dice.ts'],
      '12 slots/session, 100 faces/call, 200 faces/session; 24 requests/attempt and an 8192-byte transcript budget. The declared 180-second constant is not a gameplay deadline.'
    ),
    bookOnly: false,
    args: {
      slot: 0,
      groups: [{ label: 'Crossing', count: 1, sides: 20 }],
      reason: 'Cross the damaged bridge',
      declaration: 'Resolve the crossing',
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
      'Find older continuity records that were not all placed in the prompt.',
      'When the model needs campaign continuity.',
      'Query and optional kind/status/cursor.',
      'Matching frozen records; use get for a specific record.',
      'Frozen in-memory registry; no fresh SQL lookup. Active status is the default, not a restriction on explicit inactive lookup.',
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
      'Read one known campaign knowledge record by identity.',
      'After search or when an identity is already known.',
      'Record UUID.',
      'Full frozen record, including its certainty, origin and attribution.',
      'In-memory session snapshot; knowledge mutations are proposed later in knowledgeChanges.',
      '4.2',
      ['rpg_be_local/src/domain/knowledgeRecall.ts']
    ),
    bookOnly: false,
    args: { id: '66666666-6666-4666-8666-666666666666' },
    result: knowledgeGetResult,
  },
  ...(['rules_map', 'rules_search', 'rules_get', 'rules_list'] as const).map((name): FlowTool => ({
    ...item(
      name,
      name,
      name === 'rules_get'
        ? 'Read original rule text; successful text reads can support a final citation.'
        : name === 'rules_search'
          ? 'Locate candidate passages by lexical search.'
          : name === 'rules_map'
            ? 'Orient within the selected book’s navigation structure.'
            : 'List children or entries in the selected book.',
      'Only in book mode, on a model request.',
      'Validated book query/path/view arguments.',
      name === 'rules_get'
        ? 'Original text with offsets, page metadata and persisted receipt identity.'
        : 'Navigation or search metadata; not itself citable original text.',
      'App rule service reads PostgreSQL and persists read receipts, including navigation/errors.',
      '5.4',
      ['rpg_be_local/src/services/ruleStore.ts', 'rpg_be_local/src/domain/rules.ts'],
      'Citations must match current-turn system/revision/hash/receipt, exact UTF-16 substring offsets and page coverage. These checks prove referenced text, not its correct interpretation. Rule SQL budgets are cumulative; HTTP MCP has a 1024-byte argument cap even though dice has a larger domain cap.'
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
                        ? { derived: false, snippet: ruleResult.text, locator: 'synthetic-locator' }
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
    'Canonical characters, state, sources and knowledge live in campaigns.document JSONB.',
    'Read at context preparation; written at validated commit or explicit editor actions.',
    'Accepted operations and knowledge changes.',
    'Next turn’s canonical context.',
    'PostgreSQL; characters/sources/knowledge are not separate relational tables.',
    '3.1',
    ['rpg_be_local/src/store.ts', 'rpg_be_local/src/domain/types.ts']
  ),
  item(
    'turns',
    'Turns & snapshots',
    'Actions, status, narratives and field-level before/after snapshots support history and undo.',
    'Submit, finish, fail, cancel and undo.',
    'Turn request + accepted diff.',
    'Audit history and reversible touched fields.',
    'Retained after undo; failed/undone turns excluded from automatic history selection.',
    '5.5',
    ['rpg_be_local/src/domain/state.ts', 'rpg_be_local/src/services/turns.ts']
  ),
  item(
    'memory',
    'Memory milestones',
    'Lossy summaries shorten older context; originals remain available in turn history.',
    'Optional compaction before gameplay.',
    'Older uncovered completed turns.',
    'Memory text plus coverage lineage.',
    'May commit incrementally before later gameplay failure. Undo invalidates milestones covering the undone turn and restores prior valid memory.',
    '5.6',
    ['rpg_be_local/src/services/turns.ts']
  ),
  item(
    'audit',
    'Dice sessions & rule receipts',
    'Frozen prompts, attempts, recorded faces and rule reads document what happened during inference.',
    'Before reveal or when servicing book reads.',
    'Validated tool calls and owned session.',
    'Replay evidence, exact quote evidence and interpretation checks.',
    'Independent persistence survives failed gameplay. Imported sessions remain non-executable.',
    '5.3',
    ['rpg_be_local/src/services/dice.ts', 'rpg_be_local/src/services/ruleStore.ts']
  ),
  item(
    'sources',
    'Sources & artifacts',
    'Imports produce text and lexical chunks for contextual retrieval.',
    'Import/extraction and source correction.',
    'Strict UTF-8 non-PDF files or verified PDF input; extraction/OCR.',
    'Confirmed text immediately, including OCR; optional corrections later.',
    'Text in campaign JSONB, source_chunks in PostgreSQL, binary artifacts on disk. Corrections increment version, rebuild index and clear affected pins.',
    '2.6',
    ['rpg_be_local/src/services/sources.ts', 'rpg_be_local/src/domain/sourceSections.ts']
  ),
  item(
    'books',
    'Rule systems & previews',
    'Private uploads build mapped book columns and a selected system revision.',
    'Preview then explicit publish.',
    'Manifest + book columns; at most 12 files including manifest.',
    'Mapped rule library for app-controlled tools.',
    'Temporary previews expire after 30 minutes; disk backups and published PostgreSQL systems have different lifetimes.',
    '2.7',
    ['rpg_be_local/src/services/ruleLibrary.ts', 'rpg_be_local/src/services/ruleUpload.ts']
  ),
];
export const branches = [
  {
    label: 'Source / PDF / OCR',
    text: 'Import → extraction subprocess → confirmed text → source chunks → optional context retrieval. Corrections are optional, not a mandatory approval gate. Extraction is outside a long-held DB transaction.',
    section: '2.6',
  },
  {
    label: 'Character parsing',
    text: 'Selected source text → provider extraction → schema-validated draft → user applies a character. Gameplay tools and final turn commit are a separate path.',
    section: '2.6',
  },
  {
    label: 'Audio',
    text: 'Microphone → local FasterWhisper transcription (maximum 120 seconds) → editable action text. Read-aloud uses local browser voices, not a backend TTS endpoint.',
    section: '2.6',
  },
  {
    label: 'Archives & templates',
    text: 'Archives v4 include private notes and remap structured identities on import; original binaries are excluded. Templates can retain notes when saved, but instantiation clears them and omits the knowledge timeline.',
    section: '2.8',
  },
  {
    label: 'Prompt logs & privacy',
    text: 'Persistent repository-root log/ files can contain full prompts and private content; there is no automatic redaction or expiration. Automatic gameplay context excludes private notes, but archives/logs have different privacy boundaries.',
    section: '3.3',
  },
];
