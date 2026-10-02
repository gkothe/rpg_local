import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { withResponseRetries } from '../src/domain/responseRetry.js';
import { Problem } from '../src/errors.js';

test('malformed JSON and invalid response schema retry with feedback and prepare replay', async () => {
  const attempts: number[] = [];
  let prepared = 0;
  const result = await withResponseRetries(
    async (attempt, feedback) => {
      attempts.push(attempt);
      if (attempt === 0) return JSON.parse('malformed');
      assert.match(feedback, /previous response was rejected/);
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
