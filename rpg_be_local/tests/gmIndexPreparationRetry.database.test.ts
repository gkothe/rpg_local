import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';
import { RESPONSE_RETRY_COUNT } from '../src/domain/responseRetry.js';
import { MemoryRebuildPurpose, MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('gm_index_retry');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

async function seed(sources = false) {
  const { campaign } = await seedCampaign(isolated.store, []);
  if (sources) {
    campaign.sources = ['First original', 'Second original'].map((text) => ({
      id: randomUUID(),
      name: text,
      kind: SourceKind.Text,
      status: SourceStatus.Confirmed,
      version: 1,
      text,
      pages: [],
      warnings: [],
    }));
    await isolated.store.transaction((client) => isolated.store.save(campaign, client));
  }
  return campaign;
}

function generator(
  respond: (
    input: Record<string, unknown>,
    tools: GameplayToolDispatch
  ) => unknown | Promise<unknown>
): Generator {
  return {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: async () => {
      throw new Error('Zero-turn index must not summarize history');
    },
    generateOwnedGameplay: async (_settings, prompt, _schema, _system, tools) =>
      respond(JSON.parse(prompt), tools),
  };
}

async function settle(service: MemoryRebuildService, campaignId: string, id: string) {
  for (let i = 0; i < 500; i++) {
    const job = await service.status(campaignId, id);
    if (!job.active) return job;
    await sleep(10);
  }
  throw new Error('Synthetic validation retry did not finish');
}

test(
  'malformed source scan retries its unchanged JSON batch with fresh tools and never repeats completed scans',
  { skip: !dbEnabled },
  async () => {
    const c = await seed(true);
    const observed: { stage: unknown; batch: unknown; feedback: unknown }[] = [];
    const readers: GameplayToolDispatch[] = [];
    let badScan = 0;
    const service = new MemoryRebuildService(
      isolated.store,
      generator((input, tools) => {
        const batch = input.batch as { kind?: string; sourceId?: string } | undefined;
        observed.push({ stage: input.stage, batch, feedback: input.validationFeedback });
        if (batch?.sourceId === c.sources[0]!.id) {
          readers.push(tools);
          if (++badScan === 1)
            throw new Problem(502, 'provider_json', 'Synthetic malformed provider JSON');
          if (badScan === 2) throw new SyntaxError('Synthetic invalid JSON syntax');
        }
        return { foundation: [], entries: [] };
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, c.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(badScan, RESPONSE_RETRY_COUNT + 1);
    assert.equal(
      observed.filter((row) => (row.batch as { kind?: string })?.kind === 'canonical').length,
      1
    );
    assert.equal(
      observed.filter((row) => (row.batch as { sourceId?: string })?.sourceId === c.sources[1]!.id)
        .length,
      1
    );
    const retryInputs = observed.filter(
      (row) => (row.batch as { sourceId?: string })?.sourceId === c.sources[0]!.id
    );
    assert.deepEqual(
      retryInputs.map((row) => row.batch),
      [retryInputs[0]!.batch, retryInputs[0]!.batch, retryInputs[0]!.batch]
    );
    assert.equal(retryInputs[0]!.feedback, undefined);
    assert.ok(retryInputs[1]!.feedback);
    assert.ok(retryInputs[2]!.feedback);
    assert.notEqual(readers[0], readers[1]);
    assert.notEqual(readers[1], readers[2]);
    assert.equal((await isolated.store.campaign(c.id)).gmIndex, undefined);
  }
);

test(
  'three invalid scan outputs exhaust validation retries without advancing the checkpoint',
  { skip: !dbEnabled },
  async () => {
    const c = await seed();
    let calls = 0;
    const service = new MemoryRebuildService(
      isolated.store,
      generator(() => {
        calls++;
        return { foundation: 'not-an-array' };
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const failed = await settle(service, c.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(calls, RESPONSE_RETRY_COUNT + 1);
    assert.equal(failed.processedTurns, 0);
    assert.equal(failed.candidate, null);
    assert.equal((await isolated.store.campaign(c.id)).gmIndex, undefined);
  }
);

test(
  'quota, login and ownership failures stop preparation without automatic retries',
  { skip: !dbEnabled },
  async () => {
    for (const error of [
      new Problem(429, 'provider_quota', 'Synthetic quota'),
      new Problem(503, 'provider_auth', 'Synthetic login failure'),
      new Problem(409, 'gm_index_inactive', 'Synthetic ownership loss'),
    ]) {
      const c = await seed();
      let calls = 0;
      const service = new MemoryRebuildService(
        isolated.store,
        generator(() => {
          calls++;
          throw error;
        })
      );
      const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
      const failed = await settle(service, c.id, started.id);
      assert.equal(failed.status, MemoryRebuildStatus.Failed);
      assert.equal(calls, 1);
      assert.equal(failed.processedTurns, 0);
    }
  }
);

test(
  'generic provider failure retries only the current source scan and preserves earlier scans',
  { skip: !dbEnabled },
  async () => {
    const c = await seed(true);
    const observed: Record<string, unknown>[] = [];
    let sourceAttempts = 0;
    const service = new MemoryRebuildService(
      isolated.store,
      generator((input) => {
        observed.push(input);
        const batch = input.batch as { sourceId?: string } | undefined;
        if (batch?.sourceId === c.sources[1]!.id) {
          sourceAttempts++;
          if (sourceAttempts === 1)
            throw new Problem(502, 'provider_failure', 'Synthetic temporary failure');
          assert.match(String(input.validationFeedback), /CLI failed/);
        }
        return { foundation: [], entries: [] };
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, c.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready);
    assert.equal(sourceAttempts, 2);
    assert.equal(
      observed.filter((input) => (input.batch as { kind?: string })?.kind === 'canonical').length,
      1
    );
    assert.equal(
      observed.filter(
        (input) => (input.batch as { sourceId?: string })?.sourceId === c.sources[0]!.id
      ).length,
      1
    );
  }
);

test(
  'persistent provider failure exhausts bounded retries without advancing the checkpoint',
  { skip: !dbEnabled },
  async () => {
    const c = await seed();
    let calls = 0;
    const service = new MemoryRebuildService(
      isolated.store,
      generator(() => {
        calls++;
        throw new Problem(502, 'provider_failure', 'Synthetic temporary failure');
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const failed = await settle(service, c.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(failed.processedTurns, 0);
    assert.equal(calls, RESPONSE_RETRY_COUNT + 1);
  }
);

test(
  'synthesis retries an invalid canonical reference inside final document validation',
  { skip: !dbEnabled },
  async () => {
    const c = await seed();
    let scanCalls = 0;
    const synthesis: Record<string, unknown>[] = [];
    const service = new MemoryRebuildService(
      isolated.store,
      generator((input) => {
        if (input.stage === 'scan') {
          scanCalls++;
          return { foundation: [], entries: [] };
        }
        synthesis.push(input);
        return synthesis.length === 1
          ? {
              foundation: [],
              entries: [
                {
                  kind: 'clue',
                  status: 'active',
                  title: 'Invalid reference',
                  text: 'A tentative clue.',
                  ownerCharacterId: null,
                  refs: [{ kind: 'knowledge', id: randomUUID() }],
                  direction: null,
                },
              ],
            }
          : { foundation: [], entries: [] };
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, c.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(scanCalls, 1);
    assert.equal(synthesis.length, 2);
    assert.ok(synthesis[1]!.validationFeedback);
    assert.deepEqual(synthesis[1]!.scannedFoundation, synthesis[0]!.scannedFoundation);
  }
);

test(
  'compact history schema failures retry only that summary step after successful index synthesis',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(
      isolated.store,
      Array.from({ length: 13 }, (_, i) => ({
        action: `Action ${i}`,
        narrative: `Saved harbor scene ${i}.`,
      }))
    );
    let ownedCalls = 0;
    const ordinary: Record<string, unknown>[] = [];
    let firstSummary = true;
    const ai = generator(() => {
      ownedCalls++;
      return { foundation: [], entries: [] };
    });
    ai.generate = async (_settings, prompt, schema) => {
      const input = JSON.parse(prompt);
      ordinary.push(input);
      if (firstSummary) {
        firstSummary = false;
        return { title: 'Missing required text' };
      }
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      return 'title' in properties
        ? { title: 'Harbor summary', text: 'Saved harbor history.' }
        : { text: 'Harbor overview.' };
    };
    const service = new MemoryRebuildService(isolated.store, ai);
    const started = await service.start(campaign.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(ownedCalls, 4);
    assert.ok(ordinary[1]!.validationFeedback);
    const retry = { ...ordinary[1]! };
    delete retry.validationFeedback;
    assert.deepEqual(retry, ordinary[0]);
    assert.equal(ordinary.length, 4);
  }
);

test(
  'merge automatically corrects MCP routing and argument errors without repeating scans or widening tools',
  { skip: !dbEnabled },
  async () => {
    const c = await seed();
    let scans = 0;
    const merges: Record<string, unknown>[] = [];
    const service = new MemoryRebuildService(
      isolated.store,
      generator((input, tools) => {
        assert.equal(tools.definitions?.length, 6);
        assert.ok(!tools.definitions?.some((tool) => tool.name === 'roll_dice'));
        if (input.stage === 'scan') {
          scans++;
          return { foundation: [], entries: [] };
        }
        merges.push(input);
        if (merges.length === 1)
          throw new Problem(
            502,
            'gameplay_tool_unavailable',
            'Use call_mcp_tool with ServerName="local_rpg" and the registered ToolName.'
          );
        if (merges.length === 2) {
          assert.match(String(input.validationFeedback), /ServerName/);
          throw new Problem(
            422,
            'gameplay_tool_arguments',
            'Arguments must match the registered schema.'
          );
        }
        assert.match(String(input.validationFeedback), /Arguments must match/);
        return { foundation: [], entries: [] };
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, c.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(scans, 1);
    assert.equal(merges.length, 3);
  }
);

test(
  'a real tool isolation violation stops immediately without retry',
  { skip: !dbEnabled },
  async () => {
    const c = await seed();
    let calls = 0;
    const service = new MemoryRebuildService(
      isolated.store,
      generator(() => {
        calls++;
        throw new Problem(502, 'dice_isolation', 'Tool outside owned MCP boundary');
      })
    );
    const started = await service.start(c.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const failed = await settle(service, c.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(failed.errorCode, 'dice_isolation');
    assert.equal(calls, 1);
  }
);
