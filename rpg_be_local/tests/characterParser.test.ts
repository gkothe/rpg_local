import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCharacterSource } from '../src/services/characterParser.js';
import type { Generator } from '../src/providers/service.js';

const settings = { provider: 'codex', model: 'fixture', effort: 'low' };
test('long character text is completely processed in bounded sequential sections without repeating context', async () => {
  const text = '# Sigurd\n\n' + 'Health 6; Strength 4. São Paulo 😀\n\n'.repeat(210);
  const seen: string[] = [];
  let inFlight = false;
  const generator: Generator = {
    capacity: async () => 4800,
    generate: async (_settings, prompt) => {
      assert.equal(inFlight, false);
      inFlight = true;
      assert.ok(Buffer.byteLength(prompt, 'utf8') <= 4800);
      const { source } = JSON.parse(prompt);
      assert.ok(!source.includes('\ufffd'));
      seen.push(source);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight = false;
      return seen.length === 1
        ? { name: 'Sigurd', attributes: { health: 6, physical: { strength: 4 } } }
        : {
            attributes: { physical: { stamina: 3 } },
            inventory: { sword: 1 },
            description: { clan: 'Malkavian' },
          };
    },
  };
  const draft = await parseCharacterSource(text, settings, generator, async () => {});
  assert.ok(seen.length > 1);
  assert.equal(seen.join(''), text);
  assert.equal(draft.name, 'Sigurd');
  assert.deepEqual(draft.attributes, { health: 6, physical: { strength: 4, stamina: 3 } });
  assert.deepEqual(draft.inventory, { sword: 1 });
});

test('short JSON/text sheets keep a single validated parsing call', async () => {
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 16000,
    generate: async () => {
      calls++;
      return { name: 'Sigurd', attributes: { health: 6 } };
    },
  };
  const draft = await parseCharacterSource(
    '{"name":"Sigurd","health":6}',
    settings,
    generator,
    async () => {}
  );
  assert.equal(calls, 1);
  assert.equal(draft.name, 'Sigurd');
});

test('stale ownership stops further chunks and malformed output is never accepted', async () => {
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 2400,
    generate: async () => {
      calls++;
      return { name: 'Sigurd' };
    },
  };
  await assert.rejects(
    parseCharacterSource('A'.repeat(10000), settings, generator, async () => {
      if (calls) throw new Error('Campaign changed');
    }),
    /Campaign changed/
  );
  assert.equal(calls, 1);
  generator.generate = async () => ({ name: 123 });
  await assert.rejects(parseCharacterSource('Sheet', settings, generator, async () => {}));
});
