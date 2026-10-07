import type { CampaignKnowledge, Character, SheetLayout } from '../../services/types';

/** Scene entries longer than this belong in the narrative, not a glance panel. */
export const SCENE_VALUE_MAX_CHARS = 80;
/** Most recent chronicle records shown per kind. */
export const CHRONICLE_RECORDS_PER_KIND = 5;

export type Track = { key: string; label: string; value: number; max: number | null };
export const humanize = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Active-encounter tracked fields, as `[characterId, field]` pairs; paths are relative to `attributes`. */
function encounterFields(state: Record<string, unknown>, characterId: string) {
  const combat = state.combat as { active?: unknown; participants?: unknown } | null | undefined;
  if (!combat || combat.active !== true || !Array.isArray(combat.participants)) return [];
  const participant = (
    combat.participants as { characterId?: string; trackedFields?: unknown }[]
  ).find((entry) => entry?.characterId === characterId);
  return Array.isArray(participant?.trackedFields)
    ? (participant.trackedFields as { path?: unknown; label?: unknown }[]).filter(
        (field): field is { path: string[]; label: string } =>
          Array.isArray(field.path) &&
          field.path.every((segment) => typeof segment === 'string') &&
          typeof field.label === 'string'
      )
    : [];
}

/** Tracks come only from layout `track` hints or the active encounter; nothing is guessed. */
export function partyTracks(
  character: Character,
  state: Record<string, unknown>,
  layout: SheetLayout | undefined
): Track[] {
  const sheet = {
    attributes: character.attributes,
    inventory: character.inventory,
    description: character.description,
  };
  const tracks: Track[] = [];
  for (const hint of layout?.fields ?? []) {
    if (hint.widget !== 'track') continue;
    const value = valueAt(sheet, hint.path);
    const max = hint.max ?? valueAt(sheet, hint.maxPath ?? []);
    if (isNumber(value) && isNumber(max))
      tracks.push({
        key: hint.path.join('.'),
        label: hint.label ?? humanize(hint.path[hint.path.length - 1]!),
        value,
        max,
      });
  }
  for (const field of encounterFields(state, character.id)) {
    const path = ['attributes', ...field.path];
    if (tracks.some((track) => track.key === path.join('.'))) continue;
    const value = valueAt(sheet, path);
    if (isNumber(value)) tracks.push({ key: path.join('.'), label: field.label, value, max: null });
  }
  return tracks;
}

export function sceneEntries(state: Record<string, unknown>): [string, string][] {
  return Object.entries(state).flatMap(([key, value]) => {
    if (key === 'combat' || value === null || value === undefined) return [];
    if (typeof value === 'string')
      return value.length && value.length <= SCENE_VALUE_MAX_CHARS ? [[key, value]] : [];
    if (typeof value === 'number' || typeof value === 'boolean') return [[key, String(value)]];
    return [];
  });
}

export function chronicle(
  knowledge: CampaignKnowledge[],
  kinds: { id: string; label: string }[]
): { id: string; label: string; records: CampaignKnowledge[] }[] {
  return kinds
    .map((kind) => ({
      ...kind,
      records: knowledge
        .filter((record) => record.kind === kind.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, CHRONICLE_RECORDS_PER_KIND),
    }))
    .filter((kind) => kind.records.length);
}
