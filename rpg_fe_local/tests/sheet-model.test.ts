import { describe, expect, it } from 'vitest';
import { buildSheetModel, PROSE_MIN_CHARS } from '../src/features/characters/sheetModel';
import type { SheetFieldHint } from '../src/services/types';

const layout = (...fields: SheetFieldHint[]) => ({ fields });
const sections = {
  attributes: {
    skills: { brawl: 2, stealth: 4 },
    hp: { current: 31, max: 38 },
    str: 16,
    strMod: 3,
    languages: ['Common', 'Elvish'],
    notes: null,
    flag: true,
  },
  inventory: { weapons: [{ name: 'Sword', damage: '1d8' }], empty: [], mixed: [1, { a: 1 }] },
  description: { background: 'x'.repeat(PROSE_MIN_CHARS), short: 'Quiet', nothing: {} },
};
const model = (section: string, hints?: SheetFieldHint[]) =>
  buildSheetModel(section, sections, hints ? layout(...hints) : undefined);
const find = (nodes: ReturnType<typeof model>, key: string) => nodes.find((n) => n.key === key)!;

describe('sheet model base layer', () => {
  it('uses structural widgets only and never draws dots or bars', () => {
    const nodes = model('attributes');
    expect(find(nodes, 'skills')).toMatchObject({ kind: 'group', label: 'skills' });
    const skills = find(nodes, 'skills');
    expect(skills.kind === 'group' && skills.children.map((c) => c.kind)).toEqual([
      'number',
      'number',
    ]);
    expect(find(nodes, 'str')).toMatchObject({ kind: 'number', value: 16 });
    expect(find(nodes, 'languages')).toMatchObject({ kind: 'tags', values: ['Common', 'Elvish'] });
    expect(find(nodes, 'notes')).toMatchObject({ kind: 'empty', text: '—' });
    expect(find(nodes, 'flag')).toMatchObject({ kind: 'text', text: 'true' });
    const inventory = model('inventory');
    expect(find(inventory, 'weapons').kind).toBe('items');
    expect(find(inventory, 'empty')).toMatchObject({ kind: 'empty', text: 'Nothing recorded.' });
    expect(find(inventory, 'mixed').kind).toBe('raw');
    const description = model('description');
    expect(find(description, 'background').kind).toBe('prose');
    expect(find(description, 'short').kind).toBe('text');
    expect(find(description, 'nothing')).toMatchObject({ kind: 'empty' });
  });
  it('humanizes keys and keeps stored order', () => {
    const nodes = buildSheetModel(
      'attributes',
      { attributes: { snake_key: 1, camelKey: 2 } },
      undefined
    );
    expect(nodes.map((n) => n.label)).toEqual(['snake key', 'camel Key']);
  });
});

describe('sheet model hints', () => {
  it('draws dots from a hint on a parent and lets the deepest hint win', () => {
    const nodes = model('attributes', [
      { path: ['attributes', 'skills'], widget: 'dots', max: 5 },
      { path: ['attributes', 'skills', 'brawl'], widget: 'dots', max: 3 },
    ]);
    const skills = find(nodes, 'skills');
    expect(skills.kind === 'group' && skills.children).toMatchObject([
      { key: 'brawl', kind: 'dots', value: 2, max: 3 },
      { key: 'stealth', kind: 'dots', value: 4, max: 5 },
    ]);
  });
  it('resolves track maxima and score modifiers from other paths', () => {
    const nodes = model('attributes', [
      {
        path: ['attributes', 'hp', 'current'],
        widget: 'track',
        maxPath: ['attributes', 'hp', 'max'],
      },
      {
        path: ['attributes', 'str'],
        widget: 'score',
        modifierPath: ['attributes', 'strMod'],
        label: 'Strength',
      },
    ]);
    const hp = find(nodes, 'hp');
    expect(hp.kind === 'group' && hp.children[0]).toMatchObject({
      kind: 'track',
      value: 31,
      max: 38,
    });
    expect(find(nodes, 'str')).toMatchObject({
      kind: 'score',
      label: 'Strength',
      value: 16,
      modifier: 3,
    });
  });
  it('falls back to the base layer and flags a hint that does not fit', () => {
    const nodes = model('description', [
      { path: ['description', 'short'], widget: 'dots', max: 5 },
      { path: ['description', 'background'], widget: 'track', max: 10 },
    ]);
    expect(find(nodes, 'short')).toMatchObject({ kind: 'text', mismatch: true });
    expect(find(nodes, 'background')).toMatchObject({ kind: 'prose', mismatch: true });
  });
  it('flags a track whose maxPath does not resolve to a number', () => {
    const nodes = model('attributes', [
      { path: ['attributes', 'str'], widget: 'track', maxPath: ['attributes', 'missing'] },
    ]);
    expect(find(nodes, 'str')).toMatchObject({ kind: 'number', mismatch: true });
  });
  it('uses the base layer without a warning for unknown widget ids', () => {
    const nodes = model('attributes', [{ path: ['attributes', 'str'], widget: 'rune' }]);
    expect(find(nodes, 'str')).toEqual({ key: 'str', label: 'str', kind: 'number', value: 16 });
  });
  it('hides fields, sorts ordered hints first and applies labels', () => {
    const nodes = model('attributes', [
      { path: ['attributes', 'flag'], widget: 'hidden' },
      { path: ['attributes', 'str'], widget: 'number', order: 2, label: 'Might' },
      { path: ['attributes', 'languages'], widget: 'tags', order: 1 },
    ]);
    expect(nodes.map((n) => n.key)).toEqual([
      'languages',
      'str',
      'skills',
      'hp',
      'strMod',
      'notes',
    ]);
    expect(find(nodes, 'str').label).toBe('Might');
  });
  it('supports items, prose, facts, tags and percentile hints', () => {
    const nodes = buildSheetModel(
      'attributes',
      {
        attributes: {
          gear: [{ name: 'Rope' }],
          story: 'short',
          facts: { a: 1 },
          tags: [1, 'b'],
          pct: 45,
        },
      },
      layout(
        { path: ['attributes', 'gear'], widget: 'items' },
        { path: ['attributes', 'story'], widget: 'prose' },
        { path: ['attributes', 'facts'], widget: 'facts' },
        { path: ['attributes', 'tags'], widget: 'tags' },
        { path: ['attributes', 'pct'], widget: 'percentile' }
      )
    );
    expect(nodes.map((n) => n.kind)).toEqual(['items', 'prose', 'group', 'tags', 'percentile']);
  });
  it('does not flag a parent object that carries an inherited scalar hint', () => {
    const nodes = model('attributes', [{ path: ['attributes', 'skills'], widget: 'dots', max: 5 }]);
    expect(find(nodes, 'skills').mismatch).toBeUndefined();
  });
});
