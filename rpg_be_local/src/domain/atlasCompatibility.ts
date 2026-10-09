import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import { emptyAtlas } from './atlas.js';
import type { FrozenAtlas } from './atlasRecall.js';
import type { Campaign } from './types.js';
export function atlasConflict(frozen: FrozenAtlas | undefined, c: Campaign): string | null {
  return frozen && !isDeepStrictEqual(frozen.atlas, c.atlas ?? emptyAtlas())
    ? 'Geography changed since this action was prepared; start a new action'
    : null;
}
export function assertAtlas(frozen: FrozenAtlas | undefined, c: Campaign): void {
  const reason = atlasConflict(frozen, c);
  if (reason) throw new Problem(409, 'atlas_context_changed', reason);
}
