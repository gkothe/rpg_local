import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { remapArchive } from '../src/services/library.js';
import {
  RULE_ARCHIVE_FORMAT_VERSION,
  DICE_ARCHIVE_FORMAT_VERSION,
  LEGACY_ARCHIVE_FORMAT_VERSION,
} from '../src/domain/versions.js';

test('named legacy, dice and rules archive versions retain instructions-only compatibility', () => {
  for (const version of [
    LEGACY_ARCHIVE_FORMAT_VERSION,
    DICE_ARCHIVE_FORMAT_VERSION,
    RULE_ARCHIVE_FORMAT_VERSION,
  ]) {
    const original = newCampaign({ name: 'Original archive fixture' });
    const output = remapArchive({
      format: 'local-rpg',
      version,
      campaign: { ...original, ruleSystemId: null },
      turns: [],
      snapshots: [],
      memories: [],
    });
    assert.notEqual(output.campaign.id, original.id);
    assert.equal(output.campaign.ruleSystemId, null);
  }
});
test('v3 rejects a local book ID without its portable reference and preserves unresolved references', () => {
  const campaign = {
    ...newCampaign({ name: 'Book reference fixture' }),
    ruleSystemId: randomUUID(),
  };
  assert.throws(
    () =>
      remapArchive({
        format: 'local-rpg',
        version: RULE_ARCHIVE_FORMAT_VERSION,
        campaign,
        turns: [],
        snapshots: [],
        memories: [],
      }),
    /portable rule reference/
  );
  const reference = {
    systemKey: 'missing-book',
    systemName: 'Original fixture',
    kind: 'library',
    contentHash: 'a'.repeat(64),
  };
  const result = remapArchive({
    format: 'local-rpg',
    version: RULE_ARCHIVE_FORMAT_VERSION,
    campaign: { ...campaign, ruleReference: reference },
    turns: [],
    snapshots: [],
    memories: [],
  });
  assert.equal(result.campaign.ruleSystemId, null);
  assert.deepEqual(result.campaign.ruleResolution, { status: 'unresolved', reference });
});
