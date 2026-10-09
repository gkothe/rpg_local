import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import { canonicalRuleJson, RuleSystemKind, type RuleRead } from '../src/domain/rules.js';
import { originalReadLocator } from '../src/domain/ruleReadCoverage.js';
import { remapArchive } from '../src/services/library.js';
import {
  remapNpcPreparation,
  type NpcPreparationArchive,
} from '../src/services/npcPreparationArchive.js';
type SearchEntry = {
  path: string;
  originalComplete: boolean;
  matchWindow: { start: number; end: number };
  suppliedOriginals?: ReturnType<typeof originalReadLocator>[];
};

const hash = (payload: unknown) =>
  createHash('sha256').update(canonicalRuleJson(payload)).digest('hex');
function fixture() {
  const campaign = newCampaign({ name: 'Rule coverage archive' });
  const turnId = randomUUID();
  const context = {
    systemId: randomUUID(),
    systemKey: 'synthetic',
    systemName: 'Synthetic',
    kind: RuleSystemKind.Library,
    revision: 1,
    contentHash: 'a'.repeat(64),
  };
  const makeRead = (tool: RuleRead['tool'], payload: Record<string, unknown>): RuleRead => {
    const id = randomUUID();
    payload.receipt = id;
    return {
      id,
      campaignId: campaign.id,
      turnId,
      context,
      tool,
      transportRequestId: id,
      argumentDigest: 'b'.repeat(64),
      resultHash: hash(payload),
      payload,
      createdAt: campaign.createdAt,
    };
  };
  const original = makeRead('rules_get', {
    revision: 1,
    contentHash: context.contentHash,
    path: 'core_rules.synthetic.rule',
    view: 'text',
    start: 100,
    end: 120,
    text: 'x'.repeat(20),
    complete: true,
    cursor: null,
    structural: false,
  });
  const search = makeRead('rules_search', {
    revision: 1,
    contentHash: context.contentHash,
    suppliedEvidenceCaptured: true,
    entries: [
      {
        path: original.payload.path,
        matchWindow: { start: 105, end: 115 },
        alreadySupplied: true,
        matchSupplied: true,
        originalComplete: false,
        suppliedOriginals: [originalReadLocator(original.payload)],
      },
    ],
  });
  return {
    format: 'local-rpg',
    campaign,
    turns: [
      {
        id: turnId,
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: TurnStatus.Failed,
        action: 'Consult a rule',
        narrative: 'Consulted a rule.',
        changes: [],
        error: null,
        undone: false,
        settings: campaign.settings,
        context: null,
        createdAt: campaign.createdAt,
        completedAt: campaign.createdAt,
        ruleContext: context,
        ruleReads: [original, search],
      },
    ],
    snapshots: [],
    memories: [],
    diceSessions: [],
    diceRecords: [],
    combatPreparations: [],
    combatPreparedCharacters: [],
  };
}

test('archive coverage references remap with their originals and survive a second import', () => {
  const input = fixture();
  let output = remapArchive(input);
  for (let pass = 0; pass < 2; pass++) {
    const [original, search] = output.turns[0]!.ruleReads!;
    const locator = (
      search!.payload.entries as { suppliedOriginals: { receiptId: string; start: number }[] }[]
    )[0]!.suppliedOriginals[0]!;
    assert.equal(locator.receiptId, original!.id);
    assert.notEqual(locator.receiptId, input.turns[0]!.ruleReads[0]!.id);
    assert.equal(locator.start, 100);
    assert.equal(search!.resultHash, hash(search!.payload));
    output = remapArchive(output);
  }
});

test('archive rejects forged coverage links and claims even with a recomputed search hash', () => {
  const corruptions = [
    (entry: SearchEntry) => {
      entry.suppliedOriginals![0]!.receiptId = randomUUID();
    },
    (entry: SearchEntry) => {
      entry.suppliedOriginals![0]!.start = 99;
    },
    (entry: SearchEntry) => {
      entry.suppliedOriginals![0]!.complete = false;
    },
    (entry: SearchEntry) => {
      entry.suppliedOriginals![0]!.nextRead = { path: entry.path, view: 'text', cursor: 'forged' };
    },
    (entry: SearchEntry) => {
      entry.path = 'core_rules.other.rule';
    },
    (entry: SearchEntry) => {
      entry.originalComplete = true;
    },
    (entry: SearchEntry) => {
      entry.matchWindow = { start: 0, end: 10 };
    },
    (entry: SearchEntry) => {
      entry.suppliedOriginals = [];
    },
    (entry: SearchEntry) => {
      delete entry.suppliedOriginals;
    },
  ];
  for (const corrupt of corruptions) {
    const input = fixture();
    const search = input.turns[0]!.ruleReads[1]!;
    corrupt((search.payload.entries as SearchEntry[])[0]!);
    search.resultHash = hash(search.payload);
    assert.throws(() => remapArchive(input), /Rule search evidence references/);
  }
});

test('archive coverage cannot borrow a receipt from another turn or a failed original', () => {
  for (const failed of [false, true]) {
    const input = fixture();
    const [original] = input.turns[0]!.ruleReads;
    if (failed) {
      original!.payload.error = { code: 'unavailable' };
      original!.resultHash = hash(original!.payload);
    } else {
      const other = {
        ...input.turns[0]!,
        id: randomUUID(),
        requestId: randomUUID(),
        ruleReads: [original!],
      };
      original!.turnId = other.id;
      input.turns[0]!.ruleReads = input.turns[0]!.ruleReads.slice(1);
      input.turns.push(other);
    }
    assert.throws(() => remapArchive(input), /Rule search evidence references/);
  }
});

test('NPC captured rule evidence remaps nested search references and its payload hash', () => {
  const archive = fixture();
  const reads = structuredClone(archive.turns[0]!.ruleReads);
  const row = {
    id: randomUUID(),
    campaignId: archive.campaign.id,
    sessionId: randomUUID(),
    turnId: archive.turns[0]!.id,
    ownerTurnId: archive.turns[0]!.id,
    reservedCharacterId: randomUUID(),
    status: 'interrupted',
    result: null,
    frozenInput: {
      characters: [],
      knowledge: [],
      introductionEvidence: {
        campaignId: archive.campaign.id,
        turnId: archive.turns[0]!.id,
        sourceSpans: [],
        ruleReads: reads,
      },
    },
  } as unknown as NpcPreparationArchive;
  const ids = new Map<string, string>();
  const mapped = (id: string) => {
    if (!ids.has(id)) ids.set(id, randomUUID());
    return ids.get(id)!;
  };
  remapNpcPreparation(row, mapped);
  const [original, search] = row.frozenInput.introductionEvidence.ruleReads;
  const locator = (search!.payload.entries as SearchEntry[])[0]!.suppliedOriginals![0]!;
  assert.equal(locator.receiptId, original!.id);
  assert.equal(search!.resultHash, hash(search!.payload));
});
