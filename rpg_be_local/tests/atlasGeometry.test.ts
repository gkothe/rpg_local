import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { projectAtlas } from '../src/domain/atlasProjection.js';
import { validateAtlas } from '../src/domain/atlas.js';
import { KnowledgeVisibility } from '../src/domain/knowledge.js';

function warehouse() {
  const original = newCampaign({ name: 'Warehouse geometry QA' });
  const c = mutateAtlas(original, {
    createPlaces: [
      {
        key: 'site',
        title: 'Warehouse',
        text: 'Dockside site.',
        visibility: 'player',
        certainty: 'established',
      },
      {
        key: 'bay',
        title: 'Loading bay',
        text: 'Open loading area.',
        visibility: 'player',
        certainty: 'established',
      },
      {
        key: 'office',
        title: 'Office',
        text: 'Bookkeeping room.',
        visibility: 'player',
        certainty: 'established',
      },
      {
        key: 'secret',
        title: 'SECRET ROOM',
        text: 'SECRET DESCRIPTION',
        visibility: 'gm_only',
        certainty: 'established',
      },
    ],
    frames: [
      {
        value: {
          key: 'ground',
          placeId: { localKey: 'site' },
          label: 'Ground floor',
          floor: 'Ground',
          width: 20,
          height: 20,
          visibility: 'player',
          origin: 'player',
          evidence: [],
          privateAssetId: randomUUID(),
        },
        expected: null,
      },
    ],
    places: [
      { value: { placeId: { localKey: 'site' }, visited: true }, expected: null },
      {
        value: {
          placeId: { localKey: 'bay' },
          parentPlaceId: { localKey: 'site' },
          visited: false,
          placement: { frameId: { localKey: 'ground' }, x: 1, y: 1, width: 4, height: 4 },
        },
        expected: null,
      },
      {
        value: {
          placeId: { localKey: 'office' },
          parentPlaceId: { localKey: 'site' },
          visited: false,
          placement: { frameId: { localKey: 'ground' }, x: 10, y: 1, width: 4, height: 4 },
        },
        expected: null,
      },
      {
        value: {
          placeId: { localKey: 'secret' },
          parentPlaceId: { localKey: 'site' },
          visited: false,
          placement: { frameId: { localKey: 'ground' }, x: 10, y: 12, width: 2, height: 2 },
        },
        expected: null,
      },
    ],
  });
  const [site, bay, office, secret] = c.atlas!.places.map((p) => p.placeId);
  const frame = c.atlas!.frames[0]!;
  const route = {
    from: bay!,
    to: office!,
    bidirectional: true,
    kind: 'door',
    access: 'open',
    visibility: 'player',
    certainty: 'established',
    origin: 'player',
    evidence: [],
    drawing: {
      frameId: frame.id,
      points: [
        { x: 5, y: 3 },
        { x: 10, y: 3 },
      ],
    },
  };
  return { c, site: site!, bay: bay!, office: office!, secret: secret!, frame, route };
}

test('rooms on an ancestor floor and an attached passage validate', () => {
  const { c, route } = warehouse();
  const saved = mutateAtlas(c, { routes: [{ value: route, expected: null }] });
  assert.match(saved.atlas!.routes[0]!.id, /^[a-f0-9-]{36}$/);
  assert.equal(
    saved.atlas!.places.find((p) => p.placement)?.placement!.frameId,
    saved.atlas!.frames[0]!.id
  );
  assert.doesNotThrow(() => validateAtlas(saved));
});

test('placement refuses half dimensions, out-of-frame rooms and unrelated frame owners', () => {
  const { c, bay, office } = warehouse();
  const p = c.atlas!.places.find((row) => row.placeId === bay)!;
  assert.throws(() =>
    mutateAtlas(c, {
      places: [{ value: { ...p, placement: { ...p.placement, height: undefined } }, expected: p }],
    })
  );
  assert.throws(
    () =>
      mutateAtlas(c, {
        places: [{ value: { ...p, placement: { ...p.placement, x: 19 } }, expected: p }],
      }),
    /fit/
  );
  c.atlas!.frames[0]!.placeId = office;
  assert.throws(() => validateAtlas(c), /ancestor/);
});

