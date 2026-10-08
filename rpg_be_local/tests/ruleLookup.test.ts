import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RuleLookup, ruleNodeAt } from '../src/services/ruleLookup.js';
import {
  emptyRuleColumns,
  RuleReview,
  RuleSystemKind,
  serializedBytes,
  RULE_LIMITS,
  type RuleSystem,
  RULE_COLUMNS,
} from '../src/domain/rules.js';
import { generateRuleMapping } from '../src/domain/ruleMapping.js';
import { findRules } from '../src/providers/rulesFind.js';
function fixture(): RuleSystem {
  const system: RuleSystem = {
    ...emptyRuleColumns(),
    instructions: '',
    sources: [],
    mapping: {},
    systemId: randomUUID(),
    systemKey: 'synthetic',
    systemName: 'Synthetic',
    revision: 1,
    kind: RuleSystemKind.Library,
    contentHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const child = {
    name: 'Deep rule',
    aliases: ['Deep test'],
    source: 'example',
    review: RuleReview.Extracted,
    pdfPages: [1, 2],
    printedPages: ['3-4'],
    children: {},
    text: '🐉'.repeat(60000) + ' needle original rule',
    pageSpans: [
      { start: 0, end: 120000, pdfPage: 1, printedPage: '3' },
      { start: 120000, end: 120021, pdfPage: 2, printedPage: '4' },
    ],
  };
  system.core_rules.example = {
    ...child,
    name: 'Book',
    text: '',
    children: { deep: child },
    pageSpans: [],
    pdfPages: [],
    printedPages: [],
  };
  return system;
}

test('public lookup and combined reads prefer query coverage and preserve paging and filters', async () => {
  const system = fixture();
  const template = ruleNodeAt(system, 'core_rules.example.deep');
  const root = system.core_rules.example!;
  root.children = {
    full: {
      ...template,
      name: 'Recovery',
      text: 'Mending damage uses a rouse check for superficial wounds.',
      pageSpans: [],
    },
    incidental: {
      ...template,
      name: 'Check In',
      text: 'A conversation about comfort.',
      pageSpans: [],
    },
    ...Object.fromEntries(
      Array.from({ length: RULE_LIMITS.searchHits + 1 }, (_, index) => [
        `partial_${index}`,
        { ...template, name: 'Other', text: 'Superficial wounds.', pageSpans: [] },
      ])
    ),
  };
  const query = 'mending damage rouse check superficial';
  const lookup = new RuleLookup();
  const first = lookup.execute(system, 'rules_search', { query }, randomUUID());
  const entries = first.entries as { path: string }[];
  assert.equal(entries[0]!.path, 'core_rules.example.full');
  assert.equal(entries[1]!.path, 'core_rules.example.incidental');
  assert.equal(first.complete, false);
  const second = lookup.execute(
    system,
    'rules_search',
    { query, cursor: first.cursor },
    randomUUID()
  );
  assert.ok(
    (second.entries as { path: string }[]).every(
      (entry) => !entries.some((old) => old.path === entry.path)
    )
  );
  assert.deepEqual(
    lookup.execute(system, 'rules_search', { query, columns: ['gm_guidance'] }, randomUUID())
      .entries,
    []
  );
  assert.deepEqual(
    lookup.execute(system, 'rules_search', { query, source: 'other' }, randomUUID()).entries,
    []
  );
  const found = await findRules(
    async (tool, input, id) => lookup.execute(system, tool, input, id),
    { query },
    'combined',
    async () => {}
  );
  assert.deepEqual(
    found.reads.map((read) => read.path),
    entries.slice(0, 3).map((entry) => entry.path)
  );
});

test('invalid slash paths direct the caller to copy exact tool-returned dotted paths', () => {
  assert.throws(
    () => ruleNodeAt(fixture(), 'core_rules/combat/damage_and_healing'),
    /Copy the exact dotted path returned by rules_find/
  );
});

test('dense search snippets retain a wide cluster and locators preserve original Unicode and pages', () => {
  const system = fixture();
  const node = ruleNodeAt(system, 'core_rules.example.deep');
  node.text =
    'İ'.repeat(400) +
    ' alpha ' +
    'padding '.repeat(40) +
    '🐉 alpha ' +
    'x'.repeat(100) +
    ' beta gamma';
  const cluster = node.text.lastIndexOf('alpha');
  node.pageSpans = [
    { start: 0, end: cluster, pdfPage: 1, printedPage: '1' },
    { start: cluster, end: node.text.length, pdfPage: 2, printedPage: '2' },
  ];
  const lookup = new RuleLookup();
  const result = lookup.execute(
    system,
    'rules_search',
    { query: 'alpha beta gamma' },
    randomUUID()
  );
  const hit = (result.entries as { path: string; snippet: string; locator: string }[])[0]!;
  assert.match(hit.snippet, /alpha/);
  assert.match(hit.snippet, /beta gamma/);
  const read = lookup.execute(
    system,
    'rules_get',
    { path: hit.path, locator: hit.locator },
    randomUUID()
  );
  assert.equal(read.text, node.text.slice(read.start as number, read.end as number));
  assert.ok((read.start as number) > 400);
  assert.match(read.text as string, /beta gamma/);
  assert.ok((read.pages as { pdfPages: number[] }).pdfPages.includes(2));
});

test('book search matches relevant title/text terms without requiring every query word', () => {
  const system = fixture();
  const node = ruleNodeAt(system, 'core_rules.example.deep');
  node.name = 'Maneuver';
  node.text = 'Movement lets a combatant change position. Resolve contests and ties here.';
  delete node.pageSpans;
  const lookup = new RuleLookup();
  for (const query of ['movement positioning maneuver', 'contest tie', 'find the maneuver rules']) {
    const result = lookup.execute(system, 'rules_search', { query }, randomUUID());
    const hit = (result.entries as Record<string, unknown>[])[0]!;
    assert.equal(hit.path, 'core_rules.example.deep');
    assert.equal(hit.readableOriginal, true);
    assert.equal(hit.derived, false);
  }
  assert.deepEqual(
    lookup.execute(system, 'rules_search', { query: 'move' }, randomUUID()).entries,
    []
  );
  assert.deepEqual(
    lookup.execute(system, 'rules_search', { query: 'movement', source: 'other' }, randomUUID())
      .entries,
    []
  );
});

test('exact aliases lead partial matches and summaries remain navigation even with readable originals', () => {
  const system = fixture();
  const node = ruleNodeAt(system, 'core_rules.example.deep');
  node.aliases = ['weapon damage chart'];
  node.summary = 'Animal hyena guide';
  const lookup = new RuleLookup();
  const exact = (
    lookup.execute(system, 'rules_search', { query: 'weapon damage chart' }, randomUUID())
      .entries as Record<string, unknown>[]
  )[0]!;
  assert.equal(exact.exactTitle, true);
  const summary = (
    lookup.execute(system, 'rules_search', { query: 'dog wolf animal hyena' }, randomUUID())
      .entries as Record<string, unknown>[]
  )[0]!;
  assert.equal(summary.derived, true);
  assert.equal(summary.readableOriginal, true);
  assert.equal(summary.locator, null);
  assert.deepEqual(summary.matchedTerms, ['animal', 'hyena']);
});

test('case-folding expansion preserves original UTF-16 locator offsets and numeric filters reject string comparisons', () => {
  const system = fixture();
  const node = ruleNodeAt(system, 'core_rules.example.deep');
  node.text = 'İ'.repeat(1200) + ' Original needle authority';
  delete node.pageSpans;
  const lookup = new RuleLookup();
  const hits = lookup.execute(system, 'rules_search', { query: 'needle' }, randomUUID());
  const hit = (hits.entries as Record<string, unknown>[])[0]!;
  const result = lookup.execute(
    system,
    'rules_get',
    { path: hit.path, locator: hit.locator },
    randomUUID(),
    600
  );
  assert.match(result.text as string, /needle authority/);
  assert.equal(
    result.text as string,
    node.text.slice(result.start as number, result.end as number)
  );
  assert.throws(() =>
    lookup.execute(
      system,
      'rules_list',
      { path: 'core_rules.example', filter: { field: 'difficulty', op: 'gte', value: '4' } },
      randomUUID()
    )
  );
});

test('detailed map paginates individual column descriptors with complete bounded continuation', () => {
  const system = fixture();
  for (const column of RULE_COLUMNS) {
    system[column].example = {
      ...ruleNodeAt(system, 'core_rules.example'),
      children: {},
      fields: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`field_${index}`, index])
      ),
    };
  }
  system.mapping = generateRuleMapping(system).mapping;
  const lookup = new RuleLookup();
  const columns = new Set<string>();
  let cursor: unknown = undefined;
  let pages = 0;
  do {
    const page = lookup.execute(system, 'rules_map', cursor ? { cursor } : {}, randomUUID(), 1000);
    assert.ok(serializedBytes(page) <= 1000);
    for (const entry of page.entries as { key: string; value: { column: string } }[]) {
      if (entry.key !== 'column') continue;
      assert.equal(columns.has(entry.value.column), false);
      columns.add(entry.value.column);
    }
    cursor = page.cursor;
    pages++;
    assert.ok(pages <= RULE_COLUMNS.length + 2);
  } while (cursor);
  assert.equal(columns.size, RULE_COLUMNS.length);
  assert.ok(pages > 1);
});
test('search locators reach deep original text; text results preserve Unicode boundaries and exact pages', () => {
  const system = fixture();
  const lookup = new RuleLookup();
  const search = lookup.execute(system, 'rules_search', { query: 'needle' }, randomUUID());
  const hit = (search.entries as Record<string, unknown>[])[0]!;
  assert.equal(hit.path, 'core_rules.example.deep');
  assert.ok((hit.locator as string).length <= RULE_LIMITS.tokenChars);
  const result = lookup.execute(
    system,
    'rules_get',
    { path: hit.path, locator: hit.locator },
    randomUUID()
  );
  assert.match(result.text as string, /needle original rule/);
  assert.ok(serializedBytes(result) <= RULE_LIMITS.resultBytes);
  assert.ok((result.start as number) > 119000);
  assert.equal(/^[\uDC00-\uDFFF]/.test(result.text as string), false);
  const exact = lookup.execute(system, 'rules_get', { path: hit.path }, randomUUID(), 1000);
  assert.equal((exact.pages as { precision: string }).precision, 'exact');
  assert.equal(exact.complete, false);
  assert.equal(exact.omitted, true);
  assert.ok(exact.cursor);
});
test('cursor accepts revision changes and rejects another path, invalid/restarted tokens and exhausted budgets', () => {
  const system = fixture();
  const lookup = new RuleLookup();
  const first = lookup.execute(
    system,
    'rules_get',
    { path: 'core_rules.example.deep' },
    randomUUID(),
    1000
  );
  const next = lookup.execute(
    system,
    'rules_get',
    { path: 'core_rules.example.deep', cursor: first.cursor },
    randomUUID(),
    1000
  );
  assert.equal(next.start, first.end);
  assert.equal(
    lookup.execute(
      { ...system, revision: 2 },
      'rules_get',
      { path: 'core_rules.example.deep', cursor: first.cursor },
      randomUUID()
    ).start,
    first.end
  );
  assert.throws(
    () =>
      lookup.execute(
        system,
        'rules_get',
        { path: 'core_rules.example', cursor: first.cursor },
        randomUUID()
      ),
    /does not match/
  );
  assert.throws(
    () =>
      new RuleLookup().execute(
        system,
        'rules_get',
        { path: 'core_rules.example.deep', cursor: first.cursor },
        randomUUID()
      ),
    /expired/
  );
  assert.throws(
    () =>
      lookup.execute(system, 'rules_get', { path: 'core_rules.example.deep' }, randomUUID(), 50),
    /budget/
  );
});
test('paths use own properties, derived summary matches cannot supply original locators and requests are strict', () => {
  const system = fixture();
  const lookup = new RuleLookup();
  const child = ruleNodeAt(system, 'core_rules.example.deep');
  child.summary = 'navigationonly';
  const search = lookup.execute(system, 'rules_search', { query: 'navigationonly' }, randomUUID());
  const hit = (search.entries as Record<string, unknown>[])[0]!;
  assert.equal(hit.derived, true);
  assert.equal(hit.locator, null);
  assert.throws(() => ruleNodeAt(system, 'core_rules.constructor'), /Invalid content/);
  assert.throws(() =>
    lookup.execute(
      system,
      'rules_get',
      { path: 'core_rules.example.deep', system: 'another' },
      randomUUID()
    )
  );
  assert.throws(
    () => lookup.execute(system, 'rules_search', { query: 'x'.repeat(2000) }, randomUUID()),
    /byte limit/
  );
});
