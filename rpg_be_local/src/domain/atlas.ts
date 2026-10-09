import { ATLAS_IMAGE_TYPES, ATLAS_IMAGE_MAX_PIXELS } from './atlasImageOptions.js';
import { createHash } from 'node:crypto';
import { canonicalRuleJson } from './rules.js';
import { z } from 'zod';
import { Problem } from '../errors.js';
import type { Campaign } from './types.js';
import { MAX_ENTITY_NAME_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';
import {
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeStatus,
  KnowledgeVisibility,
  KnowledgeCertainty,
  knowledgeProvenanceSchema,
} from './knowledge.js';
import { knowledgeRefSchema } from './responseReferences.js';

export enum AtlasRouteKind {
  Road = 'road',
  Path = 'path',
  Passage = 'passage',
  Door = 'door',
  Stairs = 'stairs',
  Ladder = 'ladder',
  Waterway = 'waterway',
  Other = 'other',
}
export enum AtlasAccess {
  Open = 'open',
  Closed = 'closed',
  Locked = 'locked',
  Blocked = 'blocked',
  Unknown = 'unknown',
}
export enum AtlasUnit {
  Metres = 'm',
  Kilometres = 'km',
  Feet = 'ft',
  Miles = 'mi',
}
export enum AtlasView {
  Diagram = 'diagram',
  FloorPlan = 'floor_plan',
  Image = 'image',
}
export const ATLAS_LIMITS = {
  placePageSize: 30,
  importPageSize: 20,
  routePageSize: 60,
  prepareRequestBytes: 64 * 1024,
} as const;
const option = (values: Record<string, string>) =>
  Object.values(values).map((id) => ({ id, label: id.replaceAll('_', ' ') }));
export const ATLAS_OPTIONS = {
  views: option(AtlasView),
  routeKinds: option(AtlasRouteKind),
  access: option(AtlasAccess),
  units: option(AtlasUnit),
  limits: ATLAS_LIMITS,
  images: { mimeTypes: ATLAS_IMAGE_TYPES, maxPixels: ATLAS_IMAGE_MAX_PIXELS },
  defaults: {
    visibility: KnowledgeVisibility.Player,
    certainty: KnowledgeCertainty.Established,
    origin: KnowledgeOrigin.Player,
  },
};
export const atlasText = z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS);
const label = z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS);
const coordinate = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
export const atlasPointSchema = z.object({ x: coordinate, y: coordinate }).strict();
export const atlasPlacementSchema = z
  .object({
    frameId: z.uuid(),
    x: coordinate,
    y: coordinate,
    width: positive.optional(),
    height: positive.optional(),
  })
  .strict()
  .refine(
    (p) => (p.width === undefined) === (p.height === undefined),
    'Both room dimensions must be supplied'
  );
export const atlasPlaceSchema = z
  .object({
    placeId: z.uuid(),
    parentPlaceId: z.uuid().nullable().optional(),
    visited: z.boolean(),
    placement: atlasPlacementSchema.optional(),
  })
  .strict();
export const atlasFrameSchema = z
  .object({
    id: z.uuid(),
    placeId: z.uuid(),
    label,
    floor: label,
    width: positive,
    height: positive,
    calibration: z
      .object({ distancePerUnit: positive, unit: z.enum(AtlasUnit) })
      .strict()
      .optional(),
    visibility: z.enum(KnowledgeVisibility),
    ...knowledgeProvenanceSchema.shape,
    privateAssetId: z.uuid().optional(),
    playerAssetId: z.uuid().optional(),
  })
  .strict();
export const atlasRouteSchema = z
  .object({
    id: z.uuid(),
    from: z.uuid(),
    to: z.uuid(),
    bidirectional: z.boolean(),
    kind: z.enum(AtlasRouteKind),
    access: z.enum(AtlasAccess),
    visibility: z.enum(KnowledgeVisibility),
    certainty: z.enum(KnowledgeCertainty),
    direction: label.optional(),
    distance: z
      .object({ value: positive, unit: z.enum(AtlasUnit) })
      .strict()
      .optional(),
    travel: z
      .object({ mode: label, minutes: positive, conditions: atlasText.optional() })
      .strict()
      .optional(),
    drawing: z
      .object({ frameId: z.uuid(), points: z.array(atlasPointSchema).min(2) })
      .strict()
      .optional(),
    ...knowledgeProvenanceSchema.shape,
  })
  .strict();
