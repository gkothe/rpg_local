import test from 'node:test';
import assert from 'node:assert/strict';
import type { Generator } from '../src/providers/service.js';
import { humanizeNarrative } from '../src/services/narrativeHumanizer.js';
import { Problem } from '../src/errors.js';

const settings = { provider: 'codex', model: 'fixture', effort: 'high' };
const original = 'Mira waits. Hunger is 2.\n\nWhat do you do?';
function generator(generate: Generator['generate']): Generator {
  return {
    generate,
    capacity: async () => 10000,
    generateGameplay: async () => {
      throw new Error('Editor must not invoke gameplay');
    },
  };
}

test('editor retains provider/model and uses CLI default without an effort resolver', async () => {
  let calls = 0;
  const g = generator(async (selected, prompt, schema) => {
    assert.deepEqual(selected, { ...settings, effort: null });
    assert.ok(prompt.includes(original.replaceAll('\n', '\\n')));
    assert.equal((schema as { additionalProperties: boolean }).additionalProperties, false);
    calls++;
    return { narrative: calls === 1 ? original.replace('2', '9') : original };
  });
  assert.equal(await humanizeNarrative(g, settings, original), original);
  assert.equal(calls, 2);
});

test('editor resolves low effort once, retains it for correction and never mutates GM settings', async () => {
  let resolutions = 0;
  let calls = 0;
  const g = generator(async (selected) => {
    assert.deepEqual(selected, { ...settings, effort: 'low' });
    return { narrative: ++calls === 1 ? original.replace('2', '9') : original };
  });
  g.narrativeEditorSettings = async (selected) => {
    resolutions++;
    return { ...selected, effort: 'low' };
  };
  assert.equal(await humanizeNarrative(g, settings, original), original);
  assert.equal(resolutions, 1);
  assert.equal(settings.effort, 'high');
  assert.equal(calls, 2);
});

test('exhausted editor fails without returning original, quota stops immediately', async () => {
  let calls = 0;
  await assert.rejects(
    humanizeNarrative(
      generator(async () => {
        calls++;
        return { narrative: 'Wrong 9' };
      }),
      settings,
      original
    )
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    humanizeNarrative(
      generator(async () => {
        calls++;
        throw new Problem(429, 'provider_quota', 'Quota exhausted');
      }),
      settings,
      original
    ),
    /Quota/
  );
  assert.equal(calls, 1);
});

test('cancellation never invokes a provider', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    humanizeNarrative(
      generator(async () => {
        throw new Error('Unexpected provider call');
      }),
      settings,
      original,
      { signal: controller.signal }
    ),
    /cancelled/
  );
});
