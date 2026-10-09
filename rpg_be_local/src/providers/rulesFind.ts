import { createHash } from 'node:crypto';
import type { RuleTool } from '../domain/rules.js';
import { originalReadLocator } from './ruleReadReuse.js';

export const RULE_FIND_TOOL_NAME = 'rules_find';
// A first page of originals, not a cap on further retrieval or native tool calls.
const INITIAL_ORIGINAL_READS = 3;
type Read = (tool: RuleTool, input: unknown, id: string) => Promise<Record<string, unknown>>;
export async function findRules(
  read: Read,
  input: unknown,
  requestId: string | number,
  assertActive: () => Promise<void>
) {
  const identity = createHash('sha256').update(JSON.stringify(requestId)).digest('hex');
  await assertActive();
  const search = await read('rules_search', input, `find:${identity}:search`);
  const eligible = Array.isArray(search.entries)
    ? search.entries.filter(
        (
          entry
        ): entry is {
          path: string;
          name?: string;
          readableOriginal: true;
          exactTitle?: boolean;
          locator?: string | null;
          matchSupplied?: boolean;
          originalComplete?: boolean;
          suppliedOriginals?: ReturnType<typeof originalReadLocator>[];
        } =>
          !!entry &&
          typeof entry === 'object' &&
          entry.readableOriginal === true &&
          typeof entry.path === 'string'
      )
    : [];
  const reads: Record<string, unknown>[] = [];
  const exact = eligible.filter((hit) => hit.exactTitle);
  const selected = (exact.length ? exact : eligible).slice(0, INITIAL_ORIGINAL_READS);
  const reused = selected.filter((hit) => hit.originalComplete || hit.matchSupplied);
  const unread = eligible.filter((hit) => !selected.includes(hit));
  for (const [index, hit] of selected.entries()) {
    if (reused.includes(hit)) continue;
    await assertActive();
    reads.push(
      await read(
        'rules_get',
        { path: hit.path, view: 'text', ...(hit.locator ? { locator: hit.locator } : {}) },
        `find:${identity}:get:${index}`
      )
    );
  }
  const names = new Map(eligible.map((hit) => [hit.path, hit.name]));
  const suppliedOriginals = [
    ...reused.flatMap((hit) => hit.suppliedOriginals ?? []),
    ...reads
      .filter(
        (read) =>
          !read.error &&
          read.view === 'text' &&
          !read.structural &&
          typeof read.text === 'string' &&
          read.text.length > 0
      )
      .map(originalReadLocator),
  ].map((span) => ({
    ...span,
    name: names.get(span.path as string) ?? String(span.path),
    originalComplete: span.start === 0 && span.complete === true,
  }));
  return {
    suppliedOriginals,
    search,
    reads,
    unreadPaths: unread.map((hit) => hit.path),
  };
}
