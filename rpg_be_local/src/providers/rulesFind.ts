import { createHash } from 'node:crypto';
import type { RuleTool } from '../domain/rules.js';

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
        (entry): entry is { path: string; readableOriginal: true } =>
          !!entry &&
          typeof entry === 'object' &&
          entry.readableOriginal === true &&
          typeof entry.path === 'string'
      )
    : [];
  const reads: Record<string, unknown>[] = [];
  for (const [index, hit] of eligible.slice(0, INITIAL_ORIGINAL_READS).entries()) {
    await assertActive();
    reads.push(
      await read('rules_get', { path: hit.path, view: 'text' }, `find:${identity}:get:${index}`)
    );
  }
  return {
    search,
    reads,
    unreadPaths: eligible.slice(INITIAL_ORIGINAL_READS).map((hit) => hit.path),
  };
}
