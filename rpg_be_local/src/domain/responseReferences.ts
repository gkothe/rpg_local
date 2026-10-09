import { z } from 'zod';
import { Problem } from '../errors.js';

export const characterRefSchema = z.union([
  z.uuid(),
  z.object({ operationIndex: z.number().int().nonnegative() }).strict(),
]);
export const knowledgeRefSchema = z.union([
  z.uuid(),
  z.object({ knowledgeChangeIndex: z.number().int().nonnegative() }).strict(),
  z.object({ npcIntroductionOperationIndex: z.number().int().nonnegative() }).strict(),
]);
export type ReferenceMaps = {
  characters: ReadonlyMap<number, string>;
  knowledge: ReadonlyMap<number, string>;
  introductions: ReadonlyMap<number, string>;
};
export function resolveCharacterRef(
  value: z.infer<typeof characterRefSchema>,
  maps: ReferenceMaps
): string {
  const id = typeof value === 'string' ? value : maps.characters.get(value.operationIndex);
  if (!id)
    throw new Problem(422, 'continuity_reference', 'Character reference must resolve to a create');
  return id;
}
export function resolveKnowledgeRef(
  value: z.infer<typeof knowledgeRefSchema>,
  maps: ReferenceMaps
): string {
  const id =
    typeof value === 'string'
      ? value
      : 'knowledgeChangeIndex' in value
        ? maps.knowledge.get(value.knowledgeChangeIndex)
        : maps.introductions.get(value.npcIntroductionOperationIndex);
  if (!id)
    throw new Problem(422, 'continuity_reference', 'Knowledge reference must resolve to a create');
  return id;
}
