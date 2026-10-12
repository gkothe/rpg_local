import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  withResponseRetries,
  structuredResponseRetryFeedback,
} from '../src/domain/responseRetry.js';
import { Problem } from '../src/errors.js';
import { gmIndexEntryValueSchema } from '../src/domain/gmIndex.js';

test('invalid UUID feedback explains exact copying without exposing rejected values', () => {
  const result = z.object({ id: z.uuid() }).safeParse({
    id: '12345678-1234-4234-8234-123456789012PRIVATE',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const feedback = structuredResponseRetryFeedback(result.error)!;
    assert.match(feedback, /Copy the exact UUID/);
    assert.match(feedback, /8-4-4-4-12/);
    assert.doesNotMatch(feedback, /PRIVATE|12345678/);
  }
});

test('index correction explains directional refinements without forwarding arbitrary custom text', () => {
  const result = gmIndexEntryValueSchema.safeParse({
    kind: 'gm_plan',
    status: 'active',
    title: 'Synthetic',
    text: 'Synthetic',
    ownerCharacterId: null,
    refs: [],
    direction: {
      basis: 'creative',
      trigger: null,
      development: 'Synthetic',
      choices: [],
      rationale: 'Synthetic',
    },
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const feedback = structuredResponseRetryFeedback(result.error)!;
    assert.match(feedback, /gm_plan, direction must be null/);
    assert.match(feedback, /pressure and opportunity/);
  }
  const privateError = z
    .string()
    .refine(() => false, 'PRIVATE_VALUE')
    .safeParse('input');
  if (!privateError.success)
    assert.doesNotMatch(structuredResponseRetryFeedback(privateError.error)!, /PRIVATE_VALUE/);
});

test('generic provider failures can retry but quota, login and isolation cannot', () => {
  assert.ok(structuredResponseRetryFeedback(new Problem(502, 'provider_failure', 'Synthetic')));
  for (const code of ['provider_quota', 'provider_auth', 'dice_isolation', 'cancelled'])
    assert.equal(structuredResponseRetryFeedback(new Problem(503, code, 'Synthetic')), null);
});

test('malformed JSON and invalid response schema retry with feedback and prepare replay', async () => {
  const attempts: number[] = [];
  let prepared = 0;
  const result = await withResponseRetries(
    async (attempt, feedback) => {
      attempts.push(attempt);
      if (attempt === 0) return JSON.parse('malformed');
      assert.match(feedback, /previous response was rejected/);
      assert.match(feedback, /Omit offsets and page metadata; the application computes them/);
      assert.doesNotMatch(feedback, /start \+ quote\.length/);
      if (attempt === 1) z.object({ narrative: z.string() }).parse({ narrative: 42 });
      assert.match(feedback, /narrative/);
      return 'complete';
    },
    async () => {
      prepared++;
    }
  );
  assert.equal(result, 'complete');
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.equal(prepared, 2);
});
test('invalid citation and mutation responses retry but exhaustion preserves the final failure', async () => {
  let calls = 0;
  await assert.rejects(
    withResponseRetries(
      async () => {
        calls++;
        throw new Problem(502, 'rules_citations_invalid', 'Wrong quote offsets');
      },
      async () => {}
    ),
    /Wrong quote offsets/
  );
  assert.equal(calls, 3);
});
test('cancellation, changed context and forbidden tools never trigger automatic retries', async () => {
  for (const code of ['cancelled', 'rules_context_changed', 'dice_isolation', 'conflict']) {
    let prepared = 0;
    await assert.rejects(
      withResponseRetries(
        async () => {
          throw new Problem(409, code, code);
        },
        async () => {
          prepared++;
        }
      ),
      new RegExp(code)
    );
    assert.equal(prepared, 0);
  }
  const ctl = new AbortController();
  let calls = 0;
  await assert.rejects(
    withResponseRetries(
      async () => {
        calls++;
        ctl.abort();
        throw new SyntaxError('Invalid JSON');
      },
      async () => {
        throw new Error('Must not prepare');
      },
      ctl.signal
    ),
    /Invalid JSON/
  );
  assert.equal(calls, 1);
});

test('unavailable MCP requests retry with owned-tool feedback without granting access', async () => {
  let calls = 0;
  let prepared = 0;
  const result = await withResponseRetries(
    async (_attempt, feedback) => {
      calls++;
      if (calls === 1)
        throw new Problem(
          502,
          'gameplay_tool_unavailable',
          'Use only server local_rpg with tools: roll_dice'
        );
      assert.match(feedback, /Use only server local_rpg/);
      assert.match(feedback, /All saved dice are authoritative/);
      return 'recovered';
    },
    async () => {
      prepared++;
    }
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
  assert.equal(prepared, 1);
});
