import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { compileAtlas, prepareAtlasResult } from '../src/domain/atlasCommit.js';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { gmResponse, gmIntroduction } from './ownedGameplayFixture.js';
import { KnowledgeKind, KnowledgeCertainty, KnowledgeStatus } from '../src/domain/knowledge.js';
import { CharacterType } from '../src/domain/options.js';

function prepared(campaignId: string, turnId: string) {
  return prepareAtlasResult(
    randomUUID(),
    {
      places: [
        {
          key: 'site',
          title: 'Warehouse',
          text: 'Short warehouse description.',
          certainty: 'established',
          visibility: 'player',
          origin: 'gm',
          evidence: [],
        },
        {
          key: 'room',
          title: 'Office',
          text: 'Short office description.',
          certainty: 'established',
          visibility: 'player',
          origin: 'gm',
          evidence: [],
        },
      ],
      changes: {
        places: [
          { value: { placeId: { localKey: 'site' }, visited: false }, expected: null },
          {
            value: {
              placeId: { localKey: 'room' },
              parentPlaceId: { localKey: 'site' },
              visited: false,
              placement: { frameId: { localKey: 'ground' }, x: 1, y: 1, width: 4, height: 4 },
            },
            expected: null,
          },
        ],
        frames: [
          {
            value: {
              key: 'ground',
              placeId: { localKey: 'site' },
              label: 'Ground',
              floor: 'Ground',
              width: 20,
              height: 20,
              visibility: 'player',
              origin: 'gm',
              evidence: [],
            },
            expected: null,
          },
        ],
        routes: [
          {
            value: {
              from: { localKey: 'site' },
              to: { localKey: 'room' },
              kind: 'door',
              access: 'open',
              bidirectional: true,
              visibility: 'player',
              certainty: 'established',
              origin: 'gm',
              evidence: [],
            },
            expected: null,
          },
        ],
      },
    },
    { campaignId, turnId, sourceSpans: [], ruleReads: [] }
  );
}

test('compiling original wire twice retains receipt identities without appending twice or mutating wire', () => {
  const c = newCampaign({ name: 'Prepared atlas QA' });
  const turnId = randomUUID();
  const receipt = prepared(c.id, turnId);
  const wire = gmResponse('A warehouse appears.', [], {
    atlasChanges: { preparedReceiptIds: [receipt.id] },
  });
  const original = structuredClone(wire);
  const first = compileAtlas(wire, [receipt]);
  const second = compileAtlas(wire, [receipt]);
  assert.deepEqual(wire, original);
  assert.deepEqual(first, second);
  assert.equal(first.response.knowledgeChanges.length, 2);
  assert.equal(first.ids.get(0), receipt.bindings.places.site);
  assert.equal(first.response.atlasChanges!.routes![0]!.value.id, receipt.bindings.routes[0]);
  const applied = applyResponse(c, first.response, turnId, {
    campaignId: c.id,
    turnId,
    preparedKnowledgeIds: first.ids,
    preparedKnowledgeEvidence: first.knowledgeEvidence,
    preparedAtlasEvidence: first.atlasEvidence,
  });
  assert.equal(applied.campaign.atlas!.places[0]!.placeId, receipt.bindings.places.site);
  assert.equal(applied.campaign.atlas!.frames[0]!.id, receipt.bindings.frames.ground);
  assert.equal(applied.campaign.atlas!.routes[0]!.id, receipt.bindings.routes[0]);
});

test('compiler rejects duplicate, missing and undeclared local-key receipts', () => {
  const c = newCampaign({ name: 'Invalid prepared atlas QA' });
  const receipt = prepared(c.id, randomUUID());
  assert.throws(
    () =>
      compileAtlas(
        gmResponse('Duplicate.', [], {
          atlasChanges: { preparedReceiptIds: [receipt.id, receipt.id] },
        }),
        [receipt]
      ),
    /Duplicate/
  );
  assert.throws(
    () =>
      compileAtlas(
        gmResponse('Missing.', [], { atlasChanges: { preparedReceiptIds: [randomUUID()] } }),
        [receipt]
      ),
    /not ready/
  );
  receipt.draft.changes.places![0]!.value.placeId = { localKey: 'undeclared' };
  assert.throws(
    () =>
      compileAtlas(
        gmResponse('Bad key.', [], { atlasChanges: { preparedReceiptIds: [receipt.id] } }),
        [receipt]
      ),
    /not declared/
  );
});

