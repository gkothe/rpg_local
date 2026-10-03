import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { cleanProfile } from '../src/providers/antigravityMcpBook.js';

test('owned Antigravity cleanup retries transient updater locks within the verified profile', async () => {
  let calls = 0;
  const profile = path.join(os.tmpdir(), 'rpg-agy-private-cleanup-fixture');
  await cleanProfile(profile, async (target, options) => {
    assert.equal(target, profile);
    assert.deepEqual(options, { recursive: true, force: true });
    calls++;
    if (calls < 3) throw Object.assign(Error('Updater lock'), { code: 'EBUSY' });
  });
  assert.equal(calls, 3);
  await assert.rejects(
    cleanProfile(path.join(os.tmpdir(), 'outside-profile'), async () => {
      throw Error('Must never remove');
    }),
    /validation/
  );
});

test('owned cleanup preserves permanent filesystem failures without retrying them', async () => {
  let calls = 0;
  const failure = Object.assign(Error('Permanent failure'), { code: 'EIO' });
  await assert.rejects(
    cleanProfile(path.join(os.tmpdir(), 'rpg-agy-private-cleanup-fixture'), async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal(calls, 1);
});
