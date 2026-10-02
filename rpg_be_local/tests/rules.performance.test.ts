import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { RuleStore } from '../src/services/ruleStore.js';
import { RuleLookup } from '../src/services/ruleLookup.js';
import { generateRuleMapping } from '../src/domain/ruleMapping.js';
import {
  RULE_LIMITS,
  RuleReview,
  emptyRuleColumns,
  canonicalRuleJson,
  type RuleContent,
  type RuleNode,
} from '../src/domain/rules.js';
export function originalPerformanceContent(count: number, maximum = false): RuleContent {
  const content: RuleContent = {
    ...emptyRuleColumns(),
    instructions: 'Original benchmark instructions',
    sources: [
      { slug: 'original', title: 'Original synthetic benchmark', pageCount: 2000, pdfHash: null },
    ],
    mapping: {},
  };
  const root: RuleNode = {
    name: 'Original root',
    aliases: [],
    source: 'original',
    text: '',
    structural: true,
    review: RuleReview.Extracted,
    pdfPages: [],
    printedPages: [],
    children: {},
  };
  content.core_rules.original = root;
  for (let index = 0; index < count; index++)
    root.children[`node_${index}`] = {
      name: `Original ${index}`,
      aliases: [],
      source: 'original',
      text:
        `Original unique_${String(index).padStart(5, '0')} passage 🐉. ` +
        'Original synthetic text. '.repeat(maximum ? 50 : 4),
      review: RuleReview.Extracted,
      pdfPages: [(index % 2000) + 1],
      printedPages: [],
      children: {},
    };
  content.mapping = generateRuleMapping(content).mapping;
  if (maximum) {
    let remaining = RULE_LIMITS.systemBytes - Buffer.byteLength(canonicalRuleJson(content));
    assert.ok(remaining >= 0);
    for (const node of Object.values(root.children)) {
      const add = Math.min(remaining, RULE_LIMITS.textBytes - Buffer.byteLength(node.text));
      node.text += 'x'.repeat(add);
      remaining -= add;
      if (!remaining) break;
    }
    assert.equal(remaining, 0);
    assert.equal(Buffer.byteLength(canonicalRuleJson(content)), RULE_LIMITS.systemBytes);
  }
  return content;
}
test('original maximum-node mapping remains compact and never enumerates source text', () => {
  const content = originalPerformanceContent(10000);
  const generated = generateRuleMapping(content);
  assert.ok(Buffer.byteLength(JSON.stringify(generated.mapping)) < RULE_LIMITS.mappingBytes);
  assert.ok(Buffer.byteLength(generated.overview) <= RULE_LIMITS.overviewBytes);
  assert.equal(generated.overview.includes('unique_'), false);
});
const enabled =
  process.env.NODE_ENV === 'test' &&
  !!process.env.RPG_TEST_DATABASE_URL &&
  process.env.RPG_RULES_BENCHMARK === '1';
test(
  'Windows isolated 596-node and 10000-node/20-MiB cold/warm lookup benchmark: 30 sequential queries each',
  { skip: !enabled, timeout: 180000 },
  async () => {
    assert.equal(process.platform, 'win32');
    const schema = `rules_benchmark_${randomUUID().replaceAll('-', '')}`;
    const bootstrap = new Store();
    await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
    await bootstrap.close();
    const url = new URL(databaseUrl());
    url.searchParams.set('options', `-c search_path=${schema}`);
    const store = new Store(url.toString());
    try {
      for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
        .filter((file) => file.endsWith('.sql'))
        .sort())
        await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
      const rules = new RuleStore(store);
      for (const count of [596, 10000]) {
        const content = originalPerformanceContent(count, count === 10000);
        const system = await rules.create(`benchmark-${count}`, `Original ${count} nodes`);
        await rules.publish(system.systemId, 1, () => content);
        const cached = await rules.get(system.systemId);
        const lookup = new RuleLookup();
        const warm: number[] = [];
        const cold: number[] = [];
        const guardedCached: number[] = [];
        for (let index = 0; index < 30; index++) {
          const query = { query: `unique_${String(index).padStart(5, '0')} passage` };
          let started = performance.now();
          const warmResult = lookup.execute(cached, 'rules_search', query, 'benchmark');
          warm.push(performance.now() - started);
          assert.equal((warmResult.entries as unknown[]).length, 1);
          started = performance.now();
          const loaded = await rules.get(system.systemId);
          lookup.execute(loaded, 'rules_search', query, 'benchmark');
          cold.push(performance.now() - started);
        }
        const head = await rules.get(system.systemId);
        const context = {
          systemId: head.systemId,
          systemKey: head.systemKey,
          systemName: head.systemName,
          revision: head.revision,
          contentHash: head.contentHash,
          kind: head.kind,
        };
        for (let index = 0; index < 34; index++) {
          const started = performance.now();
          await store.transaction(async (client) => {
            const current = await new RuleStore(store).guard(context, client);
            const result = new RuleLookup().execute(
              current,
              'rules_search',
              { query: `unique_${String(index % 4).padStart(5, '0')} passage` },
              `fresh-${index}`
            );
            assert.equal(result.receipt, `fresh-${index}`);
            assert.equal((result.entries as unknown[]).length, 1);
          });
          if (index >= 4) guardedCached.push(performance.now() - started);
        }
        const percentile = (values: number[]) =>
          values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
        const warmP95 = percentile(warm),
          coldP95 = percentile(cold);
        console.log(
          JSON.stringify({
            count,
            canonicalBytes: Buffer.byteLength(canonicalRuleJson(content)),
            queries: 30,
            warmP95Ms: warmP95,
            coldP95Ms: coldP95,
            guardedCachedRepeatP95Ms: percentile(guardedCached),
          })
        );
        assert.ok(warmP95 < 500, `Warm p95 ${warmP95}ms`);
        assert.ok(coldP95 < 2000, `Cold p95 ${coldP95}ms`);
      }
    } finally {
      await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await store.close();
    }
  }
);
