import { randomUUID } from 'node:crypto';
import { Problem } from '../errors.js';
import { KnowledgeKind, KnowledgeStatus, type KnowledgeValidation } from './knowledge.js';
import { atlasMutationSchema, type AtlasMutation } from './atlas.js';
import { atlasPreparedSchema, atlasDraftSchema, type AtlasPrepared } from './atlasPreparation.js';
import type { GameplayResponse } from './gameplayResponse.js';

export function prepareAtlasResult(
  id: string,
  raw: unknown,
  evidence: AtlasPrepared['evidence']
): AtlasPrepared {
  const draft = atlasDraftSchema.parse(raw);
  const places: Record<string, string> = {},
    frames: Record<string, string> = {};
  for (const p of draft.places) {
    if (places[p.key])
      throw new Problem(422, 'atlas_duplicate', 'Cartographer returned duplicate Place keys');
    places[p.key] = randomUUID();
  }
  for (const [i, f] of (draft.changes.frames ?? []).entries()) {
    if (
      f.expected &&
      (!f.value.id || f.value.id !== (typeof f.expected === 'string' ? f.value.id : f.expected.id))
    )
      throw new Problem(422, 'atlas_identity', 'Changed frame must keep its established identity');
    const key = f.value.key ?? `frame:${i}`;
    if (frames[key])
      throw new Problem(422, 'atlas_duplicate', 'Cartographer returned duplicate frame keys');
    frames[key] =
      (f.expected ? (typeof f.expected === 'string' ? f.value.id : f.expected.id) : undefined) ??
      randomUUID();
  }
  const routes = (draft.changes.routes ?? []).map((r) => {
    if (
      r.expected &&
      (!r.value.id || r.value.id !== (typeof r.expected === 'string' ? r.value.id : r.expected.id))
    )
      throw new Problem(422, 'atlas_identity', 'Changed route must keep its established identity');
    return (
      (r.expected ? (typeof r.expected === 'string' ? r.value.id : r.expected.id) : undefined) ??
      randomUUID()
    );
  });
  return atlasPreparedSchema.parse({ id, draft, bindings: { places, frames, routes }, evidence });
}
export function compileAtlas(original: GameplayResponse, preparations: readonly AtlasPrepared[]) {
  const response = structuredClone(original),
    ids = new Map<number, string>(),
    knowledgeEvidence = new Map<number, KnowledgeValidation>(),
    atlasEvidence = new Map<string, KnowledgeValidation>();
  const receiptIds = response.atlasChanges?.preparedReceiptIds ?? [];
  if (new Set(receiptIds).size !== receiptIds.length)
    throw new Problem(422, 'atlas_receipt', 'Duplicate cartographer receipt');
  const merged: AtlasMutation = { ...response.atlasChanges, preparedReceiptIds: [] };
  for (const receiptId of receiptIds) {
    const prepared = preparations.find((p) => p.id === receiptId);
    if (!prepared)
      throw new Problem(
        422,
        'atlas_receipt',
        'Cartographer receipt is not ready in this owned session'
      );
    const lookup = new Map<string, number>();
    for (const p of prepared.draft.places) {
      const index = response.knowledgeChanges.length;
      lookup.set(p.key, index);
      ids.set(index, prepared.bindings.places[p.key]!);
      knowledgeEvidence.set(index, prepared.evidence);
      const { key: _key, ...record } = p;
      void _key;
      response.knowledgeChanges.push({
        ...record,
        op: 'create',
        kind: KnowledgeKind.Place,
        status: KnowledgeStatus.Active,
        characterIds: [],
      });
    }
    const ref = (r: unknown): unknown => {
      if (r && typeof r === 'object' && 'localKey' in r) {
        const index = lookup.get(String(r.localKey));
        if (index === undefined)
          throw new Problem(422, 'atlas_reference', 'Prepared Place key was not declared');
        return { knowledgeChangeIndex: index };
      }
      return r;
    };
    const frame = (r: unknown): unknown => {
      if (r && typeof r === 'object' && 'localKey' in r) {
        const id = prepared.bindings.frames[String(r.localKey)];
        if (!id) throw new Problem(422, 'atlas_reference', 'Prepared frame key was not declared');
        return id;
      }
      return r;
    };
    const parts = structuredClone(prepared.draft.changes);
    for (const p of parts.places ?? []) {
      Object.assign(p.value, {
        placeId: ref(p.value.placeId),
        ...(p.value.parentPlaceId !== undefined
          ? { parentPlaceId: ref(p.value.parentPlaceId) }
          : {}),
      });
      if (p.value.placement)
        Object.assign(p.value.placement, { frameId: frame(p.value.placement.frameId) });
    }
    for (const [i, f] of (parts.frames ?? []).entries()) {
      Object.assign(f.value, {
        id: prepared.bindings.frames[f.value.key ?? `frame:${i}`],
        placeId: ref(f.value.placeId),
      });
    }
    for (const [i, r] of (parts.routes ?? []).entries()) {
      Object.assign(r.value, {
        id: prepared.bindings.routes[i],
        from: ref(r.value.from),
        to: ref(r.value.to),
      });
      if (r.value.drawing)
        Object.assign(r.value.drawing, { frameId: frame(r.value.drawing.frameId) });
    }
    for (const collection of [
      'places',
      'routes',
      'frames',
      'removePlaces',
      'removeRoutes',
      'removeFrames',
    ] as const) {
      const target = merged[collection] ?? [];
      const source = parts[collection] ?? [];
      for (let i = 0; i < source.length; i++)
        atlasEvidence.set(`${collection}:${target.length + i}`, prepared.evidence);
      Object.assign(merged, { [collection]: [...target, ...source] });
    }
  }
  if (original.atlasChanges) response.atlasChanges = atlasMutationSchema.parse(merged);
  return { response, ids, knowledgeEvidence, atlasEvidence };
}
