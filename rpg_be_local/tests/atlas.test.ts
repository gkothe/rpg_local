import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { atlasSchema, validateAtlas, emptyAtlas } from '../src/domain/atlas.js';
import { newCampaign } from '../src/domain/campaign.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { projectAtlas } from '../src/domain/atlasProjection.js';
import {
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeCertainty,
  KnowledgeStatus,
  KnowledgeVisibility,
} from '../src/domain/knowledge.js';

const place = (id: string, hidden = false) => ({
  id,
  kind: KnowledgeKind.Place,
  title: hidden ? 'SECRET ROOM' : 'Warehouse',
  text: 'A short description.',
  origin: KnowledgeOrigin.Player,
  evidence: [],
  certainty: KnowledgeCertainty.Established,
  status: KnowledgeStatus.Active,
  characterIds: [],
  characterNames: {},
  createdTurnId: null,
  updatedTurnId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revision: 1,
  attributions: [],
  visibility: hidden ? KnowledgeVisibility.GmOnly : KnowledgeVisibility.Player,
});
test('atlas rejects containment cycles, dangling Places and invalid dimensions', () => {
  const c = newCampaign({ name: 'Synthetic atlas' });
  const a = randomUUID(),
    b = randomUUID();
  c.knowledge = [place(a), place(b)];
  c.atlas = {
    ...emptyAtlas(),
    places: [
      { placeId: a, parentPlaceId: b, visited: false },
      { placeId: b, parentPlaceId: a, visited: false },
    ],
  };
  assert.throws(() => validateAtlas(c), /cycle/i);
  c.atlas.places = [{ placeId: randomUUID(), visited: false }];
  assert.throws(() => validateAtlas(c), /Place/i);
  assert.equal(
    atlasSchema.safeParse({
      ...emptyAtlas(),
      frames: [
        {
          id: randomUUID(),
          placeId: a,
          label: 'Floor',
          floor: 'Ground',
          width: 0,
          height: 20,
          visibility: 'player',
          origin: 'player',
          evidence: [],
        },
      ],
    }).success,
    false
  );
});
test('manual Place creation is atomic, position marks only destination visited and stale expectations reject', () => {
  const c = newCampaign({ name: 'Synthetic atlas' });
  const changed = mutateAtlas(c, {
    createPlaces: [
      {
        key: 'site',
        title: 'Warehouse',
        text: 'Dockside storage.',
        visibility: 'player',
        certainty: 'established',
      },
    ],
    places: [{ value: { placeId: { localKey: 'site' }, visited: false }, expected: null }],
  });
  const id = changed.atlas!.places[0]!.placeId;
  assert.equal(c.knowledge!.length, 0);
  assert.equal(changed.knowledge![0]!.createdTurnId, null);
  const moved = mutateAtlas(changed, { position: { placeId: id, expected: null } });
  assert.equal(moved.atlas!.places[0]!.visited, true);
  assert.throws(
    () => mutateAtlas(moved, { position: { placeId: null, expected: null } }),
    /expected/i
  );
});
test('public projection removes private topology and never leaks hidden ancestors or frames', () => {
  const c = newCampaign({ name: 'Synthetic atlas' });
  const secret = randomUUID(),
    publicId = randomUUID();
  c.knowledge = [place(secret, true), place(publicId)];
  c.atlas = {
    ...emptyAtlas(),
    places: [
      { placeId: secret, visited: false },
      { placeId: publicId, parentPlaceId: secret, visited: true },
    ],
    position: publicId,
  };
  const result = projectAtlas(c, publicId);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(result.position, publicId);
});
