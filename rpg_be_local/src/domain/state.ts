import { atResponseField, ResponseFieldProblem } from './responseFields.js';
import { validateOperationExplanations } from './operationExplanations.js';
import {
  KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  knowledgeContractVersion,
  usesAuditedContract,
  usesCombatContract,
} from './versions.js';
import {
  gameplayResponseSchema,
  auditedResponseSchema,
  type AuditedGameplayResponse,
  type GameplayResponseV5,
  type GameplayResponseV6,
  type GameplayResponse,
} from './gameplayResponse.js';
import {
  emptyCombatAuthorization,
  resolvePreparedCreate,
  validateCombatTurn,
  type CombatAuthorization,
} from './combat.js';
import {
  applyKnowledgeChanges,
  KnowledgeKind,
  KnowledgeVisibility,
  KnowledgeCertainty,
  KnowledgeStatus,
  type KnowledgeValidation,
  type KnowledgeChange,
  type KnowledgeChangeV5,
} from './knowledge.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Problem, conflict } from '../errors.js';
import type { Campaign, GMResponse, Snapshot, Character } from './types.js';
import { responseSchema } from './schemas.js';
import { CHARACTER_FIELD, OPERATION_KIND, CharacterType } from './options.js';
import { MAX_ENTITY_NAME_CHARS, MAX_JSON_OBJECT_CHARS } from './limits.js';
const canonical = (c: Character) => ({
  name: c.name,
  type: c.type,
  attributes: c.attributes,
  inventory: c.inventory,
  description: c.description,
});
/** Combat evidence for v6: session preparation receipts and the effective final narrative. */
export type CombatValidation = { authorization: CombatAuthorization; narrative?: string };
export function applyResponse(
  original: Campaign,
  raw: GMResponse | GameplayResponse | AuditedGameplayResponse,
  turnId: string,
  evidence?: KnowledgeValidation & { combat?: CombatValidation }
): { campaign: Campaign; snapshot: Snapshot; changes: string[] } {
  const v5 = usesAuditedContract(raw.version);
  const v6 = usesCombatContract(raw.version);
  const v4 = raw.version === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION || v5;
  const response = v5
    ? auditedResponseSchema(raw.version).parse(raw)
    : v4
      ? gameplayResponseSchema.parse(raw)
      : responseSchema.parse(raw);
  const authorization = evidence?.combat?.authorization ?? emptyCombatAuthorization();
  if (v5)
    validateOperationExplanations(
      response as AuditedGameplayResponse,
      evidence ?? { campaignId: original.id, turnId }
    );
  const aliases = new Map<number, string>();
  const introductions: (KnowledgeChange | KnowledgeChangeV5)[] = [];
  const c = structuredClone(original);
  const touched = new Set<string>();
  const changedFields = new Map<string, Set<'name' | 'attributes' | 'inventory' | 'description'>>();
  const changes: string[] = [];
  for (const [operationIndex, op] of response.operations.entries()) {
    atResponseField(['operations', operationIndex], () => {
      function invalidField(field: string, message: string): never {
        throw new ResponseFieldProblem(
          ['operations', operationIndex, field],
          new Problem(422, 'invalid_operation', message)
        );
      }
      if (op.op === OPERATION_KIND.Create) {
        const prepared = v6
          ? resolvePreparedCreate(
              op as GameplayResponseV6['operations'][number] & { op: 'create' },
              authorization,
              c.characters
            )
          : undefined;
        const char: Character = {
          ...op.character,
          id: prepared?.characterId ?? randomUUID(),
          notes: '',
          revision: c.revision + 1,
        };
        c.characters.push(char);
        aliases.set(operationIndex, char.id);
        if (
          v5 &&
          'introduction' in op &&
          (op.introduction as { visibility?: KnowledgeVisibility }).visibility ===
            KnowledgeVisibility.GmOnly
        )
          throw new Problem(
            422,
            'knowledge_invalid',
            'Characters are public; keep unrevealed NPCs in GM-only knowledge'
          );
        if (v4 && char.type === CharacterType.Npc && 'introduction' in op)
          introductions.push({
            op: 'create',
            kind: KnowledgeKind.Npc,
            title: char.name,
            text: `${char.name} was introduced.`,
            certainty: KnowledgeCertainty.Established,
            status: KnowledgeStatus.Active,
            characterIds: [char.id],
            ...(
              op as (GameplayResponse | GameplayResponseV5)['operations'][number] & {
                introduction: import('zod').infer<
                  typeof import('./knowledge.js').knowledgeProvenanceSchema
                >;
              }
            ).introduction,
          });
        touched.add(char.id);
        changes.push(`${char.name}: introduced`);
      } else if (op.op === OPERATION_KIND.Set) {
        const char = c.characters.find((x) => x.id === op.characterId);
        if (!char) invalidField('characterId', 'Character is not in this campaign');
        if (!isDeepStrictEqual(char[op.field], op.expected))
          invalidField('expected', `${char.name}: expected prior ${op.field} does not match`);
        if (op.field === CHARACTER_FIELD.Name) {
          if (
            typeof op.value !== 'string' ||
            !op.value.trim() ||
            op.value.length > MAX_ENTITY_NAME_CHARS
          )
            invalidField('value', 'Invalid character name');
          char.name = op.value;
        } else {
          if (
            op.value === null ||
            Array.isArray(op.value) ||
            typeof op.value !== 'object' ||
            JSON.stringify(op.value).length > MAX_JSON_OBJECT_CHARS
          )
            invalidField('value', 'Character field must be an object under 100KB');
          char[op.field] = op.value as Record<string, unknown>;
        }
        char.revision = c.revision + 1;
        touched.add(char.id);
        const fields = changedFields.get(char.id) ?? new Set();
        fields.add(op.field);
        changedFields.set(char.id, fields);
        changes.push(`${char.name}: ${op.field} changed`);
      } else {
        if (!isDeepStrictEqual(c.state, op.expected))
          invalidField('expected', 'Expected campaign state does not match');
        c.state = op.value;
        changes.push('Campaign state changed');
      }
    });
  }
  const knowledge = v4
    ? applyKnowledgeChanges(
        original.knowledge ?? [],
        [...introductions, ...(response as GameplayResponse).knowledgeChanges],
        c.characters,
        aliases,
        evidence ?? { campaignId: c.id, turnId },
        knowledgeContractVersion(raw.version),
        (index) =>
          index < introductions.length
            ? [
                'operations',
                [...aliases.keys()].filter(
                  (i) =>
                    response.operations[i]?.op === 'create' &&
                    response.operations[i]?.character.type === CharacterType.Npc
                )[index]!,
                'introduction',
              ]
            : ['knowledgeChanges', index - introductions.length]
      )
    : undefined;
  if (knowledge) {
    const npcIds = new Set(
      introductions.flatMap((op) =>
        op.op === 'create'
          ? op.characterIds.filter((id): id is string => typeof id === 'string')
          : []
      )
    );
    const duplicateIndex = (response as GameplayResponse).knowledgeChanges.findIndex(
      (op) =>
        op.op === 'create' &&
        op.kind === KnowledgeKind.Npc &&
        op.characterIds.some((link) =>
          npcIds.has(typeof link === 'string' ? link : (aliases.get(link.operationIndex) ?? ''))
        )
    );
    if (duplicateIndex >= 0)
      throw new ResponseFieldProblem(
        ['knowledgeChanges', duplicateIndex],
        new Problem(
          422,
          'knowledge_invalid',
          'Created NPC introduction is registered automatically; do not duplicate it'
        )
      );
    c.knowledge = knowledge.records;
    changes.push(...knowledge.changes);
  }
  if (v6)
    validateCombatTurn({
      before: original,
      after: c,
      response: response as GameplayResponseV6,
      authorization,
      rolls: evidence?.rolls ?? [],
      narrative: evidence?.combat?.narrative ?? response.narrative,
    });
  return {
    campaign: c,
    changes: v5
      ? changes.flatMap((change, index) => {
          const explanation = (response as GameplayResponseV5).operationExplanations.find(
            (e) => e.operationIndex === index
          );
          if (index >= response.operations.length || !explanation) return [change];
          return explanation.visibility === KnowledgeVisibility.GmOnly
            ? []
            : [`${change}: ${explanation.reason}`];
        })
      : changes,
    snapshot: {
      turnId,
      ...(knowledge ? { beforeKnowledge: knowledge.before, afterKnowledge: knowledge.after } : {}),
      beforeCharacters: original.characters.filter((x) => touched.has(x.id)),
      afterCharacters: c.characters.filter((x) => touched.has(x.id)),
      beforeState: original.state,
      afterState: c.state,
      beforeMemory: original.memory,
      changedFields: [...changedFields].map(([characterId, fields]) => ({
        characterId,
        fields: [...fields],
      })),
    },
  };
}
export function undoSnapshot(original: Campaign, snapshot: Snapshot): Campaign {
  const c = structuredClone(original);
  for (const after of snapshot.afterKnowledge ?? []) {
    if (
      !isDeepStrictEqual(
        c.knowledge?.find((r) => r.id === after.id),
        after
      )
    )
      throw conflict('Knowledge changed after this turn; undo would overwrite that change');
  }
  for (const after of snapshot.afterCharacters) {
    const current = c.characters.find((x) => x.id === after.id);
    const before = snapshot.beforeCharacters.find((x) => x.id === after.id);
    const fields = snapshot.changedFields?.find((x) => x.characterId === after.id)?.fields;
    const compatible =
      current &&
      (before && fields
        ? fields.every((field) => isDeepStrictEqual(current[field], after[field]))
        : isDeepStrictEqual(canonical(current), canonical(after)));
    if (!compatible)
      throw conflict(
        `${after.name} was manually changed after this turn; undo would overwrite that change`
      );
  }
  const stateChanged = !isDeepStrictEqual(snapshot.beforeState, snapshot.afterState);
  if (stateChanged && !isDeepStrictEqual(c.state, snapshot.afterState))
    throw conflict('Campaign state was manually changed after this turn');
  for (const after of snapshot.afterCharacters) {
    const index = c.characters.findIndex((x) => x.id === after.id);
    const before = snapshot.beforeCharacters.find((x) => x.id === after.id);
    if (before) {
      const notes = c.characters[index]!.notes;
      const fields = snapshot.changedFields?.find((x) => x.characterId === after.id)?.fields;
      if (fields) {
        const current = c.characters[index]!;
        for (const field of fields) {
          if (field === CHARACTER_FIELD.Name) current.name = before.name;
          else current[field] = structuredClone(before[field]);
        }
        current.revision = c.revision + 1;
      } else c.characters[index] = { ...before, notes, revision: c.revision + 1 };
    } else {
      if (c.characters[index]!.notes)
        throw conflict('New character has manual notes; remove or copy them before undo');
      c.characters.splice(index, 1);
    }
  }
  if (stateChanged) c.state = structuredClone(snapshot.beforeState);
  if (snapshot.afterKnowledge) {
    const touched = new Set(snapshot.afterKnowledge.map((r) => r.id));
    c.knowledge = [
      ...(c.knowledge ?? []).flatMap((record) => {
        if (!touched.has(record.id)) return [record];
        const before = snapshot.beforeKnowledge?.find((r) => r.id === record.id);
        return before ? [structuredClone(before)] : [];
      }),
    ];
  }
  c.memory = snapshot.beforeMemory;
  return c;
}