test('ordinary knowledge indices and prepared allocation survive implicit NPC introduction prefixes', () => {
  const c = newCampaign({ name: 'Mixed prepared atlas QA' });
  const turnId = randomUUID();
  const receipt = prepared(c.id, turnId);
  const wire = gmResponse(
    'Mara points out the dock.',
    [
      {
        op: 'create',
        character: {
          name: 'Mara',
          type: CharacterType.Npc,
          attributes: {},
          inventory: {},
          description: {},
        },
        introduction: gmIntroduction,
      },
    ],
    {
      knowledgeChanges: [
        {
          op: 'create',
          kind: KnowledgeKind.Place,
          title: 'Dock',
          text: 'An ordinary Place.',
          certainty: KnowledgeCertainty.Established,
          status: KnowledgeStatus.Active,
          characterIds: [],
          ...gmIntroduction,
        },
      ],
      atlasChanges: {
        places: [
          { value: { placeId: { knowledgeChangeIndex: 0 }, visited: false }, expected: null },
        ],
        preparedReceiptIds: [receipt.id],
      },
    }
  );
  const compiled = compileAtlas(wire, [receipt]);
  assert.equal(compiled.ids.has(0), false);
  assert.equal(compiled.ids.get(1), receipt.bindings.places.site);
  assert.equal(compiled.response.knowledgeChanges[0]!.op, 'create');
  const applied = applyResponse(c, compiled.response, turnId, {
    campaignId: c.id,
    turnId,
    preparedKnowledgeIds: compiled.ids,
    preparedKnowledgeEvidence: compiled.knowledgeEvidence,
    preparedAtlasEvidence: compiled.atlasEvidence,
  });
  const dock = applied.campaign.knowledge!.find((p) => p.title === 'Dock')!;
  assert.equal(applied.campaign.atlas!.places[0]!.placeId, dock.id);
  assert.equal(
    applied.campaign.knowledge!.find((p) => p.title === 'Warehouse')!.id,
    receipt.bindings.places.site
  );
  assert.equal(applied.campaign.knowledge!.filter((p) => p.kind === KnowledgeKind.Npc).length, 1);
});

test('atlas undo restores touched records and leaves a later unrelated branch intact', () => {
  const c = mutateAtlas(newCampaign({ name: 'Undo atlas QA' }), {
    createPlaces: ['a', 'b'].map((key) => ({
      key,
      title: key,
      text: 'Synthetic Place.',
      visibility: 'player',
      certainty: 'established',
    })),
    places: ['a', 'b'].map((key) => ({
      value: { placeId: { localKey: key }, visited: false },
      expected: null,
    })),
  });
  const first = c.atlas!.places[0]!;
  const applied = applyResponse(
    c,
    gmResponse('One Place is visited.', [], {
      atlasChanges: { places: [{ value: { ...first, visited: true }, expected: first }] },
    }),
    randomUUID()
  );
  const later = structuredClone(applied.campaign);
  later.atlas!.places[1]!.visited = true;
  const undone = undoSnapshot(later, applied.snapshot);
  assert.equal(undone.atlas!.places[0]!.visited, false);
  assert.equal(undone.atlas!.places[1]!.visited, true);
  later.atlas!.places[0]!.parentPlaceId = later.atlas!.places[1]!.placeId;
  const before = structuredClone(later);
  assert.throws(() => undoSnapshot(later, applied.snapshot), /touched atlas record/);
  assert.deepEqual(later, before);
});
