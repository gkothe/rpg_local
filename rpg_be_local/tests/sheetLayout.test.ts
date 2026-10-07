import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sheetLayoutSchema,
  sheetLayoutRequestSchema,
  SHEET_SECTIONS,
  SHEET_LAYOUT_LIMITS,
  SHEET_WIDGET_OPTIONS,
  SheetWidget,
} from '../src/domain/sheetLayout.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appRoot } from '../src/config.js';
import { CHARACTER_MUTABLE_FIELDS, CHARACTER_FIELD } from '../src/domain/options.js';

const field = (extra: Record<string, unknown>) => ({
  path: ['attributes', 'x'],
  widget: 'number',
  ...extra,
});
const ok = (fields: unknown[]) => sheetLayoutSchema.safeParse({ fields });
const issuePaths = (fields: unknown[]) =>
  ok(fields).error?.issues.map((issue) => issue.path.join('.')) ?? [];

test('sections are the free-form character sections', () => {
  assert.deepEqual(
    [...SHEET_SECTIONS],
    CHARACTER_MUTABLE_FIELDS.filter((name) => name !== CHARACTER_FIELD.Name)
  );
});

test('every widget id is advertised once', () => {
  assert.deepEqual(
    SHEET_WIDGET_OPTIONS.map((option) => option.id).sort(),
    Object.values(SheetWidget).sort()
  );
});

test('accepts representative layouts', () => {
  assert.ok(
    ok([
      { path: ['attributes', 'skills'], widget: 'dots', max: 5, label: 'Skills', order: 1 },
      {
        path: ['attributes', 'hp', 'current'],
        widget: 'track',
        maxPath: ['attributes', 'hp', 'max'],
      },
      { path: ['attributes', 'str'], widget: 'score', modifierPath: ['attributes', 'strMod'] },
      { path: ['attributes', 'stress'], widget: 'checks', max: 20 },
      { path: ['attributes', 'luck'], widget: 'track', max: 1000 },
      { path: ['inventory', 'items'], widget: 'items' },
      { path: ['description', 'bio'], widget: 'prose' },
      { path: ['attributes', 'skills', 'brawl'], widget: 'dots', max: 3 },
    ]).success
  );
});

test('dots and checks need a bounded integer max', () => {
  assert.deepEqual(issuePaths([field({ widget: 'dots' })]), ['fields.0.max']);
  assert.deepEqual(issuePaths([field({ widget: 'dots', max: 11 })]), ['fields.0.max']);
  assert.deepEqual(issuePaths([field({ widget: 'dots', max: 2.5 })]), ['fields.0.max']);
  assert.deepEqual(issuePaths([field({ widget: 'checks', max: 21 })]), ['fields.0.max']);
  assert.deepEqual(issuePaths([field({ widget: 'checks', max: 0 })]), ['fields.0.max']);
});

test('track takes exactly one of max or maxPath', () => {
  assert.equal(ok([field({ widget: 'track' })]).success, false);
  assert.equal(
    ok([field({ widget: 'track', max: 5, maxPath: ['attributes', 'm'] })]).success,
    false
  );
  assert.equal(ok([field({ widget: 'track', max: 1001 })]).success, false);
  assert.equal(ok([field({ widget: 'track', max: 1000 })]).success, true);
});

test('other widgets reject parameters', () => {
  for (const widget of ['number', 'tags', 'items', 'prose', 'facts', 'hidden', 'percentile']) {
    assert.equal(ok([field({ widget, max: 5 })]).success, false, widget);
    assert.equal(ok([field({ widget, maxPath: ['attributes', 'm'] })]).success, false, widget);
    assert.equal(ok([field({ widget, modifierPath: ['attributes', 'm'] })]).success, false, widget);
  }
  assert.equal(ok([field({ widget: 'score', max: 5 })]).success, false);
  assert.equal(ok([field({ widget: 'score' })]).success, true);
});

test('paths must start in a free-form section and avoid reserved segments', () => {
  assert.equal(ok([field({ path: ['name'] })]).success, false);
  assert.equal(ok([field({ path: ['skills'] })]).success, false);
  assert.equal(ok([field({ path: ['attributes', '__proto__'] })]).success, false);
  assert.equal(ok([field({ path: [] })]).success, false);
  assert.equal(ok([field({ widget: 'track', maxPath: ['elsewhere', 'max'] })]).success, false);
  assert.equal(
    ok([
      field({ path: Array.from({ length: 17 }, () => 'a').map((a, i) => (i ? a : 'attributes')) }),
    ]).success,
    false
  );
});

test('label and order bounds', () => {
  assert.equal(ok([field({ label: '' })]).success, false);
  assert.equal(ok([field({ label: '   ' })]).success, false);
  assert.equal(ok([field({ label: 'x'.repeat(81) })]).success, false);
  assert.equal(ok([field({ label: 'x'.repeat(80) })]).success, true);
  assert.equal(ok([field({ order: -1 })]).success, false);
  assert.equal(ok([field({ order: 1000 })]).success, false);
  assert.equal(ok([field({ order: 1.5 })]).success, false);
  assert.equal(ok([field({ order: 999 })]).success, true);
});

test('field count, byte size, duplicates and unknown keys', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => field({ path: ['attributes', `f${index}`] }));
  assert.equal(ok(many(SHEET_LAYOUT_LIMITS.fields)).success, true);
  assert.equal(ok(many(SHEET_LAYOUT_LIMITS.fields + 1)).success, false);
  const wide = Array.from({ length: SHEET_LAYOUT_LIMITS.fields }, (_, index) =>
    field({
      path: [
        'attributes',
        ...Array.from({ length: 15 }, (_, depth) => `${depth}`.padEnd(30, 's')),
        `${index}`,
      ],
    })
  );
  const bytes = sheetLayoutSchema.safeParse({ fields: wide });
  assert.equal(bytes.success, false);
  assert.match(bytes.error!.issues.map((issue) => issue.message).join(), /exceeds 32768 bytes/);
  assert.equal(ok([field({}), field({})]).success, false);
  assert.equal(
    ok([field({ path: ['attributes', 'a'] }), field({ path: ['attributes', 'a', 'b'] })]).success,
    true
  );
  assert.equal(sheetLayoutSchema.safeParse({ fields: [], extra: 1 }).success, false);
  assert.equal(ok([field({ extra: 1 })]).success, false);
});

test('request body is strict and needs a uuid', () => {
  const requestId = '0b6a3f0e-8f6b-4c1d-9c1d-0d1f7f2a6b11';
  assert.equal(
    sheetLayoutRequestSchema.safeParse({ requestId, sheetLayout: { fields: [] } }).success,
    true
  );
  assert.equal(
    sheetLayoutRequestSchema.safeParse({ requestId: 'x', sheetLayout: { fields: [] } }).success,
    false
  );
  assert.equal(
    sheetLayoutRequestSchema.safeParse({ requestId, sheetLayout: { fields: [] }, extra: 1 })
      .success,
    false
  );
});

test('every json example in the layout guide is valid', () => {
  const guide = readFileSync(
    path.join(appRoot, '..', 'docs', 'documentation', 'sheet-layouts.md'),
    'utf8'
  );
  const blocks = [...guide.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((match) =>
    JSON.parse(match[1]!)
  );
  assert.ok(blocks.length >= 5);
  for (const block of blocks) {
    const schema = 'requestId' in block ? sheetLayoutRequestSchema : sheetLayoutSchema;
    const result = schema.safeParse(block);
    assert.ok(result.success, JSON.stringify(result.error?.issues));
  }
});
