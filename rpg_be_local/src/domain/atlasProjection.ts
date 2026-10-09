import type { Campaign } from './types.js';
import { emptyAtlas, atlasExpected, ATLAS_LIMITS, type AtlasPlace } from './atlas.js';
import { KnowledgeVisibility } from './knowledge.js';
import { Problem } from '../errors.js';

export function projectAtlas(
  c: Campaign,
  requestedScope?: string,
  cursor = 0,
  privateView = false,
  routeCursor = 0
) {
  const atlas = c.atlas ?? emptyAtlas();
  const records = new Map(
    (c.knowledge ?? [])
      .filter((p) => privateView || p.visibility !== KnowledgeVisibility.GmOnly)
      .map((p) => [p.id, p])
  );
  const places = atlas.places
    .filter((p) => records.has(p.placeId))
    .map((p): AtlasPlace => ({
      ...p,
      ...(p.parentPlaceId && !records.has(p.parentPlaceId) ? { parentPlaceId: null } : {}),
    }));
  const byId = new Map(places.map((p) => [p.placeId, p]));
  if (requestedScope && requestedScope !== 'world' && !byId.has(requestedScope))
    throw new Problem(404, 'atlas_scope', 'Atlas scope not found');
  const position = atlas.position && byId.has(atlas.position) ? atlas.position : null;
  const scope =
    requestedScope === 'world'
      ? null
      : (requestedScope ?? (position ? (byId.get(position)?.parentPlaceId ?? position) : null));
  const breadcrumb: { id: string; title: string }[] = [];
  let ancestor = scope;
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor)) {
    seen.add(ancestor);
    breadcrumb.unshift({ id: ancestor, title: records.get(ancestor)!.title });
    ancestor = byId.get(ancestor)?.parentPlaceId ?? null;
  }
  const visibleFrames = atlas.frames.filter(
    (f) => byId.has(f.placeId) && (privateView || f.visibility !== KnowledgeVisibility.GmOnly)
  );
  const frameIds = new Set(visibleFrames.map((f) => f.id));
  const scoped = places.filter((p) =>
    scope ? p.placeId === scope || p.parentPlaceId === scope : !p.parentPlaceId
  );
  const batch = scoped.slice(cursor, cursor + ATLAS_LIMITS.placePageSize);
  const pageIds = new Set(batch.map((p) => p.placeId));
  const publicIds = new Set(places.map((p) => p.placeId));
  const allRoutes = atlas.routes.filter(
    (r) =>
      publicIds.has(r.from) &&
      publicIds.has(r.to) &&
      (pageIds.has(r.from) || pageIds.has(r.to)) &&
      (privateView || r.visibility !== KnowledgeVisibility.GmOnly)
  );
  const routes = allRoutes.slice(routeCursor, routeCursor + ATLAS_LIMITS.routePageSize);
  // Include visible endpoints so a route never reveals an unresolved private identity.
  const endpointIds = new Set(routes.flatMap((r) => [r.from, r.to]));
  const shown = places.filter((p) => pageIds.has(p.placeId) || endpointIds.has(p.placeId));
  return {
    scope,
    position,
    breadcrumb,
    places: shown.map((p) => ({
      ...p,
      expected: atlasExpected(atlas.places.find((row) => row.placeId === p.placeId)),
      ...(p.placement && !frameIds.has(p.placement.frameId) ? { placement: undefined } : {}),
      title: records.get(p.placeId)!.title,
      text: records.get(p.placeId)!.text,
      certainty: records.get(p.placeId)!.certainty,
      visibility: records.get(p.placeId)!.visibility,
      ...(privateView
        ? { origin: records.get(p.placeId)!.origin, evidence: records.get(p.placeId)!.evidence }
        : {}),
    })),
    routes: routes.map(({ evidence: _evidence, origin: _origin, ...r }) => ({
      ...r,
      ...(privateView ? { origin: _origin, evidence: _evidence } : {}),
      expected: atlasExpected(atlas.routes.find((row) => row.id === r.id)),
      ...(r.drawing && !frameIds.has(r.drawing.frameId) ? { drawing: undefined } : {}),
    })),
    frames: visibleFrames
      .filter((f) => f.placeId === scope || pageIds.has(f.placeId))
      .map(({ evidence: _evidence, origin: _origin, privateAssetId: _privateAssetId, ...f }) => ({
        ...f,
        ...(privateView ? { origin: _origin, evidence: _evidence } : {}),
        expected: atlasExpected(atlas.frames.find((row) => row.id === f.id)),
      })),
    nextRouteCursor:
      routeCursor + ATLAS_LIMITS.routePageSize < allRoutes.length
        ? routeCursor + ATLAS_LIMITS.routePageSize
        : null,
    nextCursor:
      cursor + ATLAS_LIMITS.placePageSize < scoped.length
        ? cursor + ATLAS_LIMITS.placePageSize
        : null,
  };
}