test('route drawings reject foreign floors, dangling frames and out-of-frame points', () => {
  const { c, route } = warehouse();
  assert.throws(
    () =>
      mutateAtlas(c, {
        routes: [
          {
            value: { ...route, drawing: { ...route.drawing, frameId: randomUUID() } },
            expected: null,
          },
        ],
      }),
    /same floor/
  );
  assert.throws(
    () =>
      mutateAtlas(c, {
        routes: [
          {
            value: {
              ...route,
              drawing: {
                ...route.drawing,
                points: [
                  { x: 5, y: 3 },
                  { x: 21, y: 3 },
                ],
              },
            },
            expected: null,
          },
        ],
      }),
    /fit/
  );
});

test('route polyline must attach to its declared rooms instead of arbitrary positions', () => {
  const { c, route } = warehouse();
  assert.throws(
    () =>
      mutateAtlas(c, {
        routes: [
          {
            value: {
              ...route,
              drawing: {
                ...route.drawing,
                points: [
                  { x: 1, y: 19 },
                  { x: 19, y: 19 },
                ],
              },
            },
            expected: null,
          },
        ],
      }),
    /attach|endpoint/i
  );
});

test('removing a parent with dependent rooms refuses dangling containment atomically', () => {
  const { c, site } = warehouse();
  const original = structuredClone(c);
  assert.throws(
    () => mutateAtlas(c, { removePlaces: [c.atlas!.places.find((p) => p.placeId === site)!] }),
    /parent|frame/
  );
  assert.deepEqual(c, original);
});

test('private room, route geometry, source evidence and original image identity stay off public map', () => {
  const { c, route, secret, site, frame } = warehouse();
  const hiddenRoute = {
    ...route,
    to: secret,
    visibility: 'gm_only',
    drawing: {
      frameId: frame.id,
      points: [
        { x: 5, y: 3 },
        { x: 10, y: 13 },
      ],
    },
  };
  const saved = mutateAtlas(c, { routes: [{ value: hiddenRoute, expected: null }] });
  const result = projectAtlas(saved, site);
  const wire = JSON.stringify(result);
  assert.equal(result.routes.length, 0);
  assert.equal(result.places.length, 3);
  assert.equal(result.frames[0]!.width, 20);
  assert.equal(result.frames[0]!.height, 20);
  for (const privateText of [
    secret,
    saved.atlas!.routes[0]!.id,
    frame.privateAssetId!,
    'SECRET',
    'evidence',
    'privateAssetId',
  ])
    assert.equal(wire.includes(privateText), false);
  assert.throws(() => projectAtlas(saved, secret), { status: 404, code: 'atlas_scope' });
});

test('a private frame suppresses room placement and route drawing references', () => {
  const { c, route, frame, site } = warehouse();
  const saved = mutateAtlas(c, { routes: [{ value: route, expected: null }] });
  saved.atlas!.frames[0]!.visibility = KnowledgeVisibility.GmOnly;
  const result = projectAtlas(saved, site);
  assert.equal(result.frames.length, 0);
  assert.equal(JSON.stringify(result).includes(frame.id), false);
  assert.equal(result.routes.length, 1);
});

test('manual spatial creation refuses caller supplied frame and route identities', () => {
  const { c, route, frame } = warehouse();
  assert.throws(
    () => mutateAtlas(c, { routes: [{ value: { ...route, id: randomUUID() }, expected: null }] }),
    { code: 'atlas_identity' }
  );
  assert.throws(
    () =>
      mutateAtlas(c, {
        frames: [{ value: { ...frame, id: randomUUID(), key: 'new-floor' }, expected: null }],
      }),
    { code: 'atlas_identity' }
  );
});

test('canonical frame identity cannot collide with campaign or unrelated Knowledge identity', () => {
  const { c } = warehouse();
  c.atlas!.frames[0]!.id = c.id;
  assert.throws(() => validateAtlas(c), /identity/);
  const fresh = warehouse().c;
  const unrelated = {
    ...structuredClone(fresh.knowledge![0]!),
    id: randomUUID(),
    title: 'Unmapped Place',
  };
  fresh.knowledge!.push(unrelated);
  fresh.atlas!.frames[0]!.id = unrelated.id;
  assert.throws(() => validateAtlas(fresh), /identity/);
});
