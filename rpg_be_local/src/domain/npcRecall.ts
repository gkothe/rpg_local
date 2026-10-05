import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { CharacterType } from './options.js';
import { characterInput } from './schemas.js';
import type { CampaignKnowledge } from './knowledge.js';
import type { Campaign } from './types.js';

export const NPC_SEARCH_TOOL_NAME = 'campaign_npcs_search';
export const NPC_GET_TOOL_NAME = 'campaign_npcs_get';
export const NPC_SEARCH_LIMITS = { pageSize: 20, queryChars: 256, cursorChars: 2048 } as const;
export const npcSnapshotSchema = z
  .object({
    id: z.uuid(),
    name: characterInput.shape.name,
    type: z.literal(CharacterType.Npc),
    attributes: characterInput.shape.attributes.removeDefault(),
    inventory: characterInput.shape.inventory.removeDefault(),
    description: characterInput.shape.description.removeDefault(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const npcSearchSchema = z
  .object({
    query: z.string().max(NPC_SEARCH_LIMITS.queryChars),
    cursor: z.string().min(1).max(NPC_SEARCH_LIMITS.cursorChars).optional(),
  })
  .strict();
export const npcGetSchema = z.object({ id: z.uuid() }).strict();
export type NpcSnapshot = z.infer<typeof npcSnapshotSchema>;

export function freezeNpcCharacters(campaign: Campaign): NpcSnapshot[] {
  return structuredClone(
    campaign.characters
      .filter((character) => character.type === CharacterType.Npc)
      .map(({ id, name, attributes, inventory, description, revision }) => ({
        id,
        name,
        type: CharacterType.Npc,
        attributes,
        inventory,
        description,
        revision,
      }))
  );
}

function descriptionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(descriptionText).join(' ');
  if (value && typeof value === 'object')
    return Object.values(value).map(descriptionText).join(' ');
  return '';
}

export function createNpcRecall(
  campaignId: string,
  raw: NpcSnapshot[],
  records: CampaignKnowledge[]
) {
  const npcs = structuredClone(z.array(npcSnapshotSchema).parse(raw));
  const knowledge = structuredClone(records);
  const identity = createHash('sha256').update(JSON.stringify({ campaignId, npcs })).digest('hex');
  const indexed = npcs.map((npc) => ({
    npc,
    name: npc.name.toLowerCase(),
    description: descriptionText(npc.description).toLowerCase(),
  }));
  return {
    get(input: unknown) {
      const { id } = npcGetSchema.parse(input);
      const npc = npcs.find((candidate) => candidate.id === id);
      if (!npc) throw new Problem(404, 'npc_not_found', 'NPC is not in this frozen campaign');
      return structuredClone({
        campaignId,
        npc,
        knowledgeLinks: knowledge
          .filter((record) => record.characterIds.includes(id))
          .map(({ id, title, kind, origin, certainty, status, visibility }) => ({
            id,
            title,
            kind,
            origin,
            certainty,
            status,
            ...(visibility ? { visibility } : {}),
          })),
      });
    },
    search(input: unknown) {
      const args = npcSearchSchema.parse(input);
      const words = [...new Set(args.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
      const key = createHash('sha256').update(JSON.stringify({ identity, words })).digest('hex');
      let offset = 0;
      if (args.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'));
          if (
            cursor.key !== key ||
            !Number.isSafeInteger(cursor.offset) ||
            cursor.offset < 0 ||
            cursor.offset % NPC_SEARCH_LIMITS.pageSize !== 0
          )
            throw Error();
          offset = cursor.offset;
        } catch {
          throw new Problem(422, 'npc_cursor', 'Cursor does not belong to this frozen NPC search');
        }
      }
      const matches = indexed
        .filter(({ name, description }) =>
          words.every((word) => name.includes(word) || description.includes(word))
        )
        .map(({ npc, name, description }) => ({
          npc,
          nameScore: words.filter((word) => name.includes(word)).length,
          descriptionScore: words.filter((word) => description.includes(word)).length,
        }))
        .sort(
          (a, b) =>
            b.nameScore - a.nameScore ||
            b.descriptionScore - a.descriptionScore ||
            a.npc.id.localeCompare(b.npc.id)
        );
      return {
        campaignId,
        npcs: matches
          .slice(offset, offset + NPC_SEARCH_LIMITS.pageSize)
          .map(({ npc, nameScore, descriptionScore }) => ({
            id: npc.id,
            name: npc.name,
            revision: npc.revision,
            matchedFields: [
              ...(nameScore ? ['name'] : []),
              ...(descriptionScore ? ['description'] : []),
            ],
          })),
        nextCursor:
          offset + NPC_SEARCH_LIMITS.pageSize < matches.length
            ? Buffer.from(
                JSON.stringify({ key, offset: offset + NPC_SEARCH_LIMITS.pageSize })
              ).toString('base64url')
            : null,
      };
    },
  };
}
