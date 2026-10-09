export type ItemDelete = (path: string[], original: unknown) => Promise<void>;

export type ItemSave = (path: string[], original: unknown, value: unknown) => Promise<void>;

export function valueAt(value: unknown, path: string[]): unknown {
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Merge only edited leaves into refreshed data; unrelated changes survive polling. */
export function mergeItem(current: unknown, original: unknown, draft: unknown): unknown {
  if (JSON.stringify(original) === JSON.stringify(draft)) return current;
  if (original && draft && typeof original === 'object' && typeof draft === 'object') {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) !== Array.isArray(original)
    )
      throw new Error('This item changed. Close and reopen it before saving.');
    const merged = Array.isArray(current) ? [...current] : { ...current };
    for (const key of Object.keys(draft)) {
      const before = valueAt(original, [key]);
      const after = valueAt(draft, [key]);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (!Object.hasOwn(current, key))
        throw new Error('An edited field was removed. Close and reopen the item before saving.');
      Object.defineProperty(merged, key, {
        value: mergeItem(valueAt(current, [key]), before, after),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return merged;
  }
  return draft;
}

export function replaceAt(value: unknown, path: string[], replacement: unknown): unknown {
  if (!path.length) return replacement;
  const [key, ...rest] = path;
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
    throw new Error('This item was removed. Close and reopen the editor.');
  const copy = Array.isArray(value) ? [...value] : { ...value };
  Object.defineProperty(copy, key, {
    value: replaceAt(valueAt(value, [key]), rest, replacement),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/** Remove a keyed item or splice a list item without leaving a null slot. */
export function removeAt(value: unknown, path: string[]): unknown {
  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  const parent = valueAt(value, parentPath);
  if (key === undefined || !parent || typeof parent !== 'object' || !Object.hasOwn(parent, key))
    throw new Error('This item was removed. Close and reopen the list.');
  const updated = Array.isArray(parent)
    ? parent.filter((_, index) => String(index) !== key)
    : Object.fromEntries(Object.entries(parent).filter(([entryKey]) => entryKey !== key));
  return replaceAt(value, parentPath, updated);
}
