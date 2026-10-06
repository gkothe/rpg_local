import { responseSchemaExample } from './responseSchemaExample';
// Authored teaching fixtures, never submitted to a provider or campaign API.
export const ids = {
  player: '22222222-2222-4222-8222-222222222222',
  npc: '33333333-3333-4333-8333-333333333333',
  roll: '44444444-4444-4444-8444-444444444444',
  turn: '55555555-5555-4555-8555-555555555555',
  campaign: '11111111-1111-4111-8111-111111111111',
  source: '77777777-7777-4777-8777-777777777777',
  system: '88888888-8888-4888-8888-888888888888',
};
export const player = {
  id: ids.player,
  name: 'Mira',
  type: 'player' as const,
  attributes: { hp: 10 },
  inventory: { rope: 1 },
  description: { role: 'Scout' },
};
export const npc = {
  id: ids.npc,
  name: 'Ivo',
  type: 'npc' as const,
  attributes: { hp: 8 },
  inventory: {},
  description: { role: 'Ferryman' },
};
// A scene without combat leaves the combat links empty.
export const proposal = {
  narrative: 'Mira crosses the bridge, scraping her arm on the broken rail.',
  operations: [
    {
      op: 'set' as const,
      characterId: ids.player,
      field: 'attributes' as const,
      expected: { hp: 10 },
      value: { hp: 9 },
    },
  ],
  rollInterpretations: [
    {
      rollId: ids.roll,
      explanation:
        'The recorded roll is interpreted as a costly success in this illustrative scene.',
      afterParagraph: 1,
    },
  ],
  ruleCitations: [],
  knowledgeChanges: [],
  operationExplanations: [
    {
      operationIndex: 0,
      reason:
        'The broken rail causes a minor injury during the crossing, after the saved roll is interpreted.',
      basis: 'dice',
      rollIds: [ids.roll],
      evidence: [],
      visibility: 'player',
    },
  ],
  combatEffects: [],
  participantReferences: [],
};
export const knowledgeRecord = {
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'objective',
  title: 'Reach the watchtower',
  text: 'Mira must deliver a sealed letter.',
  certainty: 'established',
  status: 'active',
  origin: 'gm',
  evidence: [],
  characterIds: [ids.player],
  characterNames: { [ids.player]: 'Mira' },
  createdTurnId: null,
  updatedTurnId: null,
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  revision: 1,
  attributions: [{ origin: 'gm', evidence: [], turnId: null, at: '2026-10-03T12:00:00.000Z' }],
};
export const knowledgeSearchResult = {
  campaignId: ids.campaign,
  records: [
    {
      id: knowledgeRecord.id,
      title: knowledgeRecord.title,
      kind: 'objective',
      origin: 'gm',
      certainty: 'established',
      status: 'active',
      revision: 1,
    },
  ],
  nextCursor: null,
};
export const knowledgeGetResult = {
  ...knowledgeRecord,
  characterLinks: [{ id: ids.player, name: 'Mira', historical: false }],
};
export const ruleText = 'Roll a d20 for a risky crossing.';
export const ruleContext = {
  systemId: ids.system,
  systemKey: 'teaching-example',
  systemName: 'Teaching example',
  revision: 1,
  kind: 'library',
  contentHash: 'a'.repeat(64),
};
export const ruleReceiptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ruleResult = {
  revision: 1,
  contentHash: ruleContext.contentHash,
  receipt: ruleReceiptId,
  complete: true,
  omitted: false,
  cursor: null,
  path: 'core_rules.teaching.crossing',
  source: 'teaching',
  view: 'text',
  structural: false,
  start: 0,
  end: ruleText.length,
  text: ruleText,
  pages: { precision: 'exact', pdfPages: [1], printedPages: ['1'] },
  pageSpans: [{ start: 0, end: ruleText.length, pdfPage: 1, printedPage: '1' }],
};
export const citation = {
  receiptId: ruleReceiptId,
  path: ruleResult.path,
  source: 'teaching',
  systemId: ids.system,
  revision: 1,
  contentHash: ruleContext.contentHash,
  start: 0,
  end: ruleText.length,
  quote: ruleText,
  precision: 'exact',
  pdfPages: [1],
  printedPages: ['1'],
};
export const ruleRead = {
  id: ruleReceiptId,
  campaignId: ids.campaign,
  turnId: ids.turn,
  context: ruleContext,
  tool: 'rules_get',
  transportRequestId: 'teaching-call-1',
  argumentDigest: 'b'.repeat(64),
  resultHash: 'c'.repeat(64),
  payload: ruleResult,
  createdAt: '2026-10-03T12:00:00.000Z',
};
export function examplePayload(pinned: boolean, mentioned: boolean, book: boolean) {
  return {
    mandatory: {
      ruleContext: {
        systemId: ids.system,
        systemKey: 'teaching-example',
        systemName: 'Teaching example',
        revision: 1,
        kind: book ? 'library' : 'model_knowledge',
        contentHash: 'a'.repeat(64),
      },
      ...(book
        ? { rulesOverview: 'Bridge checks: consult the selected book before resolving.' }
        : {}),
      knowledge: [],
      pinnedRules: pinned
        ? [
            {
              id: ids.source,
              version: 1,
              text: 'The ferryman offers a safe crossing.',
              name: 'River town notes',
              start: 0,
              end: 36,
            },
          ]
        : [],
      campaignSources: [
        {
          id: ids.source,
          version: 1,
          name: 'River town notes',
          purpose: 'reference',
          sectionCount: 1,
          sections: [{ sectionIndex: 0, title: 'Section 1', headings: [], supplied: pinned }],
        },
      ],
      campaignSourceSeeds: [],
      characters: mentioned ? [player, npc] : [player],
      state: { location: 'North bridge' },
      schema: responseSchemaExample,
      action: mentioned ? 'I ask Ivo for help and cross the bridge.' : 'I cross the bridge.',
    },
    memory: 'Earlier turns: Mira arrived in the river town. This summary is lossy.',
    history: [
      {
        player: 'Inspect the bridge.',
        gm: 'The rail is broken.',
      },
    ],
    rules: [],
  };
}