export const atlasSchema = z
  .object({
    places: z.array(atlasPlaceSchema),
    routes: z.array(atlasRouteSchema),
    frames: z.array(atlasFrameSchema),
    position: z.uuid().nullable(),
  })
  .strict();
export type Atlas = z.infer<typeof atlasSchema>;
export type AtlasPlace = z.infer<typeof atlasPlaceSchema>;
export type AtlasRoute = z.infer<typeof atlasRouteSchema>;
export type AtlasFrame = z.infer<typeof atlasFrameSchema>;
export const emptyAtlas = (): Atlas => ({ places: [], routes: [], frames: [], position: null });
export const localRefSchema = z.object({ localKey: label }).strict();
export const atlasRefSchema = z.union([knowledgeRefSchema, localRefSchema]);
const frameRef = z.union([z.uuid(), localRefSchema]);
const placeInput = atlasPlaceSchema.extend({
  placeId: atlasRefSchema,
  parentPlaceId: atlasRefSchema.nullable().optional(),
  placement: z
    .object({
      frameId: frameRef,
      x: coordinate,
      y: coordinate,
      width: positive.optional(),
      height: positive.optional(),
    })
    .strict()
    .optional(),
});
const routeInput = atlasRouteSchema.extend({
  id: z.uuid().optional(),
  from: atlasRefSchema,
  to: atlasRefSchema,
  drawing: z
    .object({ frameId: frameRef, points: z.array(atlasPointSchema).min(2) })
    .strict()
    .optional(),
});
const frameInput = atlasFrameSchema.extend({
  id: z.uuid().optional(),
  key: label.optional(),
  placeId: atlasRefSchema,
});
export const atlasMutationSchema = z
  .object({
    createPlaces: z
      .array(
        z
          .object({
            key: label,
            title: label,
            text: atlasText,
            visibility: z.enum(KnowledgeVisibility),
            certainty: z.enum(KnowledgeCertainty),
          })
          .strict()
      )
      .optional(),
    places: z
      .array(
        z
          .object({
            value: placeInput,
            expected: z.union([atlasPlaceSchema, z.string().regex(/^[a-f0-9]{64}$/)]).nullable(),
          })
          .strict()
      )
      .optional(),
    routes: z
      .array(
        z
          .object({
            value: routeInput,
            expected: z.union([atlasRouteSchema, z.string().regex(/^[a-f0-9]{64}$/)]).nullable(),
          })
          .strict()
      )
      .optional(),
    frames: z
      .array(
        z
          .object({
            value: frameInput,
            expected: z.union([atlasFrameSchema, z.string().regex(/^[a-f0-9]{64}$/)]).nullable(),
          })
          .strict()
      )
      .optional(),
    removePlaces: z
      .array(
        z.union([
          atlasPlaceSchema,
          z.object({ placeId: z.uuid(), expected: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        ])
      )
      .optional(),
    removeRoutes: z
      .array(
        z.union([
          atlasRouteSchema,
          z.object({ id: z.uuid(), expected: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        ])
      )
      .optional(),
    removeFrames: z
      .array(
        z.union([
          atlasFrameSchema,
          z.object({ id: z.uuid(), expected: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        ])
      )
      .optional(),
    position: z
      .object({
        placeId: atlasRefSchema.nullable(),
        expected: z.uuid().nullable(),
        exception: atlasText.optional(),
      })
      .strict()
      .optional(),
    preparedReceiptIds: z.array(z.uuid()).optional(),
  })
  .strict();
export type AtlasMutation = z.infer<typeof atlasMutationSchema>;
export const atlasEditSchema = z
  .object({ requestId: z.uuid(), changes: atlasMutationSchema })
  .strict();
export const atlasQuerySchema = z
  .object({
    scope: z.union([z.uuid(), z.literal('world')]).optional(),
    routeCursor: z.coerce.number().int().nonnegative().default(0),
    cursor: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();
export function validateAtlas(
  c: Pick<Campaign, 'atlas' | 'knowledge'> &
    Partial<Pick<Campaign, 'id' | 'characters' | 'sources'>>
): void {
  if (!c.atlas) return;
  const atlas = atlasSchema.parse(c.atlas);
  const knowledge = new Map((c.knowledge ?? []).map((p) => [p.id, p]));
  const entries = new Map(atlas.places.map((p) => [p.placeId, p]));
  const fail = (message: string): never => {
    throw new Problem(422, 'atlas_invalid', message);
  };
  if (entries.size !== atlas.places.length) fail('Duplicate atlas Place');
  const ids = new Set<string>([
    ...knowledge.keys(),
    ...(c.id ? [c.id] : []),
    ...(c.characters ?? []).map((x) => x.id),
    ...(c.sources ?? []).map((x) => x.id),
  ]);
  for (const entry of atlas.places) {
    const p = knowledge.get(entry.placeId);
    if (!p || p.kind !== KnowledgeKind.Place || p.status !== KnowledgeStatus.Active)
      fail('Atlas needs an active campaign Place');
    const ancestors = new Set([entry.placeId]);
    let parent = entry.parentPlaceId;
    while (parent) {
      if (ancestors.has(parent)) fail('Atlas containment cycle');
      ancestors.add(parent);
      if (!entries.has(parent)) fail('Atlas parent Place is missing');
      parent = entries.get(parent)!.parentPlaceId;
    }
    ids.add(entry.placeId);
  }
  const frames = new Map(atlas.frames.map((f) => [f.id, f]));
  for (const f of atlas.frames) {
    if (ids.has(f.id) || !entries.has(f.placeId)) fail('Invalid frame identity or owning Place');
    ids.add(f.id);
  }
  const fits = (frameId: string, x: number, y: number, width = 0, height = 0) => {
    const f = frames.get(frameId);
    if (!f || x + width > f.width || y + height > f.height)
      fail('Geometry must fit its owning frame');
  };
  for (const p of atlas.places)
    if (p.placement) {
      fits(
        p.placement.frameId,
        p.placement.x,
        p.placement.y,
        p.placement.width,
        p.placement.height
      );
      const owner = frames.get(p.placement.frameId)!.placeId;
      let node: AtlasPlace | undefined = p;
      while (node && node.placeId !== owner)
        node = node.parentPlaceId ? entries.get(node.parentPlaceId) : undefined;
      if (!node) fail('Placement frame must belong to the Place or an ancestor');
    }
  for (const r of atlas.routes) {
    if (ids.has(r.id) || r.from === r.to || !entries.has(r.from) || !entries.has(r.to))
      fail('Invalid route identity/endpoints');
    ids.add(r.id);
    if (r.drawing) {
      const a = entries.get(r.from)!.placement,
        b = entries.get(r.to)!.placement;
      if (!a || !b || a.frameId !== r.drawing.frameId || b.frameId !== r.drawing.frameId)
        fail('Route drawing endpoints must be on the same floor frame');
      for (const point of r.drawing.points) fits(r.drawing.frameId, point.x, point.y);
      const attached = (
        point: z.infer<typeof atlasPointSchema>,
        box: z.infer<typeof atlasPlacementSchema>
      ) =>
        point.x >= box.x &&
        point.y >= box.y &&
        point.x <= box.x + (box.width ?? 0) &&
        point.y <= box.y + (box.height ?? 0);
      if (!attached(r.drawing.points[0]!, a!) || !attached(r.drawing.points.at(-1)!, b!))
        fail('Route drawing must attach to both endpoint rooms or junctions');
    }
  }
  if (atlas.position && !entries.has(atlas.position))
    fail('Current position must identify an atlas Place');
}

export const atlasExpected = (value: unknown) =>
  createHash('sha256').update(canonicalRuleJson(value)).digest('hex');
