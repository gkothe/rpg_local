import { Problem } from '../errors.js';

// Backend-owned global feature switch. Change this value and restart the backend.
export const atkas_Feature: 'enabled' | 'disabled' = 'disabled';
export const atlasFeatureEnabled = (): boolean => Object.is(atkas_Feature, 'enabled');

export function requireAtlasFeature(): void {
  if (!atlasFeatureEnabled())
    throw new Problem(409, 'feature_disabled', 'Atlas is disabled globally');
}

/** Preserve trusted frozen context rather than silently changing a dice retry. */
export function assertAtlasSessionEnabled(session: {
  frozen_atlas?: unknown;
  tool_definitions?: { capability?: string; name?: string }[];
}): void {
  if (
    session.frozen_atlas ||
    session.tool_definitions?.some(
      (tool) => tool.capability === 'atlas' || tool.name?.startsWith('world_map_')
    )
  )
    requireAtlasFeature();
}
