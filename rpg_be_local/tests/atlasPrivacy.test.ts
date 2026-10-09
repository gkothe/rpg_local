import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { projectAtlas } from '../src/domain/atlasProjection.js';
import { ATLAS_LIMITS, atlasExpected, atlasRouteSchema } from '../src/domain/atlas.js';

test('public atlas omits a hidden ancestor and its geometry while showing the known child', () => {
  const campaign = mutateAtlas(newCampaign({ name: 'Privacy fixture' }), {
    createPlaces: [
      {
        key: 'parent',
        title: 'Secret site',
        text: 'Private.',
        visibility: 'gm_only',
        certainty: 'established',
      },
      {
        key: 'child',
        title: 'Known room',
        text: 'Public.',
        visibility: 'player',
        certainty: 'established',
      },
    ],
    places: [
      { value: { placeId: { localKey: 'parent' }, visited: false }, expected: null },
      {
        value: {
          placeId: { localKey: 'child' },
          parentPlaceId: { localKey: 'parent' },
          visited: true,
        },
        expected: null,
      },
    ],
  });
  const [hidden, visible] = campaign.atlas!.places;
  const result = projectAtlas(campaign, visible!.placeId);
  assert.equal(result.places[0]!.parentPlaceId, null);
  assert.equal(result.places[0]!.expected, atlasExpected(visible));
  assert.equal(result.breadcrumb.length, 1);
  assert.ok(!JSON.stringify(result).includes(hidden!.placeId));
  assert.ok(!JSON.stringify(result).includes('Secret site'));
});

test('public hub retrieval pages incident routes and their remote endpoint identities', () => {
  const count = ATLAS_LIMITS.routePageSize + 30;
  const keys = ['hub', ...Array.from({ length: count }, (_, i) => `remote-${i}`)];
  const campaign = mutateAtlas(newCampaign({ name: 'Hub fixture' }), {
    createPlaces: keys.map((key) => ({
      key,
      title: key,
      text: 'Public.',
      visibility: 'player',
      certainty: 'established',
    })),
    places: keys.map((key) => ({
      value: { placeId: { localKey: key }, visited: false },
      expected: null,
    })),
  });
  const hub = campaign.atlas!.places[0]!.placeId;
  campaign.atlas!.routes = campaign.atlas!.places.slice(1).map((place) =>
    atlasRouteSchema.parse({
      id: randomUUID(),
      from: hub,
      to: place.placeId,
      bidirectional: true,
      kind: 'path' as const,
      access: 'open' as const,
      visibility: 'player' as const,
      certainty: 'established' as const,
      origin: 'player' as const,
      evidence: [],
    })
  );
  const result = projectAtlas(campaign, hub);
  assert.equal(result.routes.length, ATLAS_LIMITS.routePageSize);
  assert.ok(result.places.length <= ATLAS_LIMITS.routePageSize + 1);
  assert.equal(result.nextRouteCursor, ATLAS_LIMITS.routePageSize);
  const next = projectAtlas(campaign, hub, 0, false, result.nextRouteCursor!);
  assert.equal(next.routes.length, count - ATLAS_LIMITS.routePageSize);
  assert.equal(next.nextRouteCursor, null);
});