// Illustrative ambush: two soldiers from one description are two sheets with their own IDs.
export const combatIds = {
  soldierA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  soldierB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  encounter: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  receipt: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  roll: '99999999-9999-4999-8999-999999999999',
};
const damage = [{ path: ['hp'], kind: 'vitality' as const, label: 'HP' }];
const soldierDraft = {
  name: 'Bridge soldier',
  type: 'npc' as const,
  attributes: { hp: 6 },
  inventory: { spear: 1 },
  description: { role: 'Toll guard' },
};
const introduction = { origin: 'gm' as const, evidence: [], visibility: 'player' as const };
export const combatPrepareArgs = {
  localKey: 'bridge-ambush',
  participants: [
    { characterId: ids.player, label: 'Mira', trackedFields: damage },
    {
      localKey: 'soldier-1',
      label: 'Soldier 1',
      character: soldierDraft,
      introduction,
      trackedFields: damage,
    },
    {
      localKey: 'soldier-2',
      label: 'Soldier 2',
      character: soldierDraft,
      introduction,
      trackedFields: damage,
    },
  ],
};
const createSoldier = (characterId: string) => ({
  op: 'create' as const,
  characterId,
  preparationReceiptId: combatIds.receipt,
  character: soldierDraft,
  introduction,
});
export const combatPrepareResult = {
  receiptId: combatIds.receipt,
  encounterId: combatIds.encounter,
  encounter: 'new',
  participants: [
    {
      characterId: ids.player,
      label: 'Mira',
      trackedFields: damage,
      origin: 'existing',
      sheet: player,
    },
    ...[combatIds.soldierA, combatIds.soldierB].map((id, index) => ({
      characterId: id,
      label: `Soldier ${index + 1}`,
      trackedFields: damage,
      origin: 'prepared',
      sheet: { id, ...soldierDraft },
    })),
  ],
  createOperations: [createSoldier(combatIds.soldierA), createSoldier(combatIds.soldierB)],
  guidance:
    'Use these character IDs in roll_dice actorId/targetId, combatEffects and participantReferences. Each prepared NPC you use must be created with its exact createOperations entry; add every participant you use to state.combat with the returned label and trackedFields. Unused prepared drafts remain audit only.',
};
export const combatRollArgs = {
  slot: 0,
  groups: [{ label: 'Attack', count: 1, sides: 20 }],
  reason: 'Mira strikes the first soldier',
  declaration: 'Attack roll; the GM applies the system rules to the result',
  scope: 'combat' as const,
  encounterId: combatIds.encounter,
  combatKind: 'attack' as const,
  actorId: ids.player,
  targetId: combatIds.soldierA,
};
export const combatProposal = {
  narrative:
    'Two toll soldiers step out with spears raised.\n\nMira lunges past the first spear and cuts the nearest soldier.',
  operations: [
    createSoldier(combatIds.soldierA),
    createSoldier(combatIds.soldierB),
    {
      op: 'set' as const,
      characterId: combatIds.soldierA,
      field: 'attributes' as const,
      expected: { hp: 6 },
      value: { hp: 3 },
    },
    {
      op: 'state' as const,
      expected: { location: 'North bridge' },
      value: {
        location: 'North bridge',
        combat: {
          id: combatIds.encounter,
          active: true,
          round: 1,
          participants: combatPrepareResult.participants.map(
            ({ characterId, label, trackedFields }) => ({ characterId, label, trackedFields })
          ),
        },
      },
    },
  ],
  rollInterpretations: [
    { rollId: combatIds.roll, explanation: 'A solid hit on the first soldier.', afterParagraph: 2 },
  ],
  ruleCitations: [],
  knowledgeChanges: [],
  operationExplanations: [0, 1, 2, 3].map((operationIndex) => ({
    operationIndex,
    reason:
      operationIndex === 2 ? 'The saved attack roll hits for three damage.' : 'The ambush begins.',
    basis: operationIndex === 2 ? 'dice' : 'initial_state',
    rollIds: operationIndex === 2 ? [combatIds.roll] : [],
    evidence: [],
    visibility: 'player',
  })),
  combatEffects: [
    {
      characterId: combatIds.soldierA,
      operationIndex: 2,
      paths: [['hp']],
      reason: 'Cut by Mira',
      rollIds: [combatIds.roll],
      afterParagraph: 2,
    },
  ],
  participantReferences: [
    { afterParagraph: 1, characterIds: [combatIds.soldierA, combatIds.soldierB] },
    { afterParagraph: 2, characterIds: [ids.player, combatIds.soldierA] },
  ],
};
