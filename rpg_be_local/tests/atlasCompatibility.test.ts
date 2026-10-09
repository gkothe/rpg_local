import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign } from '../src/domain/campaign.js';
import { atlasConflict, assertAtlas } from '../src/domain/atlasCompatibility.js';
import { freezeAtlas } from '../src/domain/atlasRecall.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';

const addPlace = (campaign: ReturnType<typeof newCampaign>) =>
  mutateAtlas(campaign, {
    createPlaces: [
      {
        key: 'room',
        title: 'Room',
        text: 'Public.',
        visibility: 'player',
        certainty: 'established',
      },
    ],
    places: [{ value: { placeId: { localKey: 'room' }, visited: false }, expected: null }],
  });

test('historical absent atlas contracts remain compatible with newer campaign geography', () => {
  const campaign = addPlace(newCampaign({ name: 'Historical atlas' }));
  assert.equal(atlasConflict(undefined, campaign), null);
  assert.doesNotThrow(() => assertAtlas(undefined, campaign));
});

test('captured geography detects changed content while ignoring campaign audit revisions', () => {
  const campaign = newCampaign({ name: 'Frozen atlas' });
  const frozen = freezeAtlas(campaign);
  campaign.revision += 20;
  assert.equal(atlasConflict(frozen, campaign), null);
  const changed = addPlace(campaign);
  assert.match(atlasConflict(frozen, changed)!, /Geography changed/);
  assert.throws(() => assertAtlas(frozen, changed), { code: 'atlas_context_changed' });
});
