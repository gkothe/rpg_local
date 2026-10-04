import { CharacterType } from './options.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import {
  knowledgeRecordSchema,
  campaignKnowledgeSchema,
  legacyKnowledge,
  KnowledgeKind,
  KnowledgeStatus,
  type CampaignKnowledge,
} from './knowledge.js';
import type { Campaign } from './types.js';
export const KNOWLEDGE_SEARCH_TOOL_NAME = 'campaign_knowledge_search';
export const KNOWLEDGE_GET_TOOL_NAME = 'campaign_knowledge_get';
export const knowledgeSearchSchema = z
  .object({
    query: z.string(),
    kind: z.enum(KnowledgeKind).optional(),
    status: z.enum(KnowledgeStatus).optional(),
    cursor: z.string().optional(),
  })
  .strict();
export const knowledgeGetSchema = z.object({ id: z.uuid() }).strict();
export const frozenKnowledgeSchema = z
  .object({
    campaignId: z.uuid(),
    records: z.array(knowledgeRecordSchema),
    characters: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()),
    sourceIds: z.array(z.uuid()),
    sourceVersions: z
      .array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict())
      .optional(),
  })
  .strict();
export const frozenKnowledgeV5Schema = frozenKnowledgeSchema
  .extend({ records: z.array(campaignKnowledgeSchema) })
  .strict();
export type FrozenKnowledge = z.infer<typeof frozenKnowledgeV5Schema>;
export function freezeKnowledge(c: Campaign, version = 4): FrozenKnowledge {
  return structuredClone({
    campaignId: c.id,
    records: version === 5 ? (c.knowledge ?? []) : legacyKnowledge(c.knowledge ?? []),
    characters: c.characters.map(({ id, name }) => ({ id, name })),
    sourceIds: c.sources.map((s) => s.id),
    sourceVersions: c.sources.map(({ id, version }) => ({ id, version })),
  });
}
const terms = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
function score(record: CampaignKnowledge, query: string) {
  const words = terms(query);
  const title = record.title.toLocaleLowerCase();
  const text = record.text.toLocaleLowerCase();
  return words.reduce((n, word) => n + (title.includes(word) ? 3 : text.includes(word) ? 1 : 0), 0);
}
export function selectRelevantKnowledge(
  c: Campaign,
  action: string,
  sceneTerms = ''
): CampaignKnowledge[] {
  const players = c.characters.filter((ch) => ch.type === CharacterType.Player).map((ch) => ch.id);
  const mentions = action + ' ' + sceneTerms;
  const sceneWords = terms(
    sceneTerms.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '')
  ).filter(
    (word) =>
      word.length > 2 &&
      ![
        'the',
        'and',
        'with',
        'from',
        'that',
        'this',
        'into',
        'have',
        'will',
        'would',
        'could',
        'are',
        'for',
      ].includes(word)
  );
  const query =
    terms(action)
      .filter((word) => word.length > 2)
      .join(' ') +
    ' ' +
    sceneWords.join(' ');
  const active = (c.knowledge ?? []).filter((r) => r.status === KnowledgeStatus.Active);
  const mandatory = active.filter(
    (r) =>
      [KnowledgeKind.Debt, KnowledgeKind.Objective].includes(r.kind) ||
      r.characterIds.some((id) => players.includes(id)) ||
      mentions.includes(r.id) ||
      mentions.toLocaleLowerCase().includes(r.title.toLocaleLowerCase())
  );
  const optional = active
    .filter((r) => !mandatory.includes(r) && score(r, query) > 0)
    .sort(
      (a, b) =>
        score(b, query) - score(a, query) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id)
    );
  const selected = [...mandatory];
  let size = JSON.stringify(selected).length;
  for (const r of optional) {
    const cost = JSON.stringify(r).length;
    if (size + cost <= c.budgets.gameplay) {
      selected.push(r);
      size += cost;
    }
  }
  return selected;
}
export function createKnowledgeRecall(raw: FrozenKnowledge) {
  const frozen = structuredClone(frozenKnowledgeV5Schema.parse(raw));
  const identity = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
  const annotate = (r: CampaignKnowledge) => ({
    ...r,
    characterLinks: r.characterIds.map((id) => ({
      id,
      name: r.characterNames[id],
      historical: !frozen.characters.some((c) => c.id === id),
    })),
    ...(r.holderId
      ? { holderHistorical: !frozen.characters.some((c) => c.id === r.holderId) }
      : {}),
    evidence: r.evidence.map((e) =>
      e.type === 'campaign_source'
        ? {
            ...e,
            available: frozen.sourceVersions
              ? frozen.sourceVersions.some((s) => s.id === e.sourceId && s.version === e.version)
              : frozen.sourceIds.includes(e.sourceId),
          }
        : e
    ),
  });
  return {
    get(input: unknown) {
      const { id } = knowledgeGetSchema.parse(input);
      const record = frozen.records.find((r) => r.id === id);
      if (!record)
        throw new Problem(404, 'knowledge_not_found', 'Knowledge is not in this frozen campaign');
      return annotate(record);
    },
    search(input: unknown) {
      const args = knowledgeSearchSchema.parse(input);
      let offset = 0;
      const key = createHash('sha256')
        .update(
          JSON.stringify({ identity, query: args.query, kind: args.kind, status: args.status })
        )
        .digest('hex');
      if (args.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'));
          if (parsed.key !== key || !Number.isInteger(parsed.offset) || parsed.offset < 0)
            throw Error();
          offset = parsed.offset;
        } catch {
          throw new Problem(
            422,
            'knowledge_cursor',
            'Cursor does not belong to this frozen search'
          );
        }
      }
      const records = frozen.records
        .filter(
          (r) =>
            r.status === (args.status ?? KnowledgeStatus.Active) &&
            (!args.kind || r.kind === args.kind) &&
            (!args.query || score(r, args.query) > 0)
        )
        .sort(
          (a, b) =>
            score(b, args.query) - score(a, args.query) ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.id.localeCompare(b.id)
        );
      const page = records
        .slice(offset, offset + 20)
        .map(({ id, title, kind, origin, certainty, status, revision, visibility }) => ({
          id,
          title,
          kind,
          origin,
          certainty,
          status,
          revision,
          ...(visibility ? { visibility } : {}),
        }));
      return {
        campaignId: frozen.campaignId,
        records: page,
        nextCursor:
          offset + 20 < records.length
            ? Buffer.from(JSON.stringify({ key, offset: offset + 20 })).toString('base64url')
            : null,
      };
    },
  };
}
