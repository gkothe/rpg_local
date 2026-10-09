import type { AtlasPlace, AtlasRoute } from './types';

const NODE_WIDTH = 170,
  NODE_HEIGHT = 64,
  COLUMN_GAP = 60,
  ROW_GAP = 35;
/** Display coordinates never encode travel distance, room dimensions or reachability. */
export function atlasLayout(places: AtlasPlace[], routes: AtlasRoute[]) {
  const placed = new Map<string, { x: number; y: number }>();
  let row = 0;
  const neighbours = (id: string) =>
    routes.flatMap((r) => (r.from === id ? [r.to] : r.to === id ? [r.from] : []));
  for (const start of places) {
    if (placed.has(start.placeId)) continue;
    const queue = [{ id: start.placeId, depth: 0 }];
    let maxRow = row;
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index]!;
      if (placed.has(item.id) || !places.some((p) => p.placeId === item.id)) continue;
      const y = row++ * (NODE_HEIGHT + ROW_GAP);
      placed.set(item.id, { x: item.depth * (NODE_WIDTH + COLUMN_GAP), y });
      maxRow = row;
      for (const id of neighbours(item.id))
        if (!placed.has(id)) queue.push({ id, depth: item.depth + 1 });
    }
    row = maxRow + 1;
  }
  return {
    positions: placed,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    width: Math.max(400, ...[...placed.values()].map((p) => p.x + NODE_WIDTH)),
    height: Math.max(180, row * (NODE_HEIGHT + ROW_GAP)),
  };
}
