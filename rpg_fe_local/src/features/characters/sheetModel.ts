import type { SheetFieldHint, SheetLayout } from '../../services/types';

/** Text at least this long reads as a paragraph rather than a value. */
export const PROSE_MIN_CHARS = 140;

export type SheetNode = { key: string; label: string; mismatch?: boolean } & (
  | { kind: 'number'; value: number }
  | { kind: 'dots'; value: number; max: number }
  | { kind: 'checks'; value: number; max: number }
  | { kind: 'track'; value: number; max: number }
  | { kind: 'percentile'; value: number }
  | { kind: 'score'; value: number; modifier: number | null }
  | { kind: 'text'; text: string }
  | { kind: 'prose'; text: string }
  | { kind: 'tags'; values: string[] }
  | { kind: 'items'; items: Record<string, unknown>[] }
  | { kind: 'group'; children: SheetNode[] }
  | { kind: 'empty'; text: string }
  | { kind: 'raw'; value: unknown }
);
type Sections = Record<string, unknown>;

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const pathKey = (path: readonly string[]) => JSON.stringify(path);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isScalarText = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const isNamedObject = (value: unknown) => isObject(value) && typeof value.name === 'string';
// Widgets whose hint on a parent object also applies to its numeric children.
const INHERITED_WIDGETS = new Set(['number', 'dots', 'checks', 'percentile']);

function valueAt(sections: Sections, path: readonly string[]): unknown {
  let current: unknown = sections;
  for (const segment of path) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Turns one sheet section into render nodes. The base layer only uses safe structural widgets;
 * hints from the rule system's layout upgrade fields whose meaning the layout author knows.
 */
export function buildSheetModel(
  section: string,
  sections: Sections,
  layout: SheetLayout | undefined
): SheetNode[] {
  const hints = new Map<string, SheetFieldHint>();
  for (const hint of layout?.fields ?? []) hints.set(pathKey(hint.path), hint);
  const root = sections[section];
  if (!isObject(root))
    return [{ key: section, label: humanize(section), kind: 'raw', value: root }];
  const rootValues = Object.values(root);
  // A section that is only keyed named objects (an inventory) reads as one set of item cards.
  const hinted = (layout?.fields ?? []).some(
    (hint) => hint.path[0] === section && hint.path.length > 1
  );
  if (rootValues.length && !hinted && rootValues.every(isNamedObject))
    return [
      { key: section, label: '', kind: 'items', items: rootValues as Record<string, unknown>[] },
    ];
  return children(root, [section], undefined);

  function children(
    value: Record<string, unknown>,
    path: string[],
    inherited: SheetFieldHint | undefined
  ): SheetNode[] {
    const nodes = Object.entries(value).flatMap(([key, item], index) => {
      const node = build(key, item, [...path, key], inherited);
      const order = hints.get(pathKey([...path, key]))?.order;
      return node ? [{ node, order, index }] : [];
    });
    return nodes
      .sort((a, b) =>
        a.order === undefined && b.order === undefined
          ? a.index - b.index
          : a.order === undefined
            ? 1
            : b.order === undefined
              ? -1
              : a.order - b.order || a.index - b.index
      )
      .map((entry) => entry.node);
  }

  function build(
    key: string,
    value: unknown,
    path: string[],
    inherited: SheetFieldHint | undefined
  ): SheetNode | null {
    const exact = hints.get(pathKey(path));
    if (exact?.widget === 'hidden') return null;
    const label = exact?.label ?? humanize(key);
    const base = { key, label };
    if (exact) {
      const hinted = applyHint(exact, base, value, path);
      if (hinted) return hinted;
      // null: a known widget that does not fit the value. undefined: a widget id this app
      // version does not know (a newer backend); it uses the base layer without a warning.
      // A scalar-widget hint on an object is inherited by its numeric children, not a mismatch.
      if (isObject(value) && INHERITED_WIDGETS.has(exact.widget))
        return baseNode(base, value, path, undefined);
      return {
        ...baseNode(base, value, path, undefined),
        ...(hinted === null && { mismatch: true }),
      };
    }
    if (inherited && isNumber(value)) {
      const node = applyHint(inherited, base, value, path);
      if (node) return node;
    }
    return baseNode(base, value, path, inherited);
  }

  function applyHint(
    hint: SheetFieldHint,
    base: { key: string; label: string },
    value: unknown,
    path: string[]
  ): SheetNode | null | undefined {
    switch (hint.widget) {
      case 'number':
        return isNumber(value) ? { ...base, kind: 'number', value } : null;
      case 'percentile':
        return isNumber(value) ? { ...base, kind: 'percentile', value } : null;
      case 'dots':
      case 'checks':
        return isNumber(value) && hint.max !== undefined
          ? { ...base, kind: hint.widget, value, max: hint.max }
          : null;
      case 'track': {
        const max = hint.max ?? (hint.maxPath ? valueAt(sections, hint.maxPath) : undefined);
        return isNumber(value) && isNumber(max) ? { ...base, kind: 'track', value, max } : null;
      }
      case 'score': {
        if (!isNumber(value)) return null;
        const modifier = hint.modifierPath ? valueAt(sections, hint.modifierPath) : undefined;
        return { ...base, kind: 'score', value, modifier: isNumber(modifier) ? modifier : null };
      }
      case 'tags':
        return Array.isArray(value) && value.every(isScalarText)
          ? { ...base, kind: 'tags', values: value.map(String) }
          : null;
      case 'items':
        return Array.isArray(value) && value.length && value.every(isNamedObject)
          ? { ...base, kind: 'items', items: value as Record<string, unknown>[] }
          : null;
      case 'prose':
        return typeof value === 'string' ? { ...base, kind: 'prose', text: value } : null;
      case 'facts':
        return isObject(value) && Object.keys(value).length
          ? { ...base, kind: 'group', children: children(value, path, undefined) }
          : null;
      default:
        return undefined;
    }
  }

  function baseNode(
    base: { key: string; label: string },
    value: unknown,
    path: string[],
    inherited: SheetFieldHint | undefined
  ): SheetNode {
    if (value === null || value === undefined) return { ...base, kind: 'empty', text: '—' };
    if (isNumber(value)) return { ...base, kind: 'number', value };
    if (typeof value === 'string')
      return value.length >= PROSE_MIN_CHARS
        ? { ...base, kind: 'prose', text: value }
        : { ...base, kind: 'text', text: value };
    if (Array.isArray(value)) {
      if (!value.length) return { ...base, kind: 'empty', text: 'Nothing recorded.' };
      if (value.every((item) => typeof item === 'string'))
        return { ...base, kind: 'tags', values: value as string[] };
      if (value.every(isNamedObject))
        return { ...base, kind: 'items', items: value as Record<string, unknown>[] };
      return { ...base, kind: 'raw', value };
    }
    if (isObject(value)) {
      if (!Object.keys(value).length) return { ...base, kind: 'empty', text: 'Nothing recorded.' };
      const own = hints.get(pathKey(path));
      const carry = own && INHERITED_WIDGETS.has(own.widget) ? own : inherited;
      return { ...base, kind: 'group', children: children(value, path, carry) };
    }
    return { ...base, kind: 'text', text: String(value) };
  }
}
