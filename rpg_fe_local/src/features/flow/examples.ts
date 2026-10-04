import { responseSchemaExample } from './responseSchemaExample';
import { responseSchemaV5Example } from './responseSchemaV5Example';
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
export const proposal = {
  version: 4 as const,
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
    },
  ],
  ruleCitations: [],
  knowledgeChanges: [],
};
export const proposalV5 = {
  ...proposal,
  version: 5 as const,
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
      description: 'A river town after the flood.',
      pinnedFacts: ['The north bridge is damaged.'],
      pinnedRules: pinned
        ? [
            {
              id: ids.source,
              version: 1,
              name: 'River town notes',
              start: 0,
              end: 36,
              text: 'The ferryman offers a safe crossing.',
            },
          ]
        : [],
      characters: mentioned ? [player, npc] : [player],
      knowledge: [],
      state: { location: 'North bridge' },
      schema: responseSchemaExample,
      action: mentioned ? 'I ask Ivo for help and cross the bridge.' : 'I cross the bridge.',
    },
    memory: 'Earlier turns: Mira arrived in the river town. This summary is lossy.',
    history: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        player: 'Inspect the bridge.',
        gm: 'The rail is broken.',
      },
    ],
    rules: [],
  };
}

export function examplePayloadV5(pinned: boolean, mentioned: boolean, book: boolean) {
  const legacy = examplePayload(pinned, mentioned, book);
  return {
    ...legacy,
    mandatory: {
      ...legacy.mandatory,
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
      schema: responseSchemaV5Example,
    },
  };
}
