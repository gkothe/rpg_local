import { z } from 'zod';
import { atlasSchema, emptyAtlas, ATLAS_LIMITS, AtlasAccess, AtlasUnit } from './atlas.js';
import {
  campaignKnowledgeSchema,
  KnowledgeKind,
  KnowledgeCertainty,
  type MapAssetEvidence,
} from './knowledge.js';
import { projectAtlas } from './atlasProjection.js';
import type { Campaign } from './types.js';
import { Problem } from '../errors.js';

export const frozenAtlasSchema = z
  .object({ campaignId: z.uuid(), atlas: atlasSchema, records: z.array(campaignKnowledgeSchema) })
  .strict();
export type FrozenAtlas = z.infer<typeof frozenAtlasSchema>;
export function freezeAtlas(c: Campaign): FrozenAtlas {
  return {
    campaignId: c.id,
    atlas: structuredClone(c.atlas ?? emptyAtlas()),
    records: structuredClone((c.knowledge ?? []).filter((p) => p.kind === KnowledgeKind.Place)),
  };
}
export const atlasSearchSchema = z
  .object({ query: z.string().trim(), cursor: z.number().int().nonnegative().default(0) })
  .strict();
export const atlasGetSchema = z
  .object({
    scope: z.union([z.uuid(), z.literal('world')]).optional(),
    routeCursor: z.number().int().nonnegative().default(0),
    cursor: z.number().int().nonnegative().default(0),
  })
  .strict();
export const atlasRoutesSchema = z
  .object({
    from: z.uuid(),
    to: z.uuid(),
    scope: z.uuid().optional(),
    cursor: z.number().int().nonnegative().default(0),
    mode: z.string().trim().min(1).optional(),
  })
  .strict();
const METRES_PER_UNIT: Record<AtlasUnit, number> = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };
export function atlasRecall(frozen: FrozenAtlas) {
  const campaign = {
    id: frozen.campaignId,
    atlas: frozen.atlas,
    knowledge: frozen.records,
  } as Campaign;
  return {
    search(raw: unknown) {
      const { query, cursor } = atlasSearchSchema.parse(raw);
      const matches = frozen.records.filter((p) =>
        p.title.toLowerCase().includes(query.toLowerCase())
      );
      return {
        places: matches.slice(cursor, cursor + ATLAS_LIMITS.placePageSize).map((p) => ({
          id: p.id,
          title: p.title,
          certainty: p.certainty,
          visibility: p.visibility,
        })),
        nextCursor:
          cursor + ATLAS_LIMITS.placePageSize < matches.length
            ? cursor + ATLAS_LIMITS.placePageSize
            : null,
      };
    },
    get(raw: unknown) {
      const { scope, cursor, routeCursor } = atlasGetSchema.parse(raw);
      return projectAtlas(campaign, scope, cursor, true, routeCursor);
    },
    routes(raw: unknown) {
      const { from, to, scope, mode, cursor } = atlasRoutesSchema.parse(raw);
      const nodes = new Map(frozen.atlas.places.map((p) => [p.placeId, p]));
      if (!nodes.has(from) || !nodes.has(to) || (scope && !nodes.has(scope)))
        throw new Problem(404, 'atlas_place', 'Requested Place is not in the frozen atlas');
      const allowed = (id: string) => {
        if (!scope) return true;
        let p = nodes.get(id);
        while (p) {
          if (p.placeId === scope) return true;
          p = p.parentPlaceId ? nodes.get(p.parentPlaceId) : undefined;
        }
        return false;
      };
      if (!allowed(from) || !allowed(to))
        throw new Problem(422, 'atlas_scope', 'Route endpoints must be inside the requested scope');
      const frontier = [from],
        visited = new Set([from]);
      const previous = new Map<
        string,
        { place: string; route: (typeof frozen.atlas.routes)[number] }
      >();
      for (let i = 0; i < frontier.length && !visited.has(to); i++) {
        const at = frontier[i]!;
        for (const route of frozen.atlas.routes) {
          if (route.access !== AtlasAccess.Open) continue;
          const next =
            route.from === at
              ? route.to
              : route.bidirectional && route.to === at
                ? route.from
                : null;
          if (!next || !allowed(next) || visited.has(next)) continue;
          visited.add(next);
          previous.set(next, { place: at, route });
          frontier.push(next);
        }
      }
      if (!visited.has(to))
        return {
          found: false,
          constrainedRoutes: frozen.atlas.routes
            .filter(
              (r) =>
                r.access !== AtlasAccess.Open &&
                allowed(r.from) &&
                allowed(r.to) &&
                ((r.from === from && r.to === to) ||
                  (r.bidirectional && r.from === to && r.to === from))
            )
            .slice(0, ATLAS_LIMITS.routePageSize)
            .map((r) => ({ id: r.id, access: r.access })),
          reason: 'No known open route in this data; other routes may exist.',
        };
      const path: typeof frozen.atlas.routes = [];
      let at = to;
      while (at !== from) {
        const step = previous.get(at)!;
        path.unshift(step.route);
        at = step.place;
      }
      const knownMetres = path.reduce(
        (n, r) => n + (r.distance ? r.distance.value * METRES_PER_UNIT[r.distance.unit] : 0),
        0
      );
      const distancesKnown = path.every((r) => r.distance !== undefined);
      const durationsKnown =
        Boolean(mode) &&
        path.every(
          (r) => r.travel?.mode.toLowerCase() === mode!.toLowerCase() && !r.travel?.conditions
        );
      return {
        found: true,
        selection: 'A known open path with fewest connections; not a fastest-route claim.',
        routes: path.slice(cursor, cursor + ATLAS_LIMITS.routePageSize),
        nextCursor:
          cursor + ATLAS_LIMITS.routePageSize < path.length
            ? cursor + ATLAS_LIMITS.routePageSize
            : null,
        totalConnections: path.length,
        distance: distancesKnown ? { value: knownMetres, unit: AtlasUnit.Metres } : null,
        knownDistanceMetres: knownMetres,
        unknownDistanceRouteIds: path
          .slice(cursor, cursor + ATLAS_LIMITS.routePageSize)
          .filter((r) => !r.distance)
          .map((r) => r.id),
        minutes: durationsKnown ? path.reduce((n, r) => n + r.travel!.minutes, 0) : null,
        mode: mode ?? null,
        uncertainty: path
          .slice(cursor, cursor + ATLAS_LIMITS.routePageSize)
          .filter((r) => r.certainty !== KnowledgeCertainty.Established)
          .map((r) => r.id),
      };
    },
  };
}

export function atlasObservations(frozen: FrozenAtlas | undefined): MapAssetEvidence[] {
  return [
    ...(frozen?.records ?? []),
    ...(frozen?.atlas.frames ?? []),
    ...(frozen?.atlas.routes ?? []),
  ].flatMap((r) => r.evidence.filter((e): e is MapAssetEvidence => e.type === 'map_asset'));
}
