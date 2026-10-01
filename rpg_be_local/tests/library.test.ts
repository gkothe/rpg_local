import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSections } from '../src/domain/sourceSections.js';
import { textSource } from '../src/services/sources.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { remapArchive } from '../src/services/library.js';
import { privateIpv4 } from '../src/security.js';
import { randomUUID } from 'node:crypto';

test('source sections preserve Unicode, original offsets and page boundaries while pins include only selected current sections', () => {
  const source = textSource(
    'Rules',
    '## Page 1\n' + '😀'.repeat(2500) + '\n## Page 2\nStealth: move silently.'
  );
  source.status = 'confirmed';
  const sections = sourceSections(source);
  assert.equal(sections.map((s) => s.text).join(''), source.text);
  assert.ok(sections.every((s) => s.text.length <= 4000 && !/^[\uDC00-\uDFFF]/.test(s.text)));
  assert.equal(sections[0]!.page, 1);
  assert.equal(sections.at(-1)!.page, 2);
  const c = newCampaign({ name: 'Test' });
  c.sources = [source];
  c.pinnedSourceSections = [{ sourceId: source.id, version: 1, index: sections.length - 1 }];
  const context = buildContext(c, [], 'Sneak', [], 16000);
  assert.match(context.prompt, /move silently/);
  assert.doesNotMatch(context.prompt, /😀/);
  assert.throws(
    () => buildContext({ ...c, instructions: 'x'.repeat(16000) }, [], 'Sneak', [], 16000),
    (e) => (e as { code: string }).code === 'context_mandatory_overflow'
  );
});
test('archive remaps only schema references and preserves UUID-looking narrative/private text', () => {
  const c = newCampaign({ name: 'Archive' });
  c.notes = c.id;
  c.description = c.id;
  c.state = { literal: c.id };
  const source = textSource(c.id, c.id);
  c.sources = [source];
  const out = remapArchive({
    format: 'local-rpg',
    version: 1,
    campaign: c,
    turns: [],
    snapshots: [],
    memories: [],
  });
  assert.notEqual(out.campaign.id, c.id);
  assert.notEqual(out.campaign.sources[0]!.id, source.id);
  assert.equal(out.campaign.notes, c.id);
  assert.equal(out.campaign.description, c.id);
  assert.deepEqual(out.campaign.state, c.state);
  assert.equal(out.campaign.sources[0]!.text, c.id);
  assert.equal(out.campaign.sources[0]!.originalAvailable, false);
});
test('private IPv4 interface validation rejects invalid octets/public/all-interface addresses', () => {
  for (const valid of ['10.0.0.1', '192.168.1.250', '172.16.0.1', '172.31.255.255'])
    assert.ok(privateIpv4(valid));
  for (const invalid of ['192.168.999.1', '172.32.0.1', '0.0.0.0', '8.8.8.8', '127.0.0.1', '::1'])
    assert.equal(privateIpv4(invalid), false);
});

test('archive rejects unresolved undo field references and snapshot entity collisions', () => {
  const c = newCampaign({ name: 'Invalid undo reference' });
  const turnId = randomUUID();
  const char = {
    id: String(randomUUID()),
    name: 'Guard',
    type: 'npc',
    attributes: {},
    inventory: {},
    description: {},
    notes: '',
    revision: 0,
  };
  const archive = {
    format: 'local-rpg',
    version: 1,
    campaign: c,
    turns: [
      {
        id: turnId,
        campaignId: c.id,
        requestId: randomUUID(),
        status: 'completed',
        action: 'Wait',
        narrative: 'A guard arrives.',
        changes: [],
        error: null,
        undone: false,
        settings: c.settings,
        context: null,
        createdAt: c.createdAt,
        completedAt: c.createdAt,
      },
    ],
    snapshots: [
      {
        turnId,
        beforeCharacters: [],
        afterCharacters: [char],
        beforeState: {},
        afterState: {},
        beforeMemory: null,
        changedFields: [{ characterId: randomUUID(), fields: ['name'] }],
      },
    ],
    memories: [],
  };
  assert.throws(() => remapArchive(archive), /Unresolved changed-field/);
  archive.snapshots[0]!.changedFields = [];
  archive.snapshots[0]!.afterCharacters[0]!.id = c.id;
  assert.throws(() => remapArchive(archive), /collides with another entity/);
});
