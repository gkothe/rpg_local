import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { atlasRecall, freezeAtlas } from '../src/domain/atlasRecall.js';
import { KnowledgeVisibility } from '../src/domain/knowledge.js';

function graph() {
  const c = mutateAtlas(newCampaign({ name: 'Route recall QA' }), {
    createPlaces: ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      title: key,
      text: 'Synthetic location.',
      visibility: 'player',
      certainty: 'established',
    })),
    places: ['a', 'b', 'c', 'd'].map((key) => ({
      value: { placeId: { localKey: key }, visited: false },
      expected: null,
    })),
  });
  const [a, b, cc, d] = c.atlas!.places.map((p) => p.placeId);
  const edge = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
    from,
    to,
    bidirectional: false,
    kind: 'path',
    access: 'open',
    visibility: 'player',
    certainty: 'established',
    origin: 'player',
    evidence: [],
    ...extra,
  });
  return { c, a: a!, b: b!, cc: cc!, d: d!, edge };
}

test('directed cyclic graph terminates and does not invent reverse connections', () => {
  const { c, a, b, cc, d, edge } = graph();
  const changed = mutateAtlas(c, {
    routes: [edge(a, b), edge(b, cc), edge(cc, a), edge(cc, d)].map((value) => ({
      value,
      expected: null,
    })),
  });
  const reader = atlasRecall(freezeAtlas(changed));
  const result = reader.routes({ from: a, to: d });
  assert.equal(result.found, true);
  assert.equal(result.routes!.length, 3);
  assert.equal(reader.routes({ from: d, to: a }).found, false);
  assert.equal(reader.routes({ from: a, to: a }).routes!.length, 0);
});

test('mixed units aggregate while unknown segments and conditional travel prevent exact totals', () => {
  const { c, a, b, cc, d, edge } = graph();
  const changed = mutateAtlas(c, {
    routes: [
      edge(a, b, { distance: { value: 1, unit: 'km' }, travel: { mode: 'walk', minutes: 10 } }),
      edge(b, cc, {
        distance: { value: 10, unit: 'ft' },
        travel: { mode: 'walk', minutes: 5, conditions: 'Only in dry weather' },
      }),
      edge(cc, d),
    ].map((value) => ({ value, expected: null })),
  });
  const reader = atlasRecall(freezeAtlas(changed));
  const partial = reader.routes({ from: a, to: d, mode: 'walk' });
  assert.equal(partial.distance, null);
  assert.equal(partial.knownDistanceMetres, 1003.048);
  assert.deepEqual(partial.unknownDistanceRouteIds, [changed.atlas!.routes[2]!.id]);
  assert.equal(partial.minutes, null);
  const measured = reader.routes({ from: a, to: cc, mode: 'walk' });
  assert.deepEqual(measured.distance, { value: 1003.048, unit: 'm' });
  assert.equal(measured.minutes, null);
  assert.equal(reader.routes({ from: a, to: b, mode: 'WALK' }).minutes, 10);
});

test('frozen map is independent from later canonical topology and name changes', () => {
  const { c, a, b, edge } = graph();
  const changed = mutateAtlas(c, { routes: [{ value: edge(a, b), expected: null }] });
  const reader = atlasRecall(freezeAtlas(changed));
  changed.atlas!.routes = [];
  changed.knowledge![0]!.title = 'Later changed title';
  assert.equal(reader.routes({ from: a, to: b }).found, true);
  assert.equal(reader.search({ query: 'a' }).places[0]!.title, 'a');
});

test('scoped route lookup rejects foreign endpoints rather than crossing scope invisibly', () => {
  const { c, a, b, cc } = graph();
  c.atlas!.places.find((p) => p.placeId === b)!.parentPlaceId = a;
  const reader = atlasRecall(freezeAtlas(c));
  assert.throws(() => reader.routes({ from: b, to: cc, scope: a }), { code: 'atlas_scope' });
  assert.throws(() => reader.routes({ from: b, to: randomUUID() }), { code: 'atlas_place' });
});

test('closed and unknown-access routes remain available as constrained options', () => {
  const { c, a, b, edge } = graph();
  const locked = edge(a, b, { access: 'locked' });
  const unknown = edge(a, b, { access: 'unknown' });
  const changed = mutateAtlas(c, {
    routes: [locked, unknown].map((value) => ({ value, expected: null })),
  });
  const result = atlasRecall(freezeAtlas(changed)).routes({ from: a, to: b });
  assert.equal(result.found, false);
  const constrained = (result as unknown as { constrainedRoutes: { id: string; access: string }[] })
    .constrainedRoutes;
  assert.ok(Array.isArray(constrained), 'Route lookup must report known constrained connections');
  assert.deepEqual(
    constrained.map((r) => [r.id, r.access]),
    [
      [changed.atlas!.routes[0]!.id, 'locked'],
      [changed.atlas!.routes[1]!.id, 'unknown'],
    ]
  );
});

test('GM map retrieval explicitly labels hidden Places private', () => {
  const { c, a } = graph();
  c.knowledge![0]!.visibility = KnowledgeVisibility.GmOnly;
  const result = atlasRecall(freezeAtlas(c)).get({ scope: a });
  assert.equal((result.places[0] as unknown as { visibility: string }).visibility, 'gm_only');
});
