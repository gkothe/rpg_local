import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import type { Campaign } from './types.js';
import {
  atlasMutationSchema,
  atlasExpected,
  emptyAtlas,
  validateAtlas,
  AtlasAccess,
  type AtlasMutation,
  type Atlas,
} from './atlas.js';
import {
  campaignKnowledgeSchema,
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeStatus,
  validateKnowledgeEvidence,
  type KnowledgeValidation,
} from './knowledge.js';
import { resolveKnowledgeRef, type ReferenceMaps } from './responseReferences.js';

const noMaps: ReferenceMaps = {
  characters: new Map(),
  knowledge: new Map(),
  introductions: new Map(),
};
export function mutateAtlas(
  original: Campaign,
  raw: unknown,
  maps: ReferenceMaps = noMaps,
  evidence?: KnowledgeValidation
): Campaign {
  const changes = atlasMutationSchema.parse(raw);
  if (changes.preparedReceiptIds?.length)
    throw new Problem(
      422,
      'atlas_receipt',
      'Owned preparations must be compiled before applying atlas changes'
    );
  const c = structuredClone(original),
    atlas = c.atlas ?? emptyAtlas();
  const keys = new Map<string, string>(),
    frameKeys = new Map<string, string>();
  const resolve = (ref: NonNullable<AtlasMutation['position']>['placeId']): string | null => {
    if (ref === null) return null;
    if (typeof ref === 'object' && 'localKey' in ref) {
      const id = keys.get(ref.localKey);
      if (!id) throw new Problem(422, 'atlas_reference', 'Unknown local Place key');
      return id;
    }
    return resolveKnowledgeRef(ref, maps);
  };
  const resolveFrame = (ref: string | { localKey: string }) => {
    const id = typeof ref === 'string' ? ref : frameKeys.get(ref.localKey);
    if (!id) throw new Problem(422, 'atlas_reference', 'Unknown local frame key');
    return id;
  };
  for (const p of changes.createPlaces ?? []) {
    if (evidence)
      throw new Problem(
        422,
        'atlas_create',
        'Gameplay creates Places through knowledgeChanges or a preparation receipt'
      );
    if (keys.has(p.key)) throw new Problem(422, 'atlas_reference', 'Duplicate local Place key');
    const id = randomUUID(),
      now = new Date().toISOString();
    keys.set(p.key, id);
    (c.knowledge ??= []).push(
      campaignKnowledgeSchema.parse({
        id,
        kind: KnowledgeKind.Place,
        title: p.title,
        text: p.text,
        visibility: p.visibility,
        introductionVisibility: p.visibility,
        certainty: p.certainty,
        status: KnowledgeStatus.Active,
        characterIds: [],
        characterNames: {},
        origin: KnowledgeOrigin.Player,
        evidence: [],
        createdTurnId: null,
        updatedTurnId: null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        attributions: [
          {
            origin: KnowledgeOrigin.Player,
            evidence: [],
            turnId: null,
            at: now,
            visibility: p.visibility,
          },
        ],
      })
    );
  }
  const update = <T>(rows: T[], value: T, expected: T | string | null, key: (row: T) => string) => {
    const index = rows.findIndex((r) => key(r) === key(value));
    if (
      !(typeof expected === 'string'
        ? index >= 0 && atlasExpected(rows[index]) === expected
        : isDeepStrictEqual(index < 0 ? null : rows[index], expected))
    )
      throw new Problem(
        409,
        'atlas_conflict',
        'Expected spatial value no longer matches; refresh and review your edit'
      );
    if (index < 0) rows.push(value);
    else rows[index] = value;
  };
  const remove = <T>(rows: T[], expected: unknown, id: string, key: (row: T) => string) => {
    const index = rows.findIndex((r) => key(r) === id);
    const matches =
      typeof expected === 'object' && expected !== null && 'expected' in expected
        ? index >= 0 && atlasExpected(rows[index]) === expected.expected
        : isDeepStrictEqual(rows[index], expected);
    if (index < 0 || !matches)
      throw new Problem(409, 'atlas_conflict', 'Expected removed spatial value no longer matches');
    rows.splice(index, 1);
  };
  const seen = new Set<string>();
  const claim = (id: string) => {
    if (seen.has(id))
      throw new Problem(
        422,
        'atlas_duplicate',
        'Each spatial record may change only once per request'
      );
    seen.add(id);
  };
  for (const [index, f] of (changes.frames ?? []).entries()) {
    if (evidence)
      validateKnowledgeEvidence(
        f.value,
        evidence.preparedAtlasEvidence?.get(`frames:${index}`) ?? evidence
      );
    else if (f.value.origin !== KnowledgeOrigin.Player || f.value.evidence.length)
      throw new Problem(422, 'atlas_provenance', 'Manual edits use player-authored provenance');
    if (
      f.expected === null &&
      f.value.id &&
      !evidence?.preparedAtlasEvidence?.has(`frames:${index}`)
    )
      throw new Problem(
        422,
        'atlas_identity',
        'New frames use server IDs; omit id and use a local frame key'
      );
    const { key, ...value } = f.value;
    const id = value.id ?? randomUUID();
    claim(id);
    if (key) {
      if (frameKeys.has(key)) throw new Problem(422, 'atlas_reference', 'Duplicate frame key');
      frameKeys.set(key, id);
    }
    update(
      atlas.frames,
      {
        ...(!evidence && atlas.frames.find((f) => f.id === id)?.privateAssetId
          ? { privateAssetId: atlas.frames.find((f) => f.id === id)!.privateAssetId }
          : {}),
        ...value,
        id,
        placeId: resolve(value.placeId)!,
      },
      f.expected,
      (r) => r.id
    );
  }
  for (const p of changes.places ?? []) {
    const placeId = resolve(p.value.placeId)!;
    claim(placeId);
    const value = {
      ...p.value,
      placeId,
      ...(p.value.parentPlaceId !== undefined
        ? { parentPlaceId: resolve(p.value.parentPlaceId) }
        : {}),
      ...(p.value.placement
        ? { placement: { ...p.value.placement, frameId: resolveFrame(p.value.placement.frameId) } }
        : {}),
    };
    update(atlas.places, value, p.expected, (r) => r.placeId);
  }
  for (const [index, r] of (changes.routes ?? []).entries()) {
    if (evidence)
      validateKnowledgeEvidence(
        r.value,
        evidence.preparedAtlasEvidence?.get(`routes:${index}`) ?? evidence
      );
    else if (r.value.origin !== KnowledgeOrigin.Player || r.value.evidence.length)
      throw new Problem(422, 'atlas_provenance', 'Manual edits use player-authored provenance');
    if (
      r.expected === null &&
      r.value.id &&
      !evidence?.preparedAtlasEvidence?.has(`routes:${index}`)
    )
      throw new Problem(422, 'atlas_identity', 'New routes use server IDs; omit id');
    const id = r.value.id ?? randomUUID();
    claim(id);
    update(
      atlas.routes,
      {
        ...r.value,
        id,
        from: resolve(r.value.from)!,
        to: resolve(r.value.to)!,
        ...(r.value.drawing
          ? { drawing: { ...r.value.drawing, frameId: resolveFrame(r.value.drawing.frameId) } }
          : {}),
      },
      r.expected,
      (r) => r.id
    );
  }
  for (const p of changes.removePlaces ?? []) {
    claim(p.placeId);
    remove(atlas.places, p, p.placeId, (r) => r.placeId);
  }
  for (const r of changes.removeRoutes ?? []) {
    claim(r.id);
    remove(atlas.routes, r, r.id, (r) => r.id);
  }
  for (const f of changes.removeFrames ?? []) {
    claim(f.id);
    remove(atlas.frames, f, f.id, (r) => r.id);
  }
  if (changes.position) {
    if (atlas.position !== changes.position.expected)
      throw new Problem(409, 'atlas_conflict', 'Expected party position no longer matches');
    const target = resolve(changes.position.placeId);
    if (
      evidence &&
      atlas.position &&
      target &&
      target !== atlas.position &&
      !changes.position.exception &&
      !atlas.routes.some(
        (r) =>
          r.access === AtlasAccess.Open &&
          ((r.from === atlas.position && r.to === target) ||
            (r.bidirectional && r.to === atlas.position && r.from === target))
      )
    )
      throw new Problem(
        422,
        'atlas_movement',
        'Movement needs an open known connection or an explicit narrated exception'
      );
    atlas.position = target;
    const visited = atlas.places.find((p) => p.placeId === target);
    if (visited) visited.visited = true;
  }
  c.atlas = atlas;
  validateAtlas(c);
  return c;
}
export function undoAtlas(c: Campaign, before: Atlas | undefined, after: Atlas | undefined): void {
  if (!after) return;
  const current = c.atlas ?? emptyAtlas(),
    prior = before ?? emptyAtlas();
  for (const collection of ['places', 'routes', 'frames'] as const) {
    const key = (r: Atlas['places'][number] | Atlas['routes'][number] | Atlas['frames'][number]) =>
      'placeId' in r && !('id' in r) ? r.placeId : (r as { id: string }).id;
    const old = new Map(prior[collection].map((r) => [key(r), r]));
    const next = new Map(after[collection].map((r) => [key(r), r]));
    const restored = new Map(current[collection].map((r) => [key(r), r]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      if (isDeepStrictEqual(old.get(id), next.get(id))) continue;
      if (!isDeepStrictEqual(restored.get(id), next.get(id)))
        throw new Problem(
          409,
          'atlas_undo_conflict',
          'A touched atlas record changed after this turn'
        );
      if (old.has(id)) restored.set(id, old.get(id)!);
      else restored.delete(id);
    }
    Object.assign(current, { [collection]: [...restored.values()] });
  }
  if (prior.position !== after.position) {
    if (current.position !== after.position)
      throw new Problem(409, 'atlas_undo_conflict', 'Party position changed after this turn');
    current.position = prior.position;
  }
  c.atlas = current;
}
